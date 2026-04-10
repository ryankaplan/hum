import { Box, Button, Flex, Text } from "@chakra-ui/react";
import {
  memo,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReadOnlyObservable } from "../../../observable";
import { useObservable } from "../../../observable";
import {
  createVolumePointId,
  evaluateClipVolumeAtTime,
  type ClipVolumeEnvelope,
} from "../../../state/clipAutomation";
import { dsColors, dsPanel } from "../../designSystem";
import { VolumeOffIcon, VolumeOnIcon } from "../../icons";
import type { TracksEditorCommand } from "./commands";
import type {
  TracksEditorLaneView,
  TracksEditorSegmentView,
  TracksEditorStaticView,
} from "./viewTypes";

const TIMELINE_PX_PER_SEC = 110;
const TIMELINE_RIGHT_PAD_PX = 48;
const LANE_HEIGHT_PX = 72;
const TRACK_RAIL_WIDTH_PX = 200;
const VOLUME_LINE_HIT_RADIUS_PX = 11;
const VOLUME_HANDLE_HIT_RADIUS_PX = 12;

type TracksEditorPanelProps = {
  view: TracksEditorStaticView;
  playhead: ReadOnlyObservable<number>;
  onPlayPause: () => void;
  onCommand: (command: TracksEditorCommand) => void;
  onReverbChange: (wet: number) => void;
};

