import { Box, Button, Flex, Text } from "@chakra-ui/react";
import {
  memo,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReadOnlyObservable } from "../../../observable";
import { useObservable } from "../../../observable";
import {
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
const VOLUME_BRUSH_RADIUS_SEC = 2;
const VOLUME_BRUSH_GAIN_PER_PX = 1 / 180;
const VOLUME_LINE_HIT_RADIUS_PX = 11;

type VolumeBrushPreview = {
  trackId: string;
  clipId: string;
  startSec: number;
  endSec: number;
};

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
  const [volumeBrushPreview, setVolumeBrushPreview] =
    useState<VolumeBrushPreview | null>(null);

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

  useEffect(() => {
    if (!view.isPlaying) {
      setVolumeBrushPreview(null);
    }
  }, [view.isPlaying]);

  function handleLaneClick(
    e: ReactPointerEvent<HTMLDivElement>,
    trackId: string,
  ) {
    if (view.exporting || view.isSyncingFrames || view.isPlaying) return;

    const viewport = timelineViewportRef.current;
    if (viewport == null) return;

    const rect = viewport.getBoundingClientRect();
    const contentX = e.clientX - rect.left + viewport.scrollLeft;
    const unclampedTime = contentX / TIMELINE_PX_PER_SEC;
    const timelineSec = clamp(unclampedTime, 0, view.timelineEndSec);

    onCommand({ type: "select_lane", trackId, timelineSec });
  }

  function handleSegmentPointerDown(
    e: ReactPointerEvent<HTMLDivElement>,
    trackId: string,
    clipId: string,
    segmentStartSec: number,
    segmentDurationSec: number,
    segmentVolumeEnvelope: ClipVolumeEnvelope,
  ) {
    e.stopPropagation();
    if (view.exporting || view.isPlaying || view.isSyncingFrames) return;

    onCommand({ type: "select_segment", trackId, clipId });

    const rect = e.currentTarget.getBoundingClientRect();
    const widthPx = Math.max(1, rect.width);
    const heightPx = Math.max(1, rect.height);

    const toLocalTimeSec = (clientX: number): number => {
      const ratio = clamp((clientX - rect.left) / widthPx, 0, 1);
      return ratio * segmentDurationSec;
    };

    const pointerDownLocalSec = toLocalTimeSec(e.clientX);
    const pointerDownGainMultiplier = evaluateClipVolumeAtTime(
      segmentVolumeEnvelope,
      pointerDownLocalSec,
      segmentDurationSec,
    );
    const pointerDownY = e.clientY - rect.top;
    const volumeLineY = gainToLineYPx(pointerDownGainMultiplier, heightPx);
    const isVolumeGesture =
      Math.abs(pointerDownY - volumeLineY) <= VOLUME_LINE_HIT_RADIUS_PX;

    if (isVolumeGesture) {
      let lastClientY = e.clientY;

      setVolumeBrushPreview({
        trackId,
        clipId,
        startSec: Math.max(0, pointerDownLocalSec - VOLUME_BRUSH_RADIUS_SEC),
        endSec: Math.min(segmentDurationSec, pointerDownLocalSec + VOLUME_BRUSH_RADIUS_SEC),
      });

      const onBrushMove = (event: PointerEvent) => {
        const centerSec = toLocalTimeSec(event.clientX);
        const deltaGainMultiplier =
          (lastClientY - event.clientY) * VOLUME_BRUSH_GAIN_PER_PX;
        lastClientY = event.clientY;

        if (Math.abs(deltaGainMultiplier) > 1e-6) {
          onCommand({
            type: "apply_volume_brush",
            trackId,
            clipId,
            centerSec,
            deltaGainMultiplier,
            radiusSec: VOLUME_BRUSH_RADIUS_SEC,
          });
        }

        setVolumeBrushPreview({
          trackId,
          clipId,
          startSec: Math.max(0, centerSec - VOLUME_BRUSH_RADIUS_SEC),
          endSec: Math.min(segmentDurationSec, centerSec + VOLUME_BRUSH_RADIUS_SEC),
        });
      };

      const onBrushUp = () => {
        window.removeEventListener("pointermove", onBrushMove);
        window.removeEventListener("pointerup", onBrushUp);
        setVolumeBrushPreview((prev) =>
          prev != null && prev.clipId === clipId && prev.trackId === trackId
            ? null
            : prev,
        );
      };

      window.addEventListener("pointermove", onBrushMove);
      window.addEventListener("pointerup", onBrushUp);
      return;
    }

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
  }

  return (
    <Box overflow="hidden" {...dsPanel}>
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
        <PlayheadReadout playhead={playhead} timelineEndSec={view.timelineEndSec} />
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
              volumeBrushPreview={volumeBrushPreview}
              onLanePointerDown={handleLaneClick}
              onSegmentPointerDown={handleSegmentPointerDown}
            />
            <TimelinePlayheadOverlay playhead={playhead} />
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
        <PlayheadSlider
          playhead={playhead}
          timelineEndSec={view.timelineEndSec}
          disabled={
            view.exporting || view.isPlaying || view.isSyncingFrames || view.timelineEndSec <= 0
          }
          onChange={(valueSec) => onCommand({ type: "seek", valueSec })}
        />
      </Box>
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
  volumeBrushPreview: VolumeBrushPreview | null;
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
  const {
    lanes,
    selection,
    beatLineTimes,
    volumeBrushPreview,
    onLanePointerDown,
    onSegmentPointerDown,
  } = input;

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
                activeBrush={
                  volumeBrushPreview != null &&
                  volumeBrushPreview.trackId === lane.trackId &&
                  volumeBrushPreview.clipId === segment.id
                    ? volumeBrushPreview
                    : null
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
  activeBrush: VolumeBrushPreview | null;
  onPointerDown: (
    e: ReactPointerEvent<HTMLDivElement>,
    trackId: string,
    clipId: string,
    segmentStartSec: number,
    segmentDurationSec: number,
    segmentVolumeEnvelope: ClipVolumeEnvelope,
  ) => void;
}) {
  const { laneTrackId, segment, isSelected, activeBrush, onPointerDown } = input;
  const brushLeftPercent =
    activeBrush == null || segment.durationSec <= 0
      ? 0
      : (activeBrush.startSec / segment.durationSec) * 100;
  const brushWidthPercent =
    activeBrush == null || segment.durationSec <= 0
      ? 0
      : ((activeBrush.endSec - activeBrush.startSec) / segment.durationSec) * 100;

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
      {activeBrush != null && (
        <Box
          className="segment-volume-brush"
          left={`${brushLeftPercent}%`}
          w={`${Math.max(0, brushWidthPercent)}%`}
        />
      )}
      <svg
        className="segment-volume-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <polyline
          className="segment-volume-line"
          points={segment.renderAsset.volumeLinePoints}
        />
      </svg>
    </Box>
  );
});

function PlayheadReadout(input: {
  playhead: ReadOnlyObservable<number>;
  timelineEndSec: number;
}) {
  const playheadSec = useObservable(input.playhead);

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
}) {
  const playheadSec = useObservable(input.playhead);

  return (
    <Box
      className="timeline-playhead"
      left={`${playheadSec * TIMELINE_PX_PER_SEC}px`}
    />
  );
}

function PlayheadSlider(input: {
  playhead: ReadOnlyObservable<number>;
  timelineEndSec: number;
  disabled: boolean;
  onChange: (valueSec: number) => void;
}) {
  const playheadSec = useObservable(input.playhead);

  return (
    <input
      type="range"
      className="timeline-slider"
      min={0}
      max={Math.max(1, Math.round(input.timelineEndSec * 1000))}
      step={1}
      value={Math.round(playheadSec * 1000)}
      onChange={(e) => input.onChange(parseInt(e.target.value, 10) / 1000)}
      disabled={input.disabled}
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
