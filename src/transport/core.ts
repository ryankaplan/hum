import type { TimelineSegment, TrackTimeline } from "../ui/timeline";
import { getActiveSegmentAtTime } from "../ui/timeline";

export const AUDIO_SCHEDULE_LEAD_SEC = 0.05;
export const FRAME_READY_TIMEOUT_MS = 1200;
export const TRANSPORT_END_EPSILON_SEC = 0.001;

export const VIDEO_DRIFT_STABLE_THRESHOLD_SEC = 0.04;
export const VIDEO_DRIFT_HARD_SEEK_THRESHOLD_SEC = 0.25;
export const VIDEO_RATE_MIN = 0.98;
export const VIDEO_RATE_MAX = 1.02;

export type TimelineSourceMapping = {
  segment: TimelineSegment;
  sourceTimeSec: number;
};

export type TransportTimelineSample = {
  elapsedSec: number;
  timelineNowSec: number;
  clampedTimelineSec: number;
};

export type DriftClass = "stable" | "soft" | "hard";

export function mapTimelineToSource(
  track: TrackTimeline,
  timelineSec: number,
): TimelineSourceMapping | null {
  const segment = getActiveSegmentAtTime(track, timelineSec);
  if (segment == null) return null;

  const laneTime = timelineSec - segment.timelineStartSec;
  const sourceTimeSec = segment.sourceStartSec + laneTime;
  if (!Number.isFinite(sourceTimeSec)) return null;

  return { segment, sourceTimeSec };
}

export function computeTransportTimeline(
  audioContextNowSec: number,
  startCtxTimeSec: number,
  startTimelineSec: number,
  endTimelineSec: number,
): TransportTimelineSample {
  const elapsedSec = Math.max(0, audioContextNowSec - startCtxTimeSec);
  const timelineNowSec = startTimelineSec + elapsedSec;
  const clampedTimelineSec = Math.min(timelineNowSec, endTimelineSec);
  return { elapsedSec, timelineNowSec, clampedTimelineSec };
}

export function classifyVideoDrift(driftSec: number): DriftClass {
  const abs = Math.abs(driftSec);
  if (abs > VIDEO_DRIFT_HARD_SEEK_THRESHOLD_SEC) return "hard";
  if (abs > VIDEO_DRIFT_STABLE_THRESHOLD_SEC) return "soft";
  return "stable";
}

export function playbackRateForDrift(driftSec: number): number {
  const abs = Math.abs(driftSec);
  if (abs <= VIDEO_DRIFT_STABLE_THRESHOLD_SEC) return 1;

  const softRange = Math.max(
    0.001,
    VIDEO_DRIFT_HARD_SEEK_THRESHOLD_SEC - VIDEO_DRIFT_STABLE_THRESHOLD_SEC,
  );
  const normalized = clamp(
    (abs - VIDEO_DRIFT_STABLE_THRESHOLD_SEC) / softRange,
    0,
    1,
  );
  const delta = 0.005 + normalized * 0.015;

  // Positive drift means the video is ahead of desired timeline position.
  const target = driftSec > 0 ? 1 - delta : 1 + delta;
  return clamp(target, VIDEO_RATE_MIN, VIDEO_RATE_MAX);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
