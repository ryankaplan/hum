import { Box, Button, Flex, Progress, Stack, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useObservable } from "../observable";
import {
  model,
  type TrackClip,
  type TrackRuntimeWaveform,
} from "../state/model";
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
  type ClipVolumeEnvelope,
  evaluateClipVolumeAtTime,
} from "../state/clipAutomation";
import {
  getActiveSegmentAtTime,
  getTimelineEndSec,
  samplePeaksForSegment,
} from "./timeline";
import type { EditorSelection } from "./timeline";
import {
  dsPanel,
  dsOutlineButton,
  dsPrimaryButton,
  dsScreenShell,
} from "./designSystem";
import {
  TracksEditorPanel,
  type TracksEditorCommand,
  type TracksEditorSegmentRenderAsset,
  type TracksEditorStaticView,
} from "./finalReview/tracksEditor";

const WAVEFORM_BUCKETS_PER_SEC = 72;
const TIMELINE_PX_PER_SEC = 110;
const WAVEFORM_BAR_STEP_PX = 4;
const WAVEFORM_BARS_MIN = 16;
const WAVEFORM_BARS_MAX = 960;
const SEGMENT_WAVEFORM_HORIZONTAL_PADDING_PX = 8;
const PREVIEW_CELL_POSITIONS = [
  { left: "0%", top: "0%" },
  { left: "50%", top: "0%" },
  { left: "0%", top: "50%" },
  { left: "50%", top: "50%" },
] as const;

type ActiveAudioSource = {
  source: AudioBufferSourceNode;
};

