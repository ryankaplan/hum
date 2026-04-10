import { Box, Button, Flex, Progress, Text } from "@chakra-ui/react";
import { useEffect, useMemo, useRef } from "react";
import { useObservable } from "../observable";
import { acquirePermissionsAndStart } from "../recording/permissions";
import {
  model,
  type RecordingRuntimeWaveform,
  type TrackClip,
} from "../state/model";
import { getPartLabel } from "../music/types";
import { getPreferredExportFormat } from "../video/exporter";
import { type ClipVolumeEnvelope } from "../state/clipAutomation";
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
import { useFinalReviewRuntimeController } from "./FinalReviewRuntimeController";

const TIMELINE_PX_PER_SEC = 110;
const SEGMENT_WAVEFORM_HORIZONTAL_PADDING_PX = 8;
const PREVIEW_CELL_POSITIONS = [
  { left: "0%", top: "0%" },
  { left: "50%", top: "0%" },
  { left: "0%", top: "50%" },
  { left: "50%", top: "50%" },
] as const;

export function FinalReview() {
  const documentState = useObservable(model.tracksDocument.document);
  const editorState = useObservable(model.tracksEditor.editor);
  const exportState = useObservable(model.tracksExport);
  const exportPreferences = useObservable(model.exportPreferences);
  const arrangement = useObservable(model.arrangementDocument);
  const ctx = useObservable(model.audioContext);
  const trackCount = documentState.trackOrder.length;

  const canvasRef = useRef<HTMLCanvasElement>(null);
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
  const runtimeMediaKey = useMemo(
    () =>
      documentState.trackOrder
        .map((trackId, index) => `${trackId}:${primaryRecordingIds[index] ?? ""}`)
        .join("|"),
    [documentState.trackOrder, primaryRecordingIds],
  );
  const hasAnyTakes = primaryRecordingIds.some(
    (recordingId) => recordingId != null,
  );
  const selection = editorState.selection;
  const committedPlayheadSec = editorState.playheadSec;
  const reverbWet = documentState.reverbWet;

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

  const runtimeInputs = {
    ctx,
    canvasRef,
    trackOrder: documentState.trackOrder,
    orderedTracks,
    timelines,
    runtimeMediaKey,
    committedPlayheadSec,
    selection,
    timelineEndSec,
    reverbWet,
  };
  const { controller: runtimeController, snapshot: runtimeSnapshot } =
    useFinalReviewRuntimeController(runtimeInputs);
  const waveformVersion = runtimeSnapshot.mediaRevision;
  const isPlaying = runtimeSnapshot.status === "previewing";
  const isSyncingFrames =
    runtimeSnapshot.status === "priming-preview" ||
    runtimeSnapshot.status === "priming-export" ||
    runtimeSnapshot.status === "exporting";
  const syncWarning =
    runtimeSnapshot.unavailableLanes.length > 0
      ? formatLaneWarning(runtimeSnapshot.unavailableLanes, trackCount)
      : null;

  function findSegmentBySelection(sel: EditorSelection): TrackClip | null {
    if (sel.trackId == null || sel.clipId == null) return null;
    const trackIndex = documentState.trackOrder.indexOf(sel.trackId);
    if (trackIndex < 0) return null;
    const track = timelines[trackIndex] ?? [];
    return track.find((segment) => segment.id === sel.clipId) ?? null;
  }

  useEffect(() => {
    const selected = findSegmentBySelection(selection);
    if (selected != null) return;
    model.ensureValidEditorSelection();
  }, [selection, timelines]);

  async function handlePlayPause() {
    const ensuredCtx = await model.ensureAudioContext();
    if (exporting || isSyncingFrames || ensuredCtx == null) return;
    if (timelineEndSec <= 0) return;
    runtimeController.syncInputs({ ...runtimeInputs, ctx: ensuredCtx });
    await runtimeController.togglePreview();
  }

  function handleTracksCommand(command: TracksEditorCommand) {
    switch (command.type) {
      case "split_selected": {
        if (exporting || isSyncingFrames) return;
        if (selection.trackId == null || selection.volumePointId != null) return;
        if (isPlaying) runtimeController.stopPlayback(true);
        model.splitSelectedClipAtPlayhead();
        return;
      }
      case "delete_selected": {
        if (exporting || isSyncingFrames) return;
        if (selection.trackId == null || selection.clipId == null) return;
        if (isPlaying) runtimeController.stopPlayback(true);
        if (selection.volumePointId != null) {
          const clip = documentState.clipsById[selection.clipId];
          const pointIndex =
            clip?.volumeEnvelope.points.findIndex(
              (point) => point.id === selection.volumePointId,
            ) ?? -1;
          if (clip == null || pointIndex <= 0 || pointIndex >= clip.volumeEnvelope.points.length - 1) {
            return;
          }
          const deleted = model.tracksDocument.deleteClipVolumePoint({
            trackId: selection.trackId,
            clipId: selection.clipId,
            pointId: selection.volumePointId,
          });
          if (deleted) {
            model.tracksEditor.setSelection({
              trackId: selection.trackId,
              clipId: selection.clipId,
              volumePointId: null,
            });
          }
          return;
        }
        model.deleteSelectedClip();
        return;
      }
      case "select_lane": {
        if (exporting || isSyncingFrames || isPlaying) return;
        model.tracksEditor.setSelection({
          trackId: command.trackId,
          clipId: selection.trackId === command.trackId ? selection.clipId : null,
          volumePointId: null,
        });
        model.tracksEditor.setPlayhead(command.timelineSec);
        return;
      }
      case "select_segment": {
        if (exporting || isSyncingFrames || isPlaying) return;
        model.tracksEditor.setSelection({
          trackId: command.trackId,
          clipId: command.clipId,
          volumePointId: null,
        });
        return;
      }
      case "select_volume_point": {
        if (exporting || isSyncingFrames || isPlaying) return;
        model.tracksEditor.setSelection({
          trackId: command.trackId,
          clipId: command.clipId,
          volumePointId: command.pointId,
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
      case "create_volume_point": {
        if (exporting || isSyncingFrames || isPlaying) return;
        model.tracksDocument.insertClipVolumePoint({
          trackId: command.trackId,
          clipId: command.clipId,
          pointId: command.pointId,
          timeSec: command.timeSec,
          gainMultiplier: command.gainMultiplier,
        });
        model.tracksEditor.setSelection({
          trackId: command.trackId,
          clipId: command.clipId,
          volumePointId: command.pointId,
        });
        return;
      }
      case "move_volume_point": {
        if (exporting || isSyncingFrames || isPlaying) return;
        model.tracksDocument.moveClipVolumePoint({
          trackId: command.trackId,
          clipId: command.clipId,
          pointId: command.pointId,
          timeSec: command.timeSec,
          gainMultiplier: command.gainMultiplier,
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Backspace" && event.key !== "Delete") return;

      const target = event.target as HTMLElement | null;
      if (
        target != null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (selection.trackId == null || selection.clipId == null) return;
      if (exporting || isSyncingFrames || isPlaying) return;

      event.preventDefault();
      handleTracksCommand({ type: "delete_selected" });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    exporting,
    isPlaying,
    isSyncingFrames,
    selection.clipId,
    selection.trackId,
    selection.volumePointId,
  ]);

  function handleReverbChange(wet: number) {
    model.tracksDocument.setReverbWet(wet);
  }

  async function handleRedoPart(index: number) {
    if (isSyncingFrames) return;
    const trackId = documentState.trackOrder[index] ?? null;
    if (trackId == null) return;
    runtimeController.stopPlayback(false);
    if (model.mediaStream.get() != null && model.isCalibrated.get()) {
      model.openRecordingForTrack(trackId);
      return;
    }

    model.setRecordingTargetTrackId(trackId);
    await acquirePermissionsAndStart();
  }

  async function handleExport() {
    const ensuredCtx = await model.ensureAudioContext();
    if (ensuredCtx == null) return;
    if (isSyncingFrames) return;
    if (timelineEndSec <= 0) return;
    runtimeController.syncInputs({ ...runtimeInputs, ctx: ensuredCtx });
    await runtimeController.exportCurrentVideo();
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
    runtimeController.stopPlayback(false);
    model.resetSession();
  }

  const selectedSegment = findSegmentBySelection(selection);
  const selectedPointIndex =
    selectedSegment?.volumeEnvelope.points.findIndex(
      (point) => point.id === selection.volumePointId,
    ) ?? -1;
  const canDelete =
    selection.volumePointId != null
      ? selectedPointIndex > 0 &&
        selectedSegment != null &&
        selectedPointIndex < selectedSegment.volumeEnvelope.points.length - 1
      : selectedSegment != null;
  const canSplit =
    selection.trackId != null &&
    selection.volumePointId == null &&
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
                  boxShadow="0 10px 28px color-mix(in srgb, var(--app-text) 28%, transparent), 0 2px 10px color-mix(in srgb, var(--app-text) 16%, transparent)"
                >
                  <canvas
                    ref={canvasRef}
                    style={{ width: "100%", height: "100%", display: "block" }}
                  />
                  <PreviewOverlay
                    trackOrder={documentState.trackOrder}
                    primaryRecordingIds={primaryRecordingIds}
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
  onRecordPart: (index: number) => void;
  disabled: boolean;
}) {
  const { trackOrder, primaryRecordingIds, onRecordPart, disabled } = input;

  return (
    <>
      {trackOrder.slice(0, 4).map((trackId, index) => {
        const placement = PREVIEW_CELL_POSITIONS[index];
        if (placement == null) return null;
        const hasTake = primaryRecordingIds[index] != null;
        const previewLabel = getPreviewPartLabel(index, trackOrder.length);

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
              align="stretch"
              w="100%"
              h="100%"
              p={{ base: 1.5, md: 2 }}
              borderRadius="2xl"
              pointerEvents="auto"
            >
              <Flex justify="space-between" align="center" gap={2}>
                <Text
                  color="white"
                  fontSize={{ base: "xs", md: "sm" }}
                  fontWeight="semibold"
                  letterSpacing="-0.01em"
                  lineHeight="1.15"
                  textShadow="0 2px 8px rgba(0, 0, 0, 0.45)"
                  pt="1px"
                >
                  {previewLabel}
                </Text>
                <Button
                  size="xs"
                  minW="0"
                  w={7}
                  h={7}
                  p={0}
                  borderRadius="full"
                  bg="rgba(20, 20, 24, 0.42)"
                  color="white"
                  border="1px solid"
                  borderColor="rgba(255,255,255,0.18)"
                  boxShadow="0 4px 10px rgba(0, 0, 0, 0.16)"
                  backdropFilter="blur(6px)"
                  fontWeight="semibold"
                  aria-label={hasTake ? "Redo take" : "Record take"}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRecordPart(index);
                  }}
                  disabled={disabled}
                  _hover={{
                    bg: "rgba(20, 20, 24, 0.56)",
                  }}
                >
                  <Box
                    w="10px"
                    h="10px"
                    borderRadius="full"
                    bg="#FF5A54"
                    boxShadow="0 0 0 1px rgba(255,255,255,0.18)"
                  />
                </Button>
              </Flex>
            </Flex>
          </Box>
        );
      })}
    </>
  );
}

function getPreviewPartLabel(index: number, totalParts: number): string {
  if (totalParts === 4) {
    return ["Low", "Mid", "High", "Melody"][index] ?? `Part ${index + 1}`;
  }
  return getPartLabel(index, totalParts);
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
    volumeHandles: buildVolumeHandleAssets(clip.volumeEnvelope, clip.durationSec),
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

function buildVolumeHandleAssets(
  volumeEnvelope: ClipVolumeEnvelope,
  durationSec: number,
): TracksEditorSegmentRenderAsset["volumeHandles"] {
  if (durationSec <= 0) {
    return volumeEnvelope.points.map((point, index) => ({
      id: point.id,
      leftPercent: 0,
      topPercent: 50,
      isBoundary:
        index === 0 || index === Math.max(0, volumeEnvelope.points.length - 1),
    }));
  }

  const sorted = [...volumeEnvelope.points].sort((a, b) => a.timeSec - b.timeSec);
  return sorted.map((point, index) => ({
    id: point.id,
    leftPercent: clamp((point.timeSec / durationSec) * 100, 0, 100),
    topPercent: clamp((1 - point.gainMultiplier / 2) * 100, 2, 98),
    isBoundary: index === 0 || index === sorted.length - 1,
  }));
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
