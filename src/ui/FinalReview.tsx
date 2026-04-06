import {
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Progress,
  Stack,
  Text,
} from "@chakra-ui/react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useObservable } from "../observable";
import { model } from "../state/model";
import { getPartLabel } from "../music/types";
import { progressionDurationSec } from "../music/playback";
import { startCompositor } from "../video/compositor";
import { exportVideo, getPreferredExportFormat } from "../video/exporter";
import {
  createReviewTransport,
  type ReviewTransport,
} from "../video/reviewTransport";
import { createMixer } from "../audio/mixer";
import {
  AUDIO_SCHEDULE_LEAD_SEC,
  FRAME_READY_TIMEOUT_MS,
} from "../transport/core";
import {
  getActiveSegmentAtTime,
  getTimelineEndSec,
  samplePeaksForSegment,
  snapTimeSec,
} from "./timeline";
import type {
  EditorSelection,
  TimelineSegment,
  TrackTimeline,
} from "./timeline";
import {
  dsColors,
  dsOutlineButton,
  dsPanel,
  dsPrimaryButton,
  dsScreenShell,
} from "./designSystem";

const TIMELINE_PX_PER_SEC = 110;
const TIMELINE_RIGHT_PAD_PX = 48;
const LANE_HEIGHT_PX = 72;
const TRACK_RAIL_WIDTH_PX = 72;

type ActiveAudioSource = {
  source: AudioBufferSourceNode;
};