export function TracksEditorPanel(props: TracksEditorPanelProps) {
  const { view, playhead, onPlayPause, onCommand, onReverbChange } = props;
  const trackCount = view.lanes.length;

  const timelineViewportRef = useRef<HTMLDivElement>(null);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);
  const [scrubPreviewSec, setScrubPreviewSec] = useState<number | null>(null);
  const scrubPreviewRef = useRef<number | null>(null);
  const scrubRafRef = useRef<number | null>(null);
  const scrubQueuedSecRef = useRef<number | null>(null);

  const timelineContentWidthPx = Math.max(
    timelineViewportWidth,
    Math.ceil(
      Math.max(1, view.timelineEndSec) * TIMELINE_PX_PER_SEC + TIMELINE_RIGHT_PAD_PX,
    ),
  );

  useEffect(() => {
    const el = timelineViewportRef.current;
    if (el == null) return;

    const update = () => setTimelineViewportWidth(el.clientWidth);
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const setScrubPreview = useCallback((valueSec: number | null) => {
    scrubPreviewRef.current = valueSec;
    setScrubPreviewSec(valueSec);
  }, []);

  const getTimelineSecForClientX = useCallback((clientX: number): number | null => {
    const viewport = timelineViewportRef.current;
    if (viewport == null) return null;

    const rect = viewport.getBoundingClientRect();
    const contentX = clientX - rect.left + viewport.scrollLeft;
    const unclampedTime = contentX / TIMELINE_PX_PER_SEC;
    return clamp(unclampedTime, 0, view.timelineEndSec);
  }, [view.timelineEndSec]);

  const flushQueuedSeek = useCallback(() => {
    scrubRafRef.current = null;
    const nextSec = scrubQueuedSecRef.current;
    scrubQueuedSecRef.current = null;
    if (nextSec == null) return;
    onCommand({ type: "seek", valueSec: nextSec });
  }, [onCommand]);

  const queueSeek = useCallback((valueSec: number) => {
    if (scrubQueuedSecRef.current != null && Math.abs(scrubQueuedSecRef.current - valueSec) < 1e-4) {
      return;
    }

    scrubQueuedSecRef.current = valueSec;
    if (scrubRafRef.current != null) return;
    scrubRafRef.current = window.requestAnimationFrame(() => {
      flushQueuedSeek();
    });
  }, [flushQueuedSeek]);

  const flushSeekImmediately = useCallback((valueSec: number) => {
    if (scrubRafRef.current != null) {
      window.cancelAnimationFrame(scrubRafRef.current);
      scrubRafRef.current = null;
    }
    scrubQueuedSecRef.current = null;
    onCommand({ type: "seek", valueSec });
  }, [onCommand]);

  useEffect(() => {
    return () => {
      if (scrubRafRef.current != null) {
        window.cancelAnimationFrame(scrubRafRef.current);
      }
    };
  }, []);

  const handleLanePointerDown = useCallback((
    e: ReactPointerEvent<HTMLDivElement>,
    trackId: string,
  ) => {
    if (view.exporting || view.isSyncingFrames || view.isPlaying) return;
    const timelineSec = getTimelineSecForClientX(e.clientX);
    if (timelineSec == null) return;

    setScrubPreview(timelineSec);
    onCommand({ type: "select_lane", trackId, timelineSec });

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Dragging still works through the window listeners below.
    }

    const updateScrub = (clientX: number, commitMode: "queued" | "final") => {
      const nextSec = getTimelineSecForClientX(clientX);
      if (nextSec == null) return;

      if (scrubPreviewRef.current == null || Math.abs(scrubPreviewRef.current - nextSec) >= 1e-4) {
        setScrubPreview(nextSec);
      }

      if (commitMode === "final") {
        flushSeekImmediately(nextSec);
      } else {
        queueSeek(nextSec);
      }
    };

    const onScrubMove = (event: PointerEvent) => {
      if (event.pointerId !== e.pointerId) return;
      updateScrub(event.clientX, "queued");
    };

    const finishScrub = (event: PointerEvent) => {
      if (event.pointerId !== e.pointerId) return;

      window.removeEventListener("pointermove", onScrubMove);
      window.removeEventListener("pointerup", finishScrub);
      window.removeEventListener("pointercancel", finishScrub);

      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if capture was never acquired or already released.
      }

      updateScrub(event.clientX, "final");
      setScrubPreview(null);
    };

    window.addEventListener("pointermove", onScrubMove);
    window.addEventListener("pointerup", finishScrub);
    window.addEventListener("pointercancel", finishScrub);
  }, [
    flushSeekImmediately,
    getTimelineSecForClientX,
    onCommand,
    queueSeek,
    setScrubPreview,
    view.exporting,
    view.isPlaying,
    view.isSyncingFrames,
  ]);

  const handleSegmentPointerDown = useCallback((
    e: ReactPointerEvent<HTMLDivElement>,
    trackId: string,
    clipId: string,
    segmentStartSec: number,
    segmentDurationSec: number,
    segmentVolumeEnvelope: ClipVolumeEnvelope,
  ) => {
    e.stopPropagation();
    if (view.exporting || view.isPlaying || view.isSyncingFrames) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const widthPx = Math.max(1, rect.width);
    const heightPx = Math.max(1, rect.height);

    const toLocalTimeSec = (clientX: number): number => {
      const ratio = clamp((clientX - rect.left) / widthPx, 0, 1);
      return ratio * segmentDurationSec;
    };

    const toGainMultiplier = (clientY: number): number => {
      const y = clamp(clientY - rect.top, 0, heightPx);
      return clamp(2 - (y / heightPx) * 2, 0, 2);
    };

    const pointerDownLocalSec = toLocalTimeSec(e.clientX);
    const pointerDownGainMultiplier = evaluateClipVolumeAtTime(
      segmentVolumeEnvelope,
      pointerDownLocalSec,
      segmentDurationSec,
    );
    const pointerDownY = e.clientY - rect.top;

    const sortedPoints = [...segmentVolumeEnvelope.points].sort(
      (a, b) => a.timeSec - b.timeSec,
    );
    const hitHandle = sortedPoints.find((point) => {
      const pointX = (point.timeSec / Math.max(segmentDurationSec, 1e-6)) * widthPx;
      const pointY = gainToLineYPx(point.gainMultiplier, heightPx);
      const dx = pointX - (e.clientX - rect.left);
      const dy = pointY - pointerDownY;
      return Math.hypot(dx, dy) <= VOLUME_HANDLE_HIT_RADIUS_PX;
    });

    if (hitHandle != null) {
      onCommand({ type: "select_volume_point", trackId, clipId, pointId: hitHandle.id });

      const onMovePoint = (event: PointerEvent) => {
        onCommand({
          type: "move_volume_point",
          trackId,
          clipId,
          pointId: hitHandle.id,
          timeSec: toLocalTimeSec(event.clientX),
          gainMultiplier: toGainMultiplier(event.clientY),
        });
      };

      const onMovePointUp = () => {
        window.removeEventListener("pointermove", onMovePoint);
        window.removeEventListener("pointerup", onMovePointUp);
      };

      window.addEventListener("pointermove", onMovePoint);
      window.addEventListener("pointerup", onMovePointUp);
      return;
    }

    const volumeLineY = gainToLineYPx(pointerDownGainMultiplier, heightPx);
    const isVolumeGesture =
      Math.abs(pointerDownY - volumeLineY) <= VOLUME_LINE_HIT_RADIUS_PX;

    if (isVolumeGesture) {
      const pointId = createVolumePointId();
      onCommand({
        type: "create_volume_point",
        trackId,
        clipId,
        pointId,
        timeSec: pointerDownLocalSec,
        gainMultiplier: pointerDownGainMultiplier,
      });

      const onMovePoint = (event: PointerEvent) => {
        onCommand({
          type: "move_volume_point",
          trackId,
          clipId,
          pointId,
          timeSec: toLocalTimeSec(event.clientX),
          gainMultiplier: toGainMultiplier(event.clientY),
        });
      };

      const onMovePointUp = () => {
        window.removeEventListener("pointermove", onMovePoint);
        window.removeEventListener("pointerup", onMovePointUp);
      };

      window.addEventListener("pointermove", onMovePoint);
      window.addEventListener("pointerup", onMovePointUp);
      return;
    }

    onCommand({ type: "select_segment", trackId, clipId });

    const startClientX = e.clientX;

    const onMoveClip = (event: PointerEvent) => {
      const deltaPx = event.clientX - startClientX;
      const deltaSec = deltaPx / TIMELINE_PX_PER_SEC;
      const desiredStartSec = segmentStartSec + deltaSec;

      onCommand({
        type: "move_segment",
        trackId,
        clipId,
        desiredStartSec,
      });
    };

    const onMoveClipUp = () => {
      window.removeEventListener("pointermove", onMoveClip);
      window.removeEventListener("pointerup", onMoveClipUp);
    };

    window.addEventListener("pointermove", onMoveClip);
    window.addEventListener("pointerup", onMoveClipUp);
  }, [onCommand, view.exporting, view.isPlaying, view.isSyncingFrames]);

  return (
    <Box overflow="hidden" h="100%" {...dsPanel}>
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
        <PlayheadReadout
          playhead={playhead}
          previewPlayheadSec={scrubPreviewSec}
          timelineEndSec={view.timelineEndSec}
        />
      </Flex>

      <Flex
        align="center"
        justify="space-between"
        gap={1.5}
        flexWrap="wrap"
        px={3}
        py={2}
        borderBottomWidth="1px"
        borderColor="appBorderMuted"
      >
        <Flex gap={1.5} flexWrap="wrap">
          <Button
            variant={view.isPlaying ? "outline" : "solid"}
            size="sm"
            h={8}
            px={3}
            fontSize="xs"
            fontWeight="medium"
            onClick={onPlayPause}
            disabled={view.exporting || view.isSyncingFrames || view.timelineEndSec <= 0}
            loading={view.isSyncingFrames}
            loadingText="Syncing…"
            borderColor={view.isPlaying ? dsColors.outline : dsColors.accent}
            bg={view.isPlaying ? "transparent" : dsColors.accent}
            color={view.isPlaying ? dsColors.textMuted : dsColors.accentForeground}
            _hover={{
              bg: view.isPlaying ? dsColors.surfaceRaised : dsColors.accentHover,
            }}
          >
            {view.isPlaying ? "Pause" : "Play"}
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
            onClick={() => onCommand({ type: "split_selected" })}
            disabled={view.exporting || view.isSyncingFrames || !view.canSplit}
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
            onClick={() => onCommand({ type: "delete_selected" })}
            disabled={view.exporting || view.isSyncingFrames || !view.canDelete}
          >
            Delete
          </Button>
        </Flex>
        <Flex align="center" gap={2} minW={{ base: "180px", md: "220px" }} flex="1" justify="end">
          <Text fontSize="xs" color="appTextMuted" whiteSpace="nowrap">
            Reverb
          </Text>
          <input
            type="range"
            className="mix-slider"
            min={0}
            max={100}
            step={1}
            value={Math.round(view.reverbWet * 100)}
            onChange={(e) => onReverbChange(parseInt(e.target.value, 10) / 100)}
            disabled={view.exporting || view.isSyncingFrames}
            style={{ width: "100%", maxWidth: "180px" }}
          />
          <Text
            fontSize="xs"
            color="appTextSubtle"
            minW="34px"
            textAlign="right"
            fontVariantNumeric="tabular-nums"
          >
            {Math.round(view.reverbWet * 100)}%
          </Text>
        </Flex>
      </Flex>

      {(view.isSyncingFrames || view.syncWarning != null) && (
        <Box
          px={3}
          py={2}
          borderBottomWidth="1px"
          borderColor="appBorderMuted"
          bg="appSurfaceSubtle"
        >
          {view.isSyncingFrames && (
            <Text color="appText" fontSize="xs">
              Syncing frames...
            </Text>
          )}
          {view.syncWarning != null && (
            <Text color="appWarning" fontSize="xs">
              {view.syncWarning}
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
          {view.lanes.map((lane) => (
            <LaneRailRow
              key={`rail-${lane.trackId}`}
              lane={lane}
              disabled={view.exporting || view.isSyncingFrames}
              onCommand={onCommand}
            />
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
            <TracksTimelineStatic
              lanes={view.lanes}
              selection={view.selection}
              beatLineTimes={view.beatLineTimes}
              onLanePointerDown={handleLanePointerDown}
              onSegmentPointerDown={handleSegmentPointerDown}
            />
            <TimelinePlayheadOverlay
              playhead={playhead}
              previewPlayheadSec={scrubPreviewSec}
            />
          </Box>
        </Box>
      </Flex>

    </Box>
  );
}

const LaneRailRow = memo(function LaneRailRow(input: {
  lane: TracksEditorLaneView;
  disabled: boolean;
  onCommand: (command: TracksEditorCommand) => void;
}) {
  const { lane, disabled, onCommand } = input;

  return (
    <Flex
      h={`${LANE_HEIGHT_PX}px`}
      direction="column"
      align="stretch"
      justify="center"
      borderBottomWidth="1px"
      borderColor="appBorderMuted"
      px={2.5}
      py={2}
      gap={1.5}
    >
      <Text
        fontSize="10px"
        fontWeight="medium"
        color="appTextMuted"
        textAlign="left"
        lineHeight="1.25"
        textTransform="uppercase"
        letterSpacing="0.06em"
        lineClamp={1}
      >
        {lane.label}
      </Text>
      <Flex align="center" gap={1.5} minW={0}>
        <Button
          size="xs"
          variant="ghost"
          color={lane.muted ? dsColors.errorText : dsColors.textSubtle}
          bg={lane.muted ? dsColors.errorBg : "transparent"}
          fontWeight="bold"
          onClick={() =>
            onCommand({ type: "toggle_lane_mute", trackId: lane.trackId })
          }
          w={7}
          h={6}
          minW={7}
          p={0}
          lineHeight={0}
          flexShrink={0}
          disabled={disabled}
          aria-label={lane.muted ? `Unmute ${lane.label}` : `Mute ${lane.label}`}
          title={lane.muted ? `Unmute ${lane.label}` : `Mute ${lane.label}`}
        >
          {lane.muted ? (
            <VolumeOffIcon size={15} strokeWidth={2} />
          ) : (
            <VolumeOnIcon size={15} strokeWidth={2} />
          )}
        </Button>
        <input
          type="range"
          className="mix-slider"
          min={0}
          max={150}
          step={1}
          value={Math.round(lane.volume * 100)}
          onChange={(event) =>
            onCommand({
              type: "set_lane_volume",
              trackId: lane.trackId,
              value: parseInt(event.target.value, 10) / 100,
            })
          }
          disabled={disabled}
        />
        <Text
          color="appTextSubtle"
          fontSize="10px"
          w={10}
          textAlign="right"
          flexShrink={0}
          fontVariantNumeric="tabular-nums"
        >
          {Math.round(lane.volume * 100)}%
        </Text>
      </Flex>
    </Flex>
  );
});

const TracksTimelineStatic = memo(function TracksTimelineStatic(input: {
  lanes: TracksEditorLaneView[];
  selection: TracksEditorStaticView["selection"];
  beatLineTimes: number[];
  onLanePointerDown: (
    e: ReactPointerEvent<HTMLDivElement>,
    trackId: string,
  ) => void;
  onSegmentPointerDown: (
    e: ReactPointerEvent<HTMLDivElement>,
    trackId: string,
    clipId: string,
    segmentStartSec: number,
    segmentDurationSec: number,
    segmentVolumeEnvelope: ClipVolumeEnvelope,
  ) => void;
}) {
  const { lanes, selection, beatLineTimes, onLanePointerDown, onSegmentPointerDown } =
    input;

  return (
    <>
      {lanes.map((lane) => {
        const laneClass =
          `timeline-lane ${selection.trackId === lane.trackId ? "is-selected-lane" : ""}` +
          (lane.displayIndex % 2 === 0 ? " is-alt" : "");

        return (
          <Box
            key={lane.trackId}
            className={laneClass}
            position="absolute"
            left={0}
            right={0}
            top={`${lane.displayIndex * LANE_HEIGHT_PX}px`}
            h={`${LANE_HEIGHT_PX - 1}px`}
            onPointerDown={(e) => onLanePointerDown(e, lane.trackId)}
          >
            {beatLineTimes.map((line, index) => (
              <Box
                key={`${lane.trackId}-beat-${index}`}
                className="timeline-beat"
                left={`${line * TIMELINE_PX_PER_SEC}px`}
              />
            ))}

            {lane.segments.map((segment) => (
              <TimelineSegmentBox
                key={segment.id}
                laneTrackId={lane.trackId}
                segment={segment}
                isSelected={selection.clipId === segment.id}
                selectedVolumePointId={
                  selection.clipId === segment.id ? selection.volumePointId : null
                }
                onPointerDown={onSegmentPointerDown}
              />
            ))}
          </Box>
        );
      })}
    </>
  );
});

const TimelineSegmentBox = memo(function TimelineSegmentBox(input: {
  laneTrackId: string;
  segment: TracksEditorSegmentView;
  isSelected: boolean;
  selectedVolumePointId: string | null;
  onPointerDown: (
    e: ReactPointerEvent<HTMLDivElement>,
    trackId: string,
    clipId: string,
    segmentStartSec: number,
    segmentDurationSec: number,
    segmentVolumeEnvelope: ClipVolumeEnvelope,
  ) => void;
}) {
  const { laneTrackId, segment, isSelected, selectedVolumePointId, onPointerDown } =
    input;

  return (
    <Box
      className={`timeline-segment ${isSelected ? "is-selected" : ""}`}
      left={`${segment.renderAsset.leftPx}px`}
      w={`${segment.renderAsset.widthPx}px`}
      onPointerDown={(e) =>
        onPointerDown(
          e,
          laneTrackId,
          segment.id,
          segment.timelineStartSec,
          segment.durationSec,
          segment.volumeEnvelope,
        )
      }
    >
      <Box className="segment-waveform">
        {segment.renderAsset.waveformBarHeights.map((height, idx) => (
          <Box
            key={`${segment.id}-${idx}`}
            className="segment-bar"
            h={`${height}%`}
          />
        ))}
      </Box>
      <svg
        className="segment-volume-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <polyline
          className="segment-volume-line"
          points={segment.renderAsset.volumeLinePoints}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {segment.renderAsset.volumeHandles.map((handle) => (
        <Box
          key={handle.id}
          className={`segment-volume-handle-hit ${
            selectedVolumePointId === handle.id ? "is-selected" : ""
          }`}
          left={`${handle.leftPercent}%`}
          top={`${handle.topPercent}%`}
        >
          <Box
            className={`segment-volume-handle ${
              handle.isBoundary ? "is-boundary" : "is-interior"
            } ${selectedVolumePointId === handle.id ? "is-selected" : ""}`}
          />
        </Box>
      ))}
    </Box>
  );
});

function PlayheadReadout(input: {
  playhead: ReadOnlyObservable<number>;
  previewPlayheadSec?: number | null;
  timelineEndSec: number;
}) {
  const observablePlayheadSec = useObservable(input.playhead);
  const playheadSec = input.previewPlayheadSec ?? observablePlayheadSec;

  return (
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
        / {formatTime(input.timelineEndSec)}
      </Box>
    </Box>
  );
}

function TimelinePlayheadOverlay(input: {
  playhead: ReadOnlyObservable<number>;
  previewPlayheadSec?: number | null;
}) {
  const observablePlayheadSec = useObservable(input.playhead);
  const playheadSec = input.previewPlayheadSec ?? observablePlayheadSec;

  return (
    <Box
      className="timeline-playhead"
      left={`${playheadSec * TIMELINE_PX_PER_SEC}px`}
    />
  );
}

function gainToLineYPx(gain: number, heightPx: number): number {
  const ratio = clamp(1 - gain / 2, 0, 1);
  return ratio * heightPx;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00.00";
  const mins = Math.floor(sec / 60);
  const rem = sec - mins * 60;
  const whole = Math.floor(rem);
  const hundredths = Math.floor((rem - whole) * 100);
  return `${mins}:${String(whole).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
