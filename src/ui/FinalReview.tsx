import { Box, Button, Flex, Progress, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useObservable } from "../observable";
import {
  model,
  type RecordingRuntimeWaveform,
  type TrackClip,
} from "../state/model";
import { getPartLabel } from "../music/types";
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
import {
  FINAL_REVIEW_WAVEFORM_BARS_MAX,
  FINAL_REVIEW_WAVEFORM_BARS_MIN,
  FINAL_REVIEW_WAVEFORM_BUCKETS_PER_SEC,
  computeFinalReviewWaveformBarCount,
} from "./waveformRendering";
import type { EditorSelection } from "./timeline";
import {
  dsColors,
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

const TIMELINE_PX_PER_SEC = 110;
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
  const hasAnyTakes = primaryRecordingIds.some(
    (recordingId) => recordingId != null,
  );
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
          mediaAssetId: recording.mediaAssetId,
          ctx,
          videoEl,
          waveformBucketsPerSec: FINAL_REVIEW_WAVEFORM_BUCKETS_PER_SEC,
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
        const trackIndex = documentState.trackOrder.indexOf(command.trackId);
        if (trackIndex >= 0) {
          model.currentPartIndex.set(trackIndex);
        }
        model.tracksEditor.setSelection({
          trackId: command.trackId,
          clipId: selection.clipId,
        });
        model.tracksEditor.setPlayhead(command.timelineSec);
        return;
      }
      case "select_segment": {
        if (exporting || isSyncingFrames || isPlaying) return;
        const trackIndex = documentState.trackOrder.indexOf(command.trackId);
        if (trackIndex >= 0) {
          model.currentPartIndex.set(trackIndex);
        }
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
    model.openRecordingForPart(index);
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
      const segments = (timelines[displayIndex] ?? []).map((segment) => {
        activeClipIds.add(segment.id);
        return {
          ...segment,
          renderAsset: getCachedSegmentRenderAsset({
            cache: segmentRenderCacheRef.current,
            clip: segment,
            recordingRuntime: model.getRecordingRuntimeWaveform(
              segment.recordingId,
            ),
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
    <Flex
      {...dsScreenShell}
      h="100dvh"
      minH="100dvh"
      py={0}
      px={0}
      align="stretch"
      justify="stretch"
      overflow="hidden"
    >
      <Box
        w="100%"
        h="100dvh"
        overflow="hidden"
        {...dsPanel}
        borderRadius="none"
        borderLeftWidth="0"
        borderRightWidth="0"
        borderTopWidth="0"
        boxShadow="none"
      >
        <Flex direction="column" h="100%" minH={0}>
          <Box
            px={{ base: 3, md: 4 }}
            py={{ base: 3, md: 3.5 }}
            borderBottom="1px solid"
            borderColor={dsColors.border}
            bg={dsColors.surface}
          >
            <Flex
              direction={{ base: "column", xl: "row" }}
              align={{ base: "stretch", xl: "center" }}
              justify="space-between"
              gap={3}
            >
              <Box>
                <Flex
                  align={{ base: "flex-start", sm: "center" }}
                  gap={{ base: 2, sm: 3 }}
                  flexWrap="wrap"
                >
                  <Text
                    color={dsColors.text}
                    fontSize="lg"
                    fontWeight="semibold"
                    lineHeight="1"
                    letterSpacing="-0.01em"
                  >
                    Hum
                  </Text>
                  <Box
                    w="1px"
                    h="20px"
                    bg="color-mix(in srgb, var(--app-border-muted) 55%, transparent)"
                    display={{ base: "none", sm: "block" }}
                  />
                  <Text
                    color={dsColors.textMuted}
                    fontSize="xs"
                    fontWeight="semibold"
                    letterSpacing="0.08em"
                  >
                    VIDEO EDITOR
                  </Text>
                </Flex>
                <Text color={dsColors.textMuted} fontSize="sm" mt={1}>
                  {hasAnyTakes
                    ? "Record new takes from the video grid, then trim and balance tracks below."
                    : "Start with any part. Each recorded take comes straight back here for editing."}
                </Text>
              </Box>

              <Flex
                direction={{ base: "column", md: "row" }}
                align={{ base: "stretch", md: "center" }}
                justify="end"
                gap={2.5}
                flexShrink={0}
              >
                {showWebmFallbackMessage && (
                  <Text
                    color={dsColors.textMuted}
                    fontSize="xs"
                    alignSelf="center"
                  >
                    Export will use WebM in this browser.
                  </Text>
                )}

                {exporting && (
                  <Box minW={{ base: "100%", md: "220px" }} alignSelf="center">
                    <Text
                      color={dsColors.text}
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

          <Flex
            direction={{ base: "column", lg: "row" }}
            gap={0}
            flex="1"
            minH={0}
          >
            <Box
              flex={{ base: "0 0 auto", lg: "0 0 42%" }}
              minW={0}
              minH={{ base: "320px", lg: 0 }}
              borderRight={{ base: "0", lg: "1px solid" }}
              borderBottom={{ base: "1px solid", lg: "0" }}
              borderColor={dsColors.border}
              bg="transparent"
            >
              <Box
                display="flex"
                alignItems="center"
                justifyContent="center"
                h="100%"
                minH={{ base: "320px", md: "420px", lg: "100%" }}
                p={{ base: 4, md: 5 }}
                overflow="hidden"
                bg="transparent"
              >
                <Box
                  position="relative"
                  w="100%"
                  h="100%"
                  maxW={{
                    base: "min(100%, 340px)",
                    lg: "min(100%, calc((100dvh - 140px) * 9 / 16))",
                  }}
                  maxH="100%"
                  aspectRatio="9/16"
                  borderRadius="2xl"
                  overflow="hidden"
                  bg="transparent"
                  border="1px solid"
                  borderColor={dsColors.border}
                  boxShadow="0 10px 28px color-mix(in srgb, var(--app-text) 10%, transparent), 0 2px 10px color-mix(in srgb, var(--app-text) 6%, transparent)"
                >
                  <canvas
                    ref={canvasRef}
                    style={{ width: "100%", height: "100%", display: "block" }}
                  />
                  <PreviewOverlay
                    trackOrder={documentState.trackOrder}
                    primaryRecordingIds={primaryRecordingIds}
                    selectedTrackId={selection.trackId}
                    onSelectPart={(index) => {
                      const trackId = documentState.trackOrder[index];
                      if (trackId == null) return;
                      const clipId =
                        model.tracksDocument.getOrderedClipsForTrack(trackId)[0]
                          ?.id ?? null;
                      model.currentPartIndex.set(index);
                      model.tracksEditor.setSelection({ trackId, clipId });
                    }}
                    onRecordPart={handleRedoPart}
                    disabled={exporting || isSyncingFrames}
                  />
                </Box>
              </Box>
            </Box>

            <Box flex="1" minW={0} minH={0}>
              <TracksEditorPanel
                view={tracksEditorView}
                playhead={model.tracksEditor.playbackPlayheadSec}
                onPlayPause={handlePlayPause}
                onCommand={handleTracksCommand}
                onReverbChange={handleReverbChange}
              />
            </Box>
          </Flex>
        </Flex>
      </Box>
    </Flex>
  );
}

function PreviewOverlay(input: {
  trackOrder: string[];
  primaryRecordingIds: Array<string | null>;
  selectedTrackId: string | null;
  onSelectPart: (index: number) => void;
  onRecordPart: (index: number) => void;
  disabled: boolean;
}) {
  const {
    trackOrder,
    primaryRecordingIds,
    selectedTrackId,
    onSelectPart,
    onRecordPart,
    disabled,
  } = input;

  return (
    <>
      {trackOrder.slice(0, 4).map((trackId, index) => {
        const placement = PREVIEW_CELL_POSITIONS[index];
        if (placement == null) return null;
        const hasTake = primaryRecordingIds[index] != null;
        const isSelected = selectedTrackId === trackId;

        return (
          <Box
            key={`preview-tile-${trackId}`}
            position="absolute"
            left={placement.left}
            top={placement.top}
            w="50%"
            h="50%"
            p={{ base: 2.5, md: 3 }}
            pointerEvents="none"
          >
            <Flex
              direction="column"
              justify="space-between"
              w="100%"
              h="100%"
              p={{ base: 2.5, md: 3 }}
              borderRadius="2xl"
              border="1px solid"
              borderColor={
                hasTake
                  ? "transparent"
                  : isSelected
                  ? "color-mix(in srgb, var(--app-accent) 78%, white 22%)"
                  : "rgba(255, 255, 255, 0.22)"
              }
              bg="transparent"
              boxShadow={
                !hasTake && isSelected
                  ? "0 0 0 1px color-mix(in srgb, var(--app-accent) 42%, transparent), 0 24px 44px rgba(93, 69, 48, 0.18)"
                  : "none"
              }
              pointerEvents="auto"
              onClick={() => onSelectPart(index)}
              style={{ cursor: "pointer" }}
            >
              <Flex justify="space-between" align="flex-start" gap={2}>
                <Box>
                  <Text
                    color="white"
                    fontSize={{ base: "sm", md: "md" }}
                    fontWeight="semibold"
                    letterSpacing="-0.01em"
                    textShadow="0 2px 12px rgba(0, 0, 0, 0.28)"
                  >
                    {getPartLabel(index, trackOrder.length)}
                  </Text>
                  <Text
                    color="rgba(255,255,255,0.78)"
                    fontSize="10px"
                    fontWeight="semibold"
                    letterSpacing="0.08em"
                    textTransform="uppercase"
                    mt={0.5}
                    textShadow="0 2px 10px rgba(0, 0, 0, 0.24)"
                  >
                    {hasTake ? "Take ready" : "No take yet"}
                  </Text>
                </Box>
                <Box />
              </Flex>

              <Flex justify="flex-start">
                <Button
                  size="sm"
                  borderRadius="full"
                  bg={
                    hasTake
                      ? "rgba(20, 20, 24, 0.56)"
                      : "rgba(255,255,255,0.88)"
                  }
                  color={
                    hasTake
                      ? "white"
                      : "color-mix(in srgb, var(--app-text) 90%, black 10%)"
                  }
                  border="1px solid"
                  borderColor={
                    hasTake
                      ? "rgba(255,255,255,0.24)"
                      : "color-mix(in srgb, var(--app-border) 45%, white 55%)"
                  }
                  boxShadow="0 8px 18px rgba(0, 0, 0, 0.16)"
                  px={4}
                  h={9}
                  fontSize="sm"
                  fontWeight="semibold"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRecordPart(index);
                  }}
                  disabled={disabled}
                  _hover={{
                    bg: hasTake
                      ? "rgba(20, 20, 24, 0.68)"
                      : "rgba(255,255,255,0.96)",
                  }}
                >
                  {hasTake ? "Redo" : "Record"}
                </Button>
              </Flex>
            </Flex>
          </Box>
        );
      })}
    </>
  );
}

function getCachedSegmentRenderAsset(input: {
  cache: Map<
    string,
    { cacheKey: string; asset: TracksEditorSegmentRenderAsset }
  >;
  clip: TrackClip;
  recordingRuntime: RecordingRuntimeWaveform;
  waveformVersion: number;
}): TracksEditorSegmentRenderAsset {
  const { cache, clip, recordingRuntime, waveformVersion } = input;
  const widthPx = Math.max(8, clip.durationSec * TIMELINE_PX_PER_SEC);
  const waveformWidthPx = Math.max(
    0,
    widthPx - SEGMENT_WAVEFORM_HORIZONTAL_PADDING_PX,
  );
  const waveformBarCount = Math.max(
    FINAL_REVIEW_WAVEFORM_BARS_MIN,
    Math.min(
      FINAL_REVIEW_WAVEFORM_BARS_MAX,
      computeFinalReviewWaveformBarCount(waveformWidthPx),
    ),
  );
  const waveformKey =
    recordingRuntime == null
      ? "none"
      : `${clip.recordingId}:${recordingRuntime.sourceWindow.sourceStartSec}:${recordingRuntime.sourceWindow.durationSec}:${waveformVersion}`;
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
    recordingRuntime == null
      ? []
      : samplePeaksForSegment(
          recordingRuntime.peaks,
          recordingRuntime.sourceWindow.durationSec,
          Math.max(
            0,
            clip.sourceStartSec - recordingRuntime.sourceWindow.sourceStartSec,
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