export function FinalReview() {
  const tracksState = useObservable(model.tracks.tracks);
  const chords = useObservable(model.parsedChords);
  const tempo = useObservable(model.tempoInput);
  const ctx = useObservable(model.audioContext);
  const trackCount = tracksState.lanes.length;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timelineViewportRef = useRef<HTMLDivElement>(null);

  const videoRefs = useRef<(HTMLVideoElement | null)[]>(
    Array.from({ length: trackCount }, () => null),
  );
  const activeVideoMaskRef = useRef<boolean[]>(
    Array.from({ length: trackCount }, () => false),
  );
  const reviewTransportRef = useRef<ReviewTransport | null>(null);
  const startRequestTokenRef = useRef(0);

  const activeSourcesRef = useRef<ActiveAudioSource[]>([]);

  const timelines = useMemo<TrackTimeline[]>(
    () => tracksState.lanes.map((lane) => lane.clips),
    [tracksState],
  );
  const timelinesRef = useRef<TrackTimeline[]>(timelines);

  const selection = tracksState.editor.selection;
  const playheadSec = tracksState.editor.playheadSec;
  const snapToBeat = tracksState.editor.snapToBeat;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isSyncingFrames, setIsSyncingFrames] = useState(false);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);

  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);
  const [waveformVersion, setWaveformVersion] = useState(0);

  const exporting = tracksState.export.exporting;
  const exportProgress = tracksState.export.progress;
  const exportedUrl = tracksState.export.exportedUrl;
  const exportedFormat = tracksState.export.format;
  const volumes = tracksState.mix.volumes;
  const muted = tracksState.mix.muted;
  const reverbWet = tracksState.mix.reverbWet;
  const preferredExportFormat = useMemo(() => getPreferredExportFormat(), []);
  const ctaExportFormat = exportedFormat ?? preferredExportFormat;
  const showWebmFallbackMessage = preferredExportFormat === "webm";

  const baseDurationSec = progressionDurationSec(chords, tempo);
  const beatSec = tempo > 0 ? 60 / tempo : 0;

  const timelineEndSec = useMemo(() => {
    return getTimelineEndSec(timelines);
  }, [timelines]);

  const timelineContentWidthPx = useMemo(() => {
    const minContent =
      Math.max(1, timelineEndSec) * TIMELINE_PX_PER_SEC + TIMELINE_RIGHT_PAD_PX;
    return Math.max(timelineViewportWidth, Math.ceil(minContent));
  }, [timelineEndSec, timelineViewportWidth]);

  const beatLineTimes = useMemo(() => {
    if (beatSec <= 0 || timelineEndSec <= 0) return [] as number[];
    const lines: number[] = [];
    for (let t = 0; t <= timelineEndSec + 0.0001; t += beatSec) {
      lines.push(t);
    }
    return lines;
  }, [beatSec, timelineEndSec]);

  timelinesRef.current = timelines;

  const stopAudio = useCallback(() => {
    for (const entry of activeSourcesRef.current) {
      try {
        entry.source.stop();
      } catch {
        // Safe to ignore if already stopped.
      }
    }
    activeSourcesRef.current = [];
  }, []);

  const stopPlaybackEngine = useCallback(
    (preservePlayhead: boolean) => {
      startRequestTokenRef.current += 1;
      reviewTransportRef.current?.stop();
      stopAudio();
      setIsPlaying(false);
      setIsSyncingFrames(false);

      if (!preservePlayhead) {
        model.tracks.setPlayhead(0);
        reviewTransportRef.current?.syncPaused(0);
      }
    },
    [stopAudio],
  );

  const startAudioFromTimeline = useCallback(
    (
      startCtxTime: number,
      startTimelineSec: number,
      endTimelineSec: number,
    ) => {
      if (ctx == null || model.mixer == null) return;

      stopAudio();

      for (let lane = 0; lane < trackCount; lane++) {
        const track = timelinesRef.current[lane] as
          | Array<TimelineSegment & { takeId?: string }>
          | undefined;
        if (track == null) continue;

        for (const segment of track) {
          if (segment.takeId == null) continue;
          const buffer = model.getTakeAudioBuffer(segment.takeId);
          if (buffer == null) continue;

          const segStart = segment.timelineStartSec;
          const segEnd = segment.timelineStartSec + segment.durationSec;
          if (segEnd <= startTimelineSec || segStart >= endTimelineSec)
            continue;

          const playFrom = Math.max(startTimelineSec, segStart);
          const playTo = Math.min(endTimelineSec, segEnd);
          const playDuration = playTo - playFrom;
          if (playDuration <= 0) continue;

          const sourceOffset = segment.sourceStartSec + (playFrom - segStart);
          if (sourceOffset >= buffer.duration) continue;

          const cappedDuration = Math.min(
            playDuration,
            buffer.duration - sourceOffset,
          );
          if (cappedDuration <= 0) continue;

          const source = ctx.createBufferSource();
          source.buffer = buffer;
          model.mixer.connectSource(lane, source);

          const startAt = startCtxTime + (playFrom - startTimelineSec);
          source.start(startAt, sourceOffset, cappedDuration);
          activeSourcesRef.current.push({ source });
        }
      }
    },
    [ctx, stopAudio, trackCount],
  );

  const primeTransportForRun = useCallback(
    async (startTimelineSec: number): Promise<number[]> => {
      const transport = reviewTransportRef.current;
      if (transport == null) return [];
      return transport.primeForStart({
        startTimelineSec,
        frameReadyTimeoutMs: FRAME_READY_TIMEOUT_MS,
      });
    },
    [],
  );

  function findSegmentBySelection(
    sel: EditorSelection,
  ): TimelineSegment | null {
    if (sel.laneIndex == null || sel.segmentId == null) return null;
    const track = timelines[sel.laneIndex] ?? [];
    return track.find((segment) => segment.id === sel.segmentId) ?? null;
  }

  // Build video elements, mixer, compositor and decode track audio once.
  useEffect(() => {
    if (ctx == null) return;

    let cancelled = false;
    const videos: HTMLVideoElement[] = [];
    const activeLaneTakeIds = tracksState.laneTakeIds;

    model.clearRuntimeTakeMedia();
    model.tracks.setPlayhead(0);
    model.tracks.setSelection({ laneIndex: null, segmentId: null });
    setWaveformVersion((v) => v + 1);

    for (let i = 0; i < trackCount; i++) {
      const takeId = activeLaneTakeIds[i];
      const take = takeId != null ? tracksState.takesById[takeId] : null;
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.loop = false;
      video.preload = "auto";
      if (take != null) {
        video.src = take.url;
      }
      videoRefs.current[i] = video;
      videos.push(video);
    }

    const mixer = createMixer(ctx, trackCount);
    for (let i = 0; i < trackCount; i++) {
      mixer.setTrackVolume(i, tracksState.mix.volumes[i] ?? 1);
      mixer.setTrackMuted(i, tracksState.mix.muted[i] ?? false);
    }
    mixer.setReverbWet(tracksState.mix.reverbWet);
    model.mixer = mixer;

    if (canvasRef.current != null) {
      model.compositor = startCompositor(canvasRef.current, videos, {
        isVideoActive: (index) => activeVideoMaskRef.current[index] ?? false,
      });
    }

    reviewTransportRef.current = createReviewTransport({
      ctx,
      trackCount,
      videos,
      getTimelines: () => timelinesRef.current,
      onActiveMask: (mask) => {
        activeVideoMaskRef.current = mask;
      },
    });
    reviewTransportRef.current.syncPaused(0);

    for (let i = 0; i < trackCount; i++) {
      const takeId = tracksState.laneTakeIds[i];
      if (takeId == null) continue;
      const take = tracksState.takesById[takeId];
      if (take == null) continue;

      const videoEl = videos[i];
      if (videoEl == null) continue;

      void model
        .ingestTakeRuntimeMedia({
          takeId,
          laneIndex: i,
          blob: take.blob,
          trimOffsetSec: Math.max(0, take.trimOffsetSec),
          ctx,
          videoEl,
          maxDurationSec: baseDurationSec,
          waveformBuckets: 400,
        })
        .then((ingested) => {
          if (cancelled || !ingested) return;
          setWaveformVersion((v) => v + 1);
        })
        .catch(() => {
          // Keep lane empty if decoding fails.
        });
    }

    return () => {
      cancelled = true;
      stopPlaybackEngine(false);
      reviewTransportRef.current?.dispose();
      reviewTransportRef.current = null;

      model.compositor?.stop();
      model.compositor = null;

      model.mixer?.dispose();
      model.mixer = null;

      for (const video of videos) {
        video.pause();
        video.src = "";
      }
    };
  }, [
    baseDurationSec,
    ctx,
    stopPlaybackEngine,
    trackCount,
    tracksState.laneTakeIds,
    tracksState.takesById,
  ]);

  // Keep mixer graph in sync with UI controls after mount.
  useEffect(() => {
    const mixer = model.mixer;
    if (mixer == null) return;
    for (let i = 0; i < trackCount; i++) {
      mixer.setTrackVolume(i, volumes[i] ?? 1);
      mixer.setTrackMuted(i, muted[i] ?? false);
    }
    mixer.setReverbWet(reverbWet);
  }, [muted, reverbWet, trackCount, volumes]);

  // Keep a current frame visible while paused.
  useEffect(() => {
    if (isPlaying || exporting || isSyncingFrames) return;
    reviewTransportRef.current?.syncPaused(playheadSec);
  }, [
    exporting,
    isPlaying,
    isSyncingFrames,
    playheadSec,
    timelines,
    waveformVersion,
  ]);

  // Ensure selection always points to an existing segment.
  useEffect(() => {
    const selected = findSegmentBySelection(selection);
    if (selected != null) return;

    for (let lane = 0; lane < trackCount; lane++) {
      const first = timelines[lane]?.[0] ?? null;
      if (first != null) {
        if (selection.laneIndex === lane && selection.segmentId === first.id) {
          return;
        }
        model.tracks.setSelection({ laneIndex: lane, segmentId: first.id });
        return;
      }
    }

    if (selection.laneIndex != null || selection.segmentId != null) {
      model.tracks.setSelection({ laneIndex: null, segmentId: null });
    }
  }, [selection, timelines, trackCount]);

  // Track timeline viewport width for responsive content width.
  useEffect(() => {
    const el = timelineViewportRef.current;
    if (el == null) return;

    const update = () => setTimelineViewportWidth(el.clientWidth);
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      stopPlaybackEngine(false);
    };
  }, [stopPlaybackEngine]);

  async function handlePlayPause() {
    if (exporting || isSyncingFrames || ctx == null) return;
    if (timelineEndSec <= 0) return;

    if (isPlaying) {
      stopPlaybackEngine(true);
      return;
    }

    const startTimelineSec = playheadSec >= timelineEndSec ? 0 : playheadSec;
    const requestToken = startRequestTokenRef.current + 1;
    startRequestTokenRef.current = requestToken;

    setSyncWarning(null);
    setIsSyncingFrames(true);

    try {
      const unavailableLanes = await primeTransportForRun(startTimelineSec);
      if (startRequestTokenRef.current !== requestToken) return;
      const transport = reviewTransportRef.current;
      if (transport == null) return;

      if (unavailableLanes.length > 0) {
        setSyncWarning(formatLaneWarning(unavailableLanes, trackCount));
      }

      const startCtxTime = ctx.currentTime + AUDIO_SCHEDULE_LEAD_SEC;
      model.tracks.setPlayhead(startTimelineSec);
      startAudioFromTimeline(startCtxTime, startTimelineSec, timelineEndSec);

      transport.startRun({
        mode: "preview",
        startCtxTimeSec: startCtxTime,
        startTimelineSec,
        endTimelineSec: timelineEndSec,
        onTick: (timelineSec) => {
          model.tracks.setPlayhead(timelineSec);
        },
        onEnded: () => {
          stopAudio();
          setIsPlaying(false);
          model.tracks.setPlayhead(timelineEndSec);
        },
      });
      setIsPlaying(true);
    } finally {
      if (startRequestTokenRef.current === requestToken) {
        setIsSyncingFrames(false);
      }
    }
  }

  function handleSplitAtPlayhead() {
    if (exporting || isSyncingFrames) return;
    if (selection.laneIndex == null) return;

    if (isPlaying) {
      stopPlaybackEngine(true);
    }

    model.tracks.splitSelectedClipAtPlayhead();
  }

  function handleDeleteSelectedSegment() {
    if (exporting || isSyncingFrames) return;
    if (selection.laneIndex == null || selection.segmentId == null) return;

    if (isPlaying) {
      stopPlaybackEngine(true);
    }

    model.tracks.deleteSelectedClip();
  }

  function handleLaneClick(
    e: ReactPointerEvent<HTMLDivElement>,
    laneIndex: number,
  ) {
    if (exporting || isSyncingFrames) return;
    if (isPlaying) return;

    const viewport = timelineViewportRef.current;
    if (viewport == null) return;

    const rect = viewport.getBoundingClientRect();
    const contentX = e.clientX - rect.left + viewport.scrollLeft;
    const unclampedTime = contentX / TIMELINE_PX_PER_SEC;
    const nextPlayhead = Math.max(0, Math.min(unclampedTime, timelineEndSec));

    model.tracks.setSelection({ laneIndex, segmentId: selection.segmentId });
    model.tracks.setPlayhead(nextPlayhead);
  }

  function handleSegmentPointerDown(
    e: ReactPointerEvent<HTMLDivElement>,
    laneIndex: number,
    segment: TimelineSegment,
  ) {
    e.stopPropagation();
    if (exporting || isPlaying || isSyncingFrames) return;

    model.tracks.setSelection({ laneIndex, segmentId: segment.id });

    const startClientX = e.clientX;
    const originStartSec = segment.timelineStartSec;

    const onMove = (event: PointerEvent) => {
      const deltaPx = event.clientX - startClientX;
      const deltaSec = deltaPx / TIMELINE_PX_PER_SEC;
      let desiredStartSec = originStartSec + deltaSec;

      if (snapToBeat) {
        desiredStartSec = snapTimeSec(desiredStartSec, beatSec);
      }

      model.tracks.moveClip(laneIndex, segment.id, desiredStartSec);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function handleSeek(valueSec: number) {
    if (isPlaying || exporting || isSyncingFrames) return;
    const next = Math.max(0, Math.min(valueSec, timelineEndSec));
    model.tracks.setPlayhead(next);
  }

  function handleVolumeChange(index: number, value: number) {
    model.tracks.setTrackVolume(index, value);
  }

  function handleMuteToggle(index: number) {
    const nextMuted = !(muted[index] ?? false);
    model.tracks.setTrackMuted(index, nextMuted);
  }

  function handleReverbChange(wet: number) {
    model.tracks.setReverbWet(wet);
  }

  function handleRedoPart(index: number) {
    if (isSyncingFrames) return;
    stopPlaybackEngine(false);
    model.redoPart(index);
  }

  async function handleExport() {
    const mixer = model.mixer;
    if (ctx == null || canvasRef.current == null || mixer == null) return;
    if (isSyncingFrames) return;
    if (timelineEndSec <= 0) return;

    stopPlaybackEngine(false);
    model.tracks.beginExport();
    setSyncWarning(null);
    const requestToken = startRequestTokenRef.current + 1;
    startRequestTokenRef.current = requestToken;
    setIsSyncingFrames(true);

    try {
      const unavailableLanes = await primeTransportForRun(0);
      if (startRequestTokenRef.current !== requestToken) return;
      const transport = reviewTransportRef.current;
      if (transport == null) {
        model.tracks.failOrResetExport();
        return;
      }
      if (unavailableLanes.length > 0) {
        setSyncWarning(formatLaneWarning(unavailableLanes, trackCount));
      }

      const startCtxTime = ctx.currentTime + AUDIO_SCHEDULE_LEAD_SEC;
      startAudioFromTimeline(startCtxTime, 0, timelineEndSec);
      transport.startRun({
        mode: "export",
        startCtxTimeSec: startCtxTime,
        startTimelineSec: 0,
        endTimelineSec: timelineEndSec,
        onTick: (timelineSec) => {
          model.tracks.setPlayhead(timelineSec);
        },
        onEnded: () => {
          model.tracks.setPlayhead(timelineEndSec);
        },
      });

      const result = await exportVideo({
        canvas: canvasRef.current,
        audioContext: ctx,
        mixer,
        durationMs: timelineEndSec * 1000,
        onProgress: (progress) => model.tracks.updateExportProgress(progress),
      });

      const nextUrl = URL.createObjectURL(result.blob);
      model.tracks.completeExport({
        url: nextUrl,
        format: result.format,
        mimeType: result.mimeType,
      });
    } catch (err) {
      console.error("Export failed", err);
      model.tracks.failOrResetExport();
    } finally {
      if (startRequestTokenRef.current === requestToken) {
        setIsSyncingFrames(false);
      }
      stopPlaybackEngine(false);
    }
  }

  function handleDownload() {
    if (exportedUrl == null) return;
    const a = document.createElement("a");
    a.href = exportedUrl;
    a.download = `hum-harmony.${ctaExportFormat}`;
    a.click();
  }

  function handleStartOver() {
    if (isSyncingFrames) return;
    stopPlaybackEngine(false);
    model.resetSession();
    model.appScreen.set("setup");
  }

  const selectedSegment = findSegmentBySelection(selection);
  const canDelete = selectedSegment != null;
  const canSplit =
    selection.laneIndex != null &&
    getActiveSegmentAtTime(timelines[selection.laneIndex] ?? [], playheadSec) !=
      null;

  return (
    <Flex {...dsScreenShell} py={8}>
      <Box w="100%" maxW="980px">
        <Stack gap={6}>
          <Box>
            <Heading size="xl" color="appText">
              Final Review
            </Heading>
            <Text color="appTextMuted" fontSize="sm" mt={1}>
              Edit synced A/V tracks before exporting
            </Text>
          </Box>

          <Flex direction={{ base: "column", lg: "row" }} gap={6} align="start">
            <Box
              borderRadius="xl"
              overflow="hidden"
              bg="appMediaBg"
              w={{ base: "min(100%, 340px)", lg: "min(46%, calc(70vh * 9 / 16))" }}
              aspectRatio="9/16"
              flexShrink={0}
              mx={{ base: "auto", lg: 0 }}
            >
              <canvas
                ref={canvasRef}
                style={{ width: "100%", height: "100%", display: "block" }}
              />
            </Box>

            <Box flex="1" minW={0}>
              <Stack gap={0}>
                <Box
                  overflow="hidden"
                  {...dsPanel}
                >
                  <Flex
                    align="center"
                    justify="space-between"
                    gap={3}
                    px={3}
                    py={2}
                    borderBottomWidth="1px"
                    borderColor="appBorderMuted"
                  >
                    <Text
                      fontSize="xs"
                      fontWeight="medium"
                      color="appTextMuted"
                      letterSpacing="0.02em"
                    >
                      Tracks
                    </Text>
                    <Box
                      as="span"
                      fontSize="xs"
                      color="appTextMuted"
                      fontFamily="mono"
                      fontVariantNumeric="tabular-nums"
                    >
                      {formatTime(playheadSec)}
                      <Box as="span" color="appTextSubtle">
                        {" "}
                        / {formatTime(timelineEndSec)}
                      </Box>
                    </Box>
                  </Flex>

                  <Flex
                    gap={1.5}
                    flexWrap="wrap"
                    px={3}
                    py={2}
                    borderBottomWidth="1px"
                    borderColor="appBorderMuted"
                  >
                    <Button
                      variant={isPlaying ? "outline" : "solid"}
                      size="sm"
                      h={8}
                      px={3}
                      fontSize="xs"
                      fontWeight="medium"
                      onClick={handlePlayPause}
                      disabled={
                        exporting || isSyncingFrames || timelineEndSec <= 0
                      }
                      loading={isSyncingFrames}
                      loadingText="Syncing…"
                      borderColor={isPlaying ? dsColors.outline : dsColors.accent}
                      bg={isPlaying ? "transparent" : dsColors.accent}
                      color={isPlaying ? dsColors.textMuted : dsColors.accentForeground}
                      _hover={{
                        bg: isPlaying ? dsColors.surfaceRaised : dsColors.accentHover,
                      }}
                    >
                      {isPlaying ? "Pause" : "Play"}
                    </Button>
                    <Button
                      size="sm"
                      h={8}
                      px={3}
                      variant="outline"
                      borderColor="appBorderMuted"
                      color="appText"
                      _hover={{ bg: dsColors.surfaceRaised }}
                      fontSize="xs"
                      fontWeight="normal"
                      onClick={handleSplitAtPlayhead}
                      disabled={exporting || isSyncingFrames || !canSplit}
                    >
                      Split
                    </Button>
                    <Button
                      size="sm"
                      h={8}
                      px={3}
                      variant="outline"
                      borderColor="appBorderMuted"
                      color="appText"
                      _hover={{ bg: dsColors.surfaceRaised }}
                      fontSize="xs"
                      fontWeight="normal"
                      onClick={handleDeleteSelectedSegment}
                      disabled={exporting || isSyncingFrames || !canDelete}
                    >
                      Delete
                    </Button>
                    <Button
                      size="sm"
                      h={8}
                      px={3}
                      variant={snapToBeat ? "solid" : "outline"}
                      borderColor={snapToBeat ? dsColors.accent : dsColors.outline}
                      bg={snapToBeat ? dsColors.accent : "transparent"}
                      color={snapToBeat ? dsColors.accentForeground : dsColors.textMuted}
                      _hover={{
                        bg: snapToBeat ? dsColors.accentHover : dsColors.surfaceRaised,
                      }}
                      fontSize="xs"
                      fontWeight="normal"
                      onClick={() => model.tracks.setSnapToBeat(!snapToBeat)}
                      disabled={exporting || isPlaying || isSyncingFrames}
                    >
                      Snap {snapToBeat ? "on" : "off"}
                    </Button>
                  </Flex>

                  {(isSyncingFrames || syncWarning != null) && (
                    <Box
                      px={3}
                      py={2}
                      borderBottomWidth="1px"
                      borderColor="appBorderMuted"
                      bg="appSurfaceSubtle"
                    >
                      {isSyncingFrames && (
                        <Text color="appText" fontSize="xs">
                          Syncing frames…
                        </Text>
                      )}
                      {syncWarning != null && (
                        <Text color="appWarning" fontSize="xs">
                          {syncWarning}
                        </Text>
                      )}
                    </Box>
                  )}

                  <Flex align="stretch" minH={0}>
                    <Box
                      flexShrink={0}
                      w={`${TRACK_RAIL_WIDTH_PX}px`}
                      borderRightWidth="1px"
                      borderColor="appBorderMuted"
                      bg="appSurfaceSubtle"
                    >
                      {Array.from({ length: trackCount }).map((_, lane) => (
                        <Flex
                          key={`rail-${lane}`}
                          h={`${LANE_HEIGHT_PX}px`}
                          align="center"
                          justify="center"
                          borderBottomWidth="1px"
                          borderColor="appBorderMuted"
                          px={2}
                        >
                          <Text
                            fontSize="10px"
                            fontWeight="medium"
                            color="appTextMuted"
                            textAlign="center"
                            lineHeight="1.25"
                            textTransform="uppercase"
                            letterSpacing="0.06em"
                          >
                            {getPartLabel(lane, trackCount)}
                          </Text>
                        </Flex>
                      ))}
                    </Box>

                    <Box
                      ref={timelineViewportRef}
                      overflowX="auto"
                      overflowY="hidden"
                      flex={1}
                      minW={0}
                      bg={dsColors.surfaceSubtle}
                    >
                      <Box
                        position="relative"
                        w={`${timelineContentWidthPx}px`}
                        h={`${trackCount * LANE_HEIGHT_PX}px`}
                      >
                        {Array.from({ length: trackCount }).map((_, lane) => {
                          const track = timelines[lane] ?? [];
                          const laneRuntime =
                            model.getLaneRuntimeWaveform(lane);
                          const peaks = laneRuntime?.peaks ?? [];
                          const laneStart =
                            laneRuntime?.sourceWindow.sourceStartSec ?? 0;
                          const laneDuration =
                            laneRuntime?.sourceWindow.durationSec ?? 0;
                          const laneClass =
                            `timeline-lane ${selection.laneIndex === lane ? "is-selected-lane" : ""}` +
                            (lane % 2 === 0 ? " is-alt" : "");

                          return (
                            <Box
                              key={lane}
                              className={laneClass}
                              position="absolute"
                              left={0}
                              right={0}
                              top={`${lane * LANE_HEIGHT_PX}px`}
                              h={`${LANE_HEIGHT_PX - 1}px`}
                              onPointerDown={(e) => handleLaneClick(e, lane)}
                            >
                              {beatLineTimes.map((line, index) => (
                                <Box
                                  key={`${lane}-beat-${index}`}
                                  className="timeline-beat"
                                  left={`${line * TIMELINE_PX_PER_SEC}px`}
                                />
                              ))}

                              {track.map((segment) => {
                                const leftPx =
                                  segment.timelineStartSec *
                                  TIMELINE_PX_PER_SEC;
                                const widthPx = Math.max(
                                  8,
                                  segment.durationSec * TIMELINE_PX_PER_SEC,
                                );
                                const isSelected =
                                  selection.segmentId === segment.id;

                                const bars = Math.max(
                                  8,
                                  Math.min(220, Math.floor(widthPx / 5)),
                                );
                                const relativeSourceStart = Math.max(
                                  0,
                                  segment.sourceStartSec - laneStart,
                                );
                                const samples = samplePeaksForSegment(
                                  peaks,
                                  laneDuration,
                                  relativeSourceStart,
                                  segment.durationSec,
                                  bars,
                                );

                                return (
                                  <Box
                                    key={segment.id}
                                    className={`timeline-segment ${isSelected ? "is-selected" : ""}`}
                                    left={`${leftPx}px`}
                                    w={`${widthPx}px`}
                                    onPointerDown={(e) =>
                                      handleSegmentPointerDown(e, lane, segment)
                                    }
                                  >
                                    <Box className="segment-waveform">
                                      {samples.map((sample, idx) => (
                                        <Box
                                          key={`${segment.id}-${idx}`}
                                          className="segment-bar"
                                          h={`${Math.max(12, Math.round(sample * 100))}%`}
                                        />
                                      ))}
                                    </Box>
                                  </Box>
                                );
                              })}
                            </Box>
                          );
                        })}

                        <Box
                          className="timeline-playhead"
                          left={`${playheadSec * TIMELINE_PX_PER_SEC}px`}
                        />
                      </Box>
                    </Box>
                  </Flex>

                  <Box
                    px={3}
                    py={2.5}
                    borderTopWidth="1px"
                    borderColor="appBorderMuted"
                    bg="appSurface"
                  >
                    <input
                      type="range"
                      className="timeline-slider"
                      min={0}
                      max={Math.max(1, Math.round(timelineEndSec * 1000))}
                      step={1}
                      value={Math.round(playheadSec * 1000)}
                      onChange={(e) =>
                        handleSeek(parseInt(e.target.value, 10) / 1000)
                      }
                      disabled={
                        exporting ||
                        isPlaying ||
                        isSyncingFrames ||
                        timelineEndSec <= 0
                      }
                    />
                  </Box>
                </Box>
              </Stack>
            </Box>
          </Flex>

          <Box>
            <Text color="appTextMuted" fontSize="xs" mb={3} fontWeight="semibold">
              MIX
            </Text>
            <Stack gap={2}>
              {Array.from({ length: trackCount }).map((_, i) => (
                <Flex key={i} align="center" gap={3}>
                  <Text
                    color="appTextMuted"
                    fontSize="xs"
                    w="24"
                    flexShrink={0}
                    lineClamp={1}
                  >
                    {getPartLabel(i, trackCount)}
                  </Text>
                  <Button
                    size="xs"
                    variant="ghost"
                    color={muted[i] ? dsColors.errorText : dsColors.textSubtle}
                    bg={muted[i] ? dsColors.errorBg : "transparent"}
                    fontWeight="bold"
                    onClick={() => handleMuteToggle(i)}
                    w={7}
                    h={6}
                    minW={7}
                    p={0}
                    fontSize="11px"
                    flexShrink={0}
                    disabled={exporting || isSyncingFrames}
                  >
                    M
                  </Button>
                  <input
                    type="range"
                    className="mix-slider"
                    min={0}
                    max={150}
                    step={1}
                    value={Math.round((volumes[i] ?? 1) * 100)}
                    onChange={(e) =>
                      handleVolumeChange(i, parseInt(e.target.value, 10) / 100)
                    }
                    disabled={exporting || isSyncingFrames}
                  />
                  <Text
                    color="appTextSubtle"
                    fontSize="xs"
                    w={8}
                    textAlign="right"
                    flexShrink={0}
                  >
                    {Math.round((volumes[i] ?? 1) * 100)}%
                  </Text>
                </Flex>
              ))}

              <Flex align="center" gap={3} mt={1}>
                <Text color="appTextMuted" fontSize="xs" w="24" flexShrink={0}>
                  Reverb
                </Text>
                <Box w={7} flexShrink={0} />
                <input
                  type="range"
                  className="mix-slider"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(reverbWet * 100)}
                  onChange={(e) =>
                    handleReverbChange(parseInt(e.target.value, 10) / 100)
                  }
                  disabled={exporting || isSyncingFrames}
                />
                <Text
                  color="appTextSubtle"
                  fontSize="xs"
                  w={8}
                  textAlign="right"
                  flexShrink={0}
                >
                  {Math.round(reverbWet * 100)}%
                </Text>
              </Flex>
            </Stack>
          </Box>

          <Box>
            <Text color="appTextMuted" fontSize="xs" mb={3} fontWeight="semibold">
              REDO A PART
            </Text>
            <Grid templateColumns={`repeat(${trackCount}, 1fr)`} gap={2}>
              {Array.from({ length: trackCount }).map((_, i) => (
                <Button
                  key={i}
                  size="sm"
                  {...dsOutlineButton}
                  fontSize="xs"
                  onClick={() => handleRedoPart(i)}
                  disabled={exporting || isSyncingFrames}
                >
                  {getPartLabel(i, trackCount)}
                </Button>
              ))}
            </Grid>
          </Box>

          {exporting && (
            <Box>
              <Text color="appTextMuted" fontSize="sm" mb={2}>
                Exporting… {Math.round(exportProgress * 100)}%
              </Text>
              <Progress.Root value={exportProgress * 100} colorPalette="brand">
                <Progress.Track>
                  <Progress.Range />
                </Progress.Track>
              </Progress.Root>
            </Box>
          )}

          {exportedUrl != null ? (
            <Stack gap={3}>
              <Button {...dsPrimaryButton} size="lg" onClick={handleDownload}>
                Download {formatLabel(ctaExportFormat)}
              </Button>
              <Button
                variant="ghost"
                color="appTextMuted"
                onClick={() => {
                  model.tracks.clearExportedUrl();
                }}
              >
                Export Again
              </Button>
            </Stack>
          ) : (
            <Button
              {...dsPrimaryButton}
              size="lg"
              onClick={handleExport}
              disabled={exporting || isSyncingFrames || timelineEndSec <= 0}
              loading={exporting}
              loadingText="Exporting…"
            >
              Export {formatLabel(ctaExportFormat)}
            </Button>
          )}

          {showWebmFallbackMessage && (
            <Text color="appTextMuted" fontSize="xs" mt={-3}>
              MP4 is not supported in this browser, so export will use WebM.
            </Text>
          )}

          <Button
            variant="ghost"
            color="appTextSubtle"
            size="sm"
            onClick={handleStartOver}
            disabled={exporting || isSyncingFrames}
          >
            Start Over
          </Button>
        </Stack>
      </Box>

    </Flex>
  );
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00.00";
  const mins = Math.floor(sec / 60);
  const rem = sec - mins * 60;
  const whole = Math.floor(rem);
  const hundredths = Math.floor((rem - whole) * 100);
  return `${mins}:${String(whole).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

function formatLabel(format: "mp4" | "webm"): string {
  return format === "mp4" ? "MP4" : "WebM";
}

function formatLaneWarning(unavailableLanes: number[], trackCount: number): string {
  if (unavailableLanes.length === 0) return "";
  const labels = unavailableLanes
    .map((lane) => getPartLabel(lane, trackCount))
    .join(", ");
  return `Some lanes were not frame-ready in time and were skipped for this run: ${labels}.`;
}