export function FinalReview() {
  const documentState = useObservable(model.tracksDocument.document);
  const editorState = useObservable(model.tracksEditor.editor);
  const exportState = useObservable(model.tracksExport);
  const exportPreferences = useObservable(model.exportPreferences);
  const arrangement = useObservable(model.arrangementDocument);
  const chords = useObservable(model.parsedChords);
  const ctx = useObservable(model.audioContext);
  const trackCount = documentState.trackOrder.length;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeVideoMaskRef = useRef<boolean[]>(
    Array.from({ length: trackCount }, () => false),
  );
  const reviewTransportRef = useRef<ReviewTransport | null>(null);
  const startRequestTokenRef = useRef(0);
  const activeSourcesRef = useRef<ActiveAudioSource[]>([]);
  const segmentRenderCacheRef = useRef<
    Map<string, { cacheKey: string; asset: TracksEditorSegmentRenderAsset }>
  >(new Map());

  const orderedTracks = useMemo(
    () =>
      documentState.trackOrder
        .map((trackId) => documentState.tracksById[trackId] ?? null)
        .filter(
          (track): track is (typeof documentState.tracksById)[string] =>
            track != null,
        ),
    [documentState],
  );
  const timelines = useMemo<TrackClip[][]>(
    () =>
      orderedTracks.map((track) =>
        track.clipIds
          .map((clipId) => documentState.clipsById[clipId] ?? null)
          .filter((clip): clip is TrackClip => clip != null),
      ),
    [documentState, orderedTracks],
  );
  const primaryRecordingIds = useMemo(
    () =>
      documentState.trackOrder.map((trackId) =>
        model.tracksDocument.getPrimaryRecordingIdForTrack(trackId),
      ),
    [documentState.clipsById, documentState.trackOrder],
  );
  const timelinesRef = useRef<TrackClip[][]>(timelines);

  const selection = editorState.selection;
  const committedPlayheadSec = editorState.playheadSec;
  const reverbWet = documentState.reverbWet;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isSyncingFrames, setIsSyncingFrames] = useState(false);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [waveformVersion, setWaveformVersion] = useState(0);

  const exporting = exportState.exporting;
  const exportProgress = exportState.progress;
  const exportedUrl = exportState.exportedUrl;
  const exportedFormat = exportState.format;
  const preferredExportFormat = useMemo(
    () => getPreferredExportFormat(exportPreferences.preferredFormat),
    [exportPreferences.preferredFormat],
  );
  const ctaExportFormat = exportedFormat ?? preferredExportFormat;
  const showWebmFallbackMessage = preferredExportFormat === "webm";

  const baseDurationSec = progressionDurationSec(chords, arrangement.tempo);
  const beatSec = arrangement.tempo > 0 ? 60 / arrangement.tempo : 0;

  const timelineEndSec = useMemo(
    () => getTimelineEndSec(timelines),
    [timelines],
  );

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
      const nextPlayheadSec = preservePlayhead
        ? model.tracksEditor.playbackPlayheadSec.get()
        : 0;
      model.tracksEditor.setPlayhead(nextPlayheadSec);
      reviewTransportRef.current?.syncPaused(nextPlayheadSec);
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
          const buffer = model.getRecordingAudioBuffer(segment.recordingId);
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
            volumeEnvelope: segment.volumeEnvelope,
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

  function findSegmentBySelection(sel: EditorSelection): TrackClip | null {
    if (sel.trackId == null || sel.clipId == null) return null;
    const trackIndex = documentState.trackOrder.indexOf(sel.trackId);
    if (trackIndex < 0) return null;
    const track = timelines[trackIndex] ?? [];
    return track.find((segment) => segment.id === sel.clipId) ?? null;
  }

  useEffect(() => {
    if (ctx == null) return;

    let cancelled = false;
    const videos: HTMLVideoElement[] = [];
    model.clearDecodedRuntimeMedia();
    model.tracksEditor.setPlayhead(0);
    model.tracksEditor.clearSelection();
    setWaveformVersion((v) => v + 1);

    for (let i = 0; i < trackCount; i++) {
      const trackId = documentState.trackOrder[i];
      const recordingId =
        trackId != null
          ? model.tracksDocument.getPrimaryRecordingIdForTrack(trackId)
          : null;
      const url =
        recordingId != null ? model.getRecordingUrl(recordingId) : null;
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.loop = false;
      video.preload = "auto";
      if (url != null) {
        video.src = url;
      }
      videos.push(video);
    }

    const mixer = createMixer(ctx, trackCount);
    for (let i = 0; i < trackCount; i++) {
      const track = orderedTracks[i];
      mixer.setTrackVolume(i, track?.volume ?? 1);
      mixer.setTrackMuted(i, track?.muted ?? false);
    }
    mixer.setReverbWet(reverbWet);
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
      const trackId = documentState.trackOrder[i];
      if (trackId == null) continue;
      const recordingId =
        model.tracksDocument.getPrimaryRecordingIdForTrack(trackId);
      if (recordingId == null) continue;
      const recording = model.tracksDocument.getRecording(recordingId);
      if (recording == null) continue;

      const videoEl = videos[i];
      if (videoEl == null) continue;

      void model
        .ingestRecordingRuntimeMedia({
          recordingId,
          trackId,
          mediaAssetId: recording.mediaAssetId,
          trimOffsetSec: Math.max(0, recording.trimOffsetSec),
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
    documentState.trackOrder,
    primaryRecordingIds,
    stopPlaybackEngine,
    trackCount,
  ]);

  useEffect(() => {
    const mixer = model.mixer;
    if (mixer == null) return;
    for (let i = 0; i < trackCount; i++) {
      const track = orderedTracks[i];
      mixer.setTrackVolume(i, track?.volume ?? 1);
      mixer.setTrackMuted(i, track?.muted ?? false);
    }
    mixer.setReverbWet(reverbWet);
  }, [orderedTracks, reverbWet, trackCount]);

  useEffect(() => {
    if (isPlaying || exporting || isSyncingFrames) return;
    reviewTransportRef.current?.syncPaused(committedPlayheadSec);
  }, [
    committedPlayheadSec,
    exporting,
    isPlaying,
    isSyncingFrames,
    timelines,
    waveformVersion,
  ]);

  useEffect(() => {
    const selected = findSegmentBySelection(selection);
    if (selected != null) return;
    model.ensureValidEditorSelection();
  }, [selection, timelines]);

  useEffect(() => {
    return () => {
      stopPlaybackEngine(false);
    };
  }, [stopPlaybackEngine]);

  async function handlePlayPause() {
    const ctx = await model.ensureAudioContext();
    if (exporting || isSyncingFrames || ctx == null) return;
    if (timelineEndSec <= 0) return;

    if (isPlaying) {
      stopPlaybackEngine(true);
      return;
    }

    const startTimelineSec =
      committedPlayheadSec >= timelineEndSec ? 0 : committedPlayheadSec;
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
      model.tracksEditor.setPlayhead(startTimelineSec);
      startAudioFromTimeline(startCtxTime, startTimelineSec, timelineEndSec);

      transport.startRun({
        mode: "preview",
        startCtxTimeSec: startCtxTime,
        startTimelineSec,
        endTimelineSec: timelineEndSec,
        onTick: (timelineSec) => {
          model.tracksEditor.setPlaybackPlayhead(timelineSec);
        },
        onEnded: () => {
          stopAudio();
          setIsPlaying(false);
          model.tracksEditor.setPlayhead(timelineEndSec);
        },
      });
      model.tracksEditor.setPlaybackPlayhead(startTimelineSec);
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
        if (selection.trackId == null) return;
        if (isPlaying) stopPlaybackEngine(true);
        model.splitSelectedClipAtPlayhead();
        return;
      }
      case "delete_selected": {
        if (exporting || isSyncingFrames) return;
        if (selection.trackId == null || selection.clipId == null) return;
        if (isPlaying) stopPlaybackEngine(true);
        model.deleteSelectedClip();
        return;
      }
      case "select_lane": {
        if (exporting || isSyncingFrames || isPlaying) return;
        model.tracksEditor.setSelection({
          trackId: command.trackId,
          clipId: selection.clipId,
        });
        model.tracksEditor.setPlayhead(command.timelineSec);
        return;
      }
      case "select_segment": {
        if (exporting || isSyncingFrames || isPlaying) return;
        model.tracksEditor.setSelection({
          trackId: command.trackId,
          clipId: command.clipId,
        });
        return;
      }
      case "move_segment": {
        if (exporting || isSyncingFrames || isPlaying) return;
        model.tracksDocument.moveClip(
          command.trackId,
          command.clipId,
          command.desiredStartSec,
        );
        return;
      }
      case "apply_volume_brush": {
        if (exporting || isSyncingFrames || isPlaying) return;
        model.tracksDocument.applyClipVolumeBrush({
          trackId: command.trackId,
          clipId: command.clipId,
          centerSec: command.centerSec,
          deltaGainMultiplier: command.deltaGainMultiplier,
          radiusSec: command.radiusSec,
        });
        return;
      }
      case "seek": {
        if (isPlaying || exporting || isSyncingFrames) return;
        const next = Math.max(0, Math.min(command.valueSec, timelineEndSec));
        model.tracksEditor.setPlayhead(next);
        return;
      }
      case "set_lane_volume": {
        model.tracksDocument.setTrackVolume(command.trackId, command.value);
        return;
      }
      case "toggle_lane_mute": {
        const track = documentState.tracksById[command.trackId];
        if (track == null) return;
        model.tracksDocument.setTrackMuted(command.trackId, !track.muted);
        return;
      }
      default:
        return;
    }
  }

  function handleReverbChange(wet: number) {
    model.tracksDocument.setReverbWet(wet);
  }

  function handleRedoPart(index: number) {
    if (isSyncingFrames) return;
    stopPlaybackEngine(false);
    model.redoPart(index);
  }

  async function handleExport() {
    const ctx = await model.ensureAudioContext();
    const mixer = model.mixer;
    if (ctx == null || canvasRef.current == null || mixer == null) return;
    if (isSyncingFrames) return;
    if (timelineEndSec <= 0) return;

    stopPlaybackEngine(false);
    model.beginExport();
    setSyncWarning(null);
    const requestToken = startRequestTokenRef.current + 1;
    startRequestTokenRef.current = requestToken;
    setIsSyncingFrames(true);

    try {
      const unavailableLanes = await primeTransportForRun(0);
      if (startRequestTokenRef.current !== requestToken) return;
      const transport = reviewTransportRef.current;
      if (transport == null) {
        model.failOrResetExport();
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
          model.tracksEditor.setPlaybackPlayhead(timelineSec);
        },
        onEnded: () => {
          model.tracksEditor.setPlayhead(timelineEndSec);
        },
      });

      const result = await exportVideo({
        canvas: canvasRef.current,
        audioContext: ctx,
        mixer,
        durationMs: timelineEndSec * 1000,
        onProgress: (progress) => model.updateExportProgress(progress),
      });

      const nextUrl = URL.createObjectURL(result.blob);
      model.completeExport({
        url: nextUrl,
        format: result.format,
        mimeType: result.mimeType,
      });
    } catch (err) {
      console.error("Export failed", err);
      model.failOrResetExport();
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
    if (
      !window.confirm(
        "Start over? This will discard the current review session.",
      )
    ) {
      return;
    }
    stopPlaybackEngine(false);
    model.resetSession();
    model.appScreen.set("setup");
  }

  const selectedSegment = findSegmentBySelection(selection);
  const canDelete = selectedSegment != null;
  const canSplit =
    selection.trackId != null &&
    getActiveSegmentAtTime(
      timelines[documentState.trackOrder.indexOf(selection.trackId)] ?? [],
      committedPlayheadSec,
    ) != null;

  const tracksEditorView = useMemo<TracksEditorStaticView>(() => {
    const activeClipIds = new Set<string>();
    const lanes = orderedTracks.map((track, displayIndex) => {
      const laneRuntime = model.getTrackRuntimeWaveform(track.id);
      const segments = (timelines[displayIndex] ?? []).map((segment) => {
        activeClipIds.add(segment.id);
        return {
          ...segment,
          renderAsset: getCachedSegmentRenderAsset({
            cache: segmentRenderCacheRef.current,
            clip: segment,
            laneRuntime,
            waveformVersion,
          }),
        };
      });

      return {
        trackId: track.id,
        displayIndex,
        label: getPartLabel(displayIndex, trackCount),
        segments,
        volume: track.volume,
        muted: track.muted,
      };
    });

    for (const clipId of segmentRenderCacheRef.current.keys()) {
      if (!activeClipIds.has(clipId)) {
        segmentRenderCacheRef.current.delete(clipId);
      }
    }

    return {
      lanes,
      selection,
      timelineEndSec,
      beatLineTimes,
      beatSec,
      reverbWet,
      exporting,
      isPlaying,
      isSyncingFrames,
      syncWarning,
      canSplit,
      canDelete,
    };
  }, [
    beatLineTimes,
    beatSec,
    canDelete,
    canSplit,
    exporting,
    isPlaying,
    isSyncingFrames,
    orderedTracks,
    reverbWet,
    selection,
    syncWarning,
    timelineEndSec,
    timelines,
    trackCount,
    waveformVersion,
  ]);

  return (
    <Flex {...dsScreenShell} py={8}>
      <Box w="100%" maxW="1100px">
        <Box position="fixed" top={4} left={0} right={0} zIndex={30} px={4}>
          <Box
            maxW="1100px"
            mx="auto"
            {...dsPanel}
            px={{ base: 3, md: 4 }}
            py={3}
          >
            <Flex
              direction={{ base: "column", md: "row" }}
              align={{ base: "stretch", md: "center" }}
              justify="space-between"
              gap={3}
            >
              <Text
                color="appAccent"
                fontSize={{ base: "2rem", md: "2.2rem" }}
                lineHeight="0.95"
                letterSpacing="-0.02em"
                fontFamily="'Quicksand', 'Manrope', 'Avenir Next', sans-serif"
                fontWeight="500"
              >
                hum
              </Text>

              <Flex
                direction={{ base: "column", sm: "row" }}
                align={{ base: "stretch", sm: "center" }}
                justify="end"
                gap={2.5}
                flexShrink={0}
              >
                {showWebmFallbackMessage && (
                  <Text color="appTextMuted" fontSize="xs" alignSelf="center">
                    Export will use WebM in this browser.
                  </Text>
                )}

                {exporting && (
                  <Box minW={{ base: "100%", sm: "180px" }} alignSelf="center">
                    <Text
                      color="appText"
                      fontSize="xs"
                      fontWeight="medium"
                      mb={1.5}
                    >
                      Exporting... {Math.round(exportProgress * 100)}%
                    </Text>
                    <Progress.Root
                      value={exportProgress * 100}
                      colorPalette="brand"
                    >
                      <Progress.Track>
                        <Progress.Range />
                      </Progress.Track>
                    </Progress.Root>
                  </Box>
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

                {exportedUrl != null ? (
                  <>
                    <Button
                      {...dsOutlineButton}
                      size="lg"
                      onClick={() => {
                        model.clearExportedUrl();
                      }}
                    >
                      Export Again
                    </Button>
                    <Button
                      {...dsPrimaryButton}
                      size="lg"
                      onClick={handleDownload}
                    >
                      Download {formatLabel(ctaExportFormat)}
                    </Button>
                  </>
                ) : (
                  <Button
                    {...dsPrimaryButton}
                    size="lg"
                    onClick={handleExport}
                    disabled={
                      exporting || isSyncingFrames || timelineEndSec <= 0
                    }
                    loading={exporting}
                    loadingText="Exporting..."
                  >
                    Export {formatLabel(ctaExportFormat)}
                  </Button>
                )}
              </Flex>
            </Flex>
          </Box>
        </Box>

        <Stack gap={6} pt={{ base: 28, md: 24 }}>
          <Flex direction={{ base: "column", lg: "row" }} gap={6} align="start">
            <Box
              position="relative"
              borderRadius="2xl"
              overflow="hidden"
              bg="appMediaBg"
              border="1px solid"
              borderColor="appBorder"
              boxShadow="0 10px 24px color-mix(in srgb, var(--app-text) 14%, transparent)"
              w={{
                base: "min(100%, 340px)",
                lg: "min(46%, calc(70vh * 9 / 16))",
              }}
              aspectRatio="9/16"
              flexShrink={0}
              mx={{ base: "auto", lg: 0 }}
            >
              <canvas
                ref={canvasRef}
                style={{ width: "100%", height: "100%", display: "block" }}
              />

              {documentState.trackOrder.slice(0, 4).map((_, i) => {
                const placement = PREVIEW_CELL_POSITIONS[i];
                if (placement == null) return null;
                return (
                  <Box
                    key={`redo-overlay-${i}`}
                    position="absolute"
                    left={placement.left}
                    top={placement.top}
                    w="50%"
                    h="50%"
                    p={3}
                    display="flex"
                    alignItems="flex-end"
                    justifyContent="center"
                    pointerEvents="none"
                  >
                    <Button
                      size="xs"
                      borderRadius="full"
                      bg="rgba(12, 12, 14, 0.3)"
                      color="white"
                      border="1px solid"
                      borderColor="rgba(255, 255, 255, 0.1)"
                      backdropFilter="blur(4px)"
                      boxShadow="0 8px 18px rgba(0, 0, 0, 0.2)"
                      fontSize="xs"
                      fontWeight="medium"
                      h={8}
                      minW="72px"
                      px={3}
                      pointerEvents="auto"
                      onClick={() => handleRedoPart(i)}
                      disabled={exporting || isSyncingFrames}
                      _hover={{ bg: "rgba(12, 12, 14, 0.45)" }}
                    >
                      Edit
                    </Button>
                  </Box>
                );
              })}
            </Box>

            <Box flex="1" minW={0}>
              <TracksEditorPanel
                view={tracksEditorView}
                playhead={model.tracksEditor.playbackPlayheadSec}
                onPlayPause={handlePlayPause}
                onCommand={handleTracksCommand}
                onReverbChange={handleReverbChange}
              />
            </Box>
          </Flex>
        </Stack>
      </Box>
    </Flex>
  );
}

function getCachedSegmentRenderAsset(input: {
  cache: Map<
    string,
    { cacheKey: string; asset: TracksEditorSegmentRenderAsset }
  >;
  clip: TrackClip;
  laneRuntime: TrackRuntimeWaveform;
  waveformVersion: number;
}): TracksEditorSegmentRenderAsset {
  const { cache, clip, laneRuntime, waveformVersion } = input;
  const widthPx = Math.max(8, clip.durationSec * TIMELINE_PX_PER_SEC);
  const waveformWidthPx = Math.max(
    0,
    widthPx - SEGMENT_WAVEFORM_HORIZONTAL_PADDING_PX,
  );
  const waveformBarCount = Math.max(
    WAVEFORM_BARS_MIN,
    Math.min(
      WAVEFORM_BARS_MAX,
      Math.round(waveformWidthPx / WAVEFORM_BAR_STEP_PX),
    ),
  );
  const waveformKey =
    laneRuntime == null
      ? "none"
      : `${laneRuntime.recordingId}:${laneRuntime.sourceWindow.sourceStartSec}:${laneRuntime.sourceWindow.durationSec}:${waveformVersion}`;
  const cacheKey = [
    clip.timelineStartSec,
    clip.sourceStartSec,
    clip.durationSec,
    clip.volumeEnvelopeRevision,
    waveformBarCount,
    waveformKey,
  ].join("|");
  const cached = cache.get(clip.id);
  if (cached?.cacheKey === cacheKey) {
    return cached.asset;
  }

  const waveformBarHeights =
    laneRuntime == null
      ? []
      : samplePeaksForSegment(
          laneRuntime.peaks,
          laneRuntime.sourceWindow.durationSec,
          Math.max(
            0,
            clip.sourceStartSec - laneRuntime.sourceWindow.sourceStartSec,
          ),
          clip.durationSec,
          waveformBarCount,
        ).map((sample) => Math.max(12, Math.round(sample * 100)));

  const asset: TracksEditorSegmentRenderAsset = {
    leftPx: clip.timelineStartSec * TIMELINE_PX_PER_SEC,
    widthPx,
    waveformBarHeights,
    volumeLinePoints: buildVolumePolylinePoints(
      clip.volumeEnvelope,
      clip.durationSec,
    ),
  };
  cache.set(clip.id, { cacheKey, asset });
  return asset;
}

function buildVolumePolylinePoints(
  volumeEnvelope: ClipVolumeEnvelope,
  durationSec: number,
): string {
  if (durationSec <= 0) return "0,50";
  const sorted = [...volumeEnvelope.points].sort(
    (a, b) => a.timeSec - b.timeSec,
  );
  return sorted
    .map((point) => {
      const x = clamp((point.timeSec / durationSec) * 100, 0, 100);
      const y = clamp((1 - point.gainMultiplier / 2) * 100, 2, 98);
      return `${x},${y}`;
    })
    .join(" ");
}

function scheduleClipVolumeGain(input: {
  gain: AudioParam;
  volumeEnvelope: ClipVolumeEnvelope;
  segmentDurationSec: number;
  segmentStartSec: number;
  playDurationSec: number;
  startAtSec: number;
}): void {
  const {
    gain,
    volumeEnvelope,
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

  const startGainMultiplier = evaluateClipVolumeAtTime(
    volumeEnvelope,
    localStartSec,
    segmentDurationSec,
  );
  gain.setValueAtTime(startGainMultiplier, startAtSec);

  for (const point of volumeEnvelope.points) {
    if (point.timeSec <= localStartSec || point.timeSec >= localEndSec)
      continue;
    gain.linearRampToValueAtTime(
      point.gainMultiplier,
      startAtSec + (point.timeSec - localStartSec),
    );
  }

  const endGainMultiplier = evaluateClipVolumeAtTime(
    volumeEnvelope,
    localEndSec,
    segmentDurationSec,
  );
  gain.linearRampToValueAtTime(endGainMultiplier, startAtSec + playDurationSec);
}

function formatLabel(format: "mp4" | "webm"): string {
  return format === "mp4" ? "MP4" : "WebM";
}

function formatLaneWarning(
  unavailableLanes: number[],
  trackCount: number,
): string {
  if (unavailableLanes.length === 0) return "";
  const labels = unavailableLanes
    .map((lane) => getPartLabel(lane, trackCount))
    .join(", ");
  return `Some lanes were not frame-ready in time and were skipped for this run: ${labels}.`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
