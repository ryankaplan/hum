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
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useObservable } from "../observable";
import { model, type TrackClip } from "../state/model";
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
  type ClipAutomationLane,
  evaluateAutomationLaneAtTime,
  getVolumeAutomationLane,
} from "../state/clipAutomation";
import {
  getActiveSegmentAtTime,
  getTimelineEndSec,
} from "./timeline";
import type {
  EditorSelection,
} from "./timeline";
import {
  dsOutlineButton,
  dsPrimaryButton,
  dsScreenShell,
} from "./designSystem";
import {
  TracksEditorPanel,
  type TracksEditorCommand,
  type TracksEditorView,
} from "./finalReview/tracksEditor";

const WAVEFORM_BUCKETS_PER_SEC = 72;

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

  const videoRefs = useRef<(HTMLVideoElement | null)[]>(
    Array.from({ length: trackCount }, () => null),
  );
  const activeVideoMaskRef = useRef<boolean[]>(
    Array.from({ length: trackCount }, () => false),
  );
  const reviewTransportRef = useRef<ReviewTransport | null>(null);
  const startRequestTokenRef = useRef(0);

  const activeSourcesRef = useRef<ActiveAudioSource[]>([]);

  const timelines = useMemo<TrackClip[][]>(
    () => tracksState.lanes.map((lane) => lane.clips),
    [tracksState],
  );
  const timelinesRef = useRef<TrackClip[][]>(timelines);

  const selection = tracksState.editor.selection;
  const playheadSec = tracksState.editor.playheadSec;
  const snapToBeat = tracksState.editor.snapToBeat;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isSyncingFrames, setIsSyncingFrames] = useState(false);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);

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
        const track = timelinesRef.current[lane];
        if (track == null) continue;

        for (const segment of track) {
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
          const clipGain = ctx.createGain();
          source.buffer = buffer;

          const startAt = startCtxTime + (playFrom - startTimelineSec);
          const localSegmentStartSec = Math.max(0, playFrom - segStart);
          scheduleClipVolumeGain({
            gain: clipGain.gain,
            lane: getVolumeAutomationLane(segment.automation, segment.durationSec),
            segmentDurationSec: segment.durationSec,
            segmentStartSec: localSegmentStartSec,
            playDurationSec: cappedDuration,
            startAtSec: startAt,
          });

          source.connect(clipGain);
          model.mixer.connectSource(lane, clipGain);
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
  ): TrackClip | null {
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
          waveformBucketsPerSec: WAVEFORM_BUCKETS_PER_SEC,
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

  function handleTracksCommand(command: TracksEditorCommand) {
    switch (command.type) {
      case "split_selected": {
        if (exporting || isSyncingFrames) return;
        if (selection.laneIndex == null) return;
        if (isPlaying) stopPlaybackEngine(true);
        model.tracks.splitSelectedClipAtPlayhead();
        return;
      }
      case "delete_selected": {
        if (exporting || isSyncingFrames) return;
        if (selection.laneIndex == null || selection.segmentId == null) return;
        if (isPlaying) stopPlaybackEngine(true);
        model.tracks.deleteSelectedClip();
        return;
      }
      case "toggle_snap": {
        if (exporting || isPlaying || isSyncingFrames) return;
        model.tracks.setSnapToBeat(!snapToBeat);
        return;
      }
      case "select_lane": {
        if (exporting || isSyncingFrames || isPlaying) return;
        model.tracks.setSelection({
          laneIndex: command.laneIndex,
          segmentId: selection.segmentId,
        });
        model.tracks.setPlayhead(command.timelineSec);
        return;
      }
      case "select_segment": {
        if (exporting || isSyncingFrames || isPlaying) return;
        model.tracks.setSelection({
          laneIndex: command.laneIndex,
          segmentId: command.segmentId,
        });
        return;
      }
      case "move_segment": {
        if (exporting || isSyncingFrames || isPlaying) return;
        model.tracks.moveClip(
          command.laneIndex,
          command.segmentId,
          command.desiredStartSec,
        );
        return;
      }
      case "apply_volume_brush": {
        if (exporting || isSyncingFrames || isPlaying) return;
        model.tracks.applyClipAutomationBrush({
          laneIndex: command.laneIndex,
          clipId: command.segmentId,
          param: "volume",
          centerSec: command.centerSec,
          deltaValue: command.deltaValue,
          radiusSec: command.radiusSec,
        });
        return;
      }
      case "seek": {
        if (isPlaying || exporting || isSyncingFrames) return;
        const next = Math.max(0, Math.min(command.valueSec, timelineEndSec));
        model.tracks.setPlayhead(next);
        return;
      }
      case "set_lane_volume": {
        model.tracks.setTrackVolume(command.laneIndex, command.value);
        return;
      }
      case "toggle_lane_mute": {
        const nextMuted = !(muted[command.laneIndex] ?? false);
        model.tracks.setTrackMuted(command.laneIndex, nextMuted);
        return;
      }
      default:
        return;
    }
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
  const tracksEditorView = useMemo<TracksEditorView>(() => {
    return {
      lanes: timelines.map((segments, laneIndex) => {
        const laneRuntime = model.getLaneRuntimeWaveform(laneIndex);
        return {
          laneIndex,
          label: getPartLabel(laneIndex, trackCount),
          segments,
          peaks: laneRuntime?.peaks ?? [],
          sourceStartSec: laneRuntime?.sourceWindow.sourceStartSec ?? 0,
          sourceDurationSec: laneRuntime?.sourceWindow.durationSec ?? 0,
          volume: volumes[laneIndex] ?? 1,
          muted: muted[laneIndex] ?? false,
        };
      }),
      selection,
      playheadSec,
      timelineEndSec,
      beatLineTimes,
      snapToBeat,
      beatSec,
      exporting,
      isPlaying,
      isSyncingFrames,
      syncWarning,
      canSplit,
      canDelete,
    };
  }, [
    timelines,
    trackCount,
    volumes,
    muted,
    selection,
    playheadSec,
    timelineEndSec,
    beatLineTimes,
    snapToBeat,
    beatSec,
    exporting,
    isPlaying,
    isSyncingFrames,
    syncWarning,
    canSplit,
    canDelete,
  ]);

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
              <TracksEditorPanel
                view={tracksEditorView}
                onPlayPause={handlePlayPause}
                onCommand={handleTracksCommand}
              />
            </Box>
          </Flex>

          <Box>
            <Text color="appTextMuted" fontSize="xs" mb={3} fontWeight="semibold">
              MIX
            </Text>
            <Stack gap={2}>
              <Flex align="center" gap={3} mt={1}>
                <Text color="appTextMuted" fontSize="xs" w="24" flexShrink={0}>
                  Reverb
                </Text>
                <Box w={2} flexShrink={0} />
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

function scheduleClipVolumeGain(input: {
  gain: AudioParam;
  lane: ClipAutomationLane;
  segmentDurationSec: number;
  segmentStartSec: number;
  playDurationSec: number;
  startAtSec: number;
}): void {
  const {
    gain,
    lane,
    segmentDurationSec,
    segmentStartSec,
    playDurationSec,
    startAtSec,
  } = input;
  if (playDurationSec <= 0) return;

  const localStartSec = clamp(segmentStartSec, 0, segmentDurationSec);
  const localEndSec = clamp(
    segmentStartSec + playDurationSec,
    0,
    segmentDurationSec,
  );

  const startValue = evaluateAutomationLaneAtTime(
    lane,
    localStartSec,
    segmentDurationSec,
  );
  gain.setValueAtTime(startValue, startAtSec);

  for (const point of lane.points) {
    if (point.timeSec <= localStartSec || point.timeSec >= localEndSec) continue;
    gain.linearRampToValueAtTime(
      point.value,
      startAtSec + (point.timeSec - localStartSec),
    );
  }

  const endValue = evaluateAutomationLaneAtTime(
    lane,
    localEndSec,
    segmentDurationSec,
  );
  gain.linearRampToValueAtTime(endValue, startAtSec + playDurationSec);
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
