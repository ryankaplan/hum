export type TimelineSegment = {
  id: string;
  laneIndex: number;
  timelineStartSec: number;
  sourceStartSec: number;
  durationSec: number;
};

export type TrackTimeline = TimelineSegment[];

export type EditorSelection = {
  laneIndex: number | null;
  clipId: string | null;
};

export type WaveformPeaks = number[];

const EPSILON = 1e-6;

export function getSegmentEndSec(segment: TimelineSegment): number {
  return segment.timelineStartSec + segment.durationSec;
}

export function getTrackTimelineEndSec(track: TrackTimeline): number {
  let max = 0;
  for (const segment of track) {
    max = Math.max(max, getSegmentEndSec(segment));
  }
  return max;
}

export function getTimelineEndSec(tracks: TrackTimeline[]): number {
  let max = 0;
  for (const track of tracks) {
    max = Math.max(max, getTrackTimelineEndSec(track));
  }
  return max;
}

export function getActiveSegmentAtTime(
  track: TrackTimeline,
  timelineSec: number,
): TimelineSegment | null {
  for (const segment of track) {
    const start = segment.timelineStartSec;
    const end = getSegmentEndSec(segment);
    if (timelineSec >= start && timelineSec < end) {
      return segment;
    }
  }
  return null;
}

export function splitSegmentAtPlayhead(
  track: TrackTimeline,
  playheadSec: number,
  newId: () => string,
): TrackTimeline | null {
  const index = track.findIndex((segment) => {
    const start = segment.timelineStartSec;
    const end = getSegmentEndSec(segment);
    return playheadSec > start + EPSILON && playheadSec < end - EPSILON;
  });

  if (index < 0) return null;
  const original = track[index];
  if (original == null) return null;

  const leftDuration = playheadSec - original.timelineStartSec;
  const rightDuration = getSegmentEndSec(original) - playheadSec;
  if (leftDuration <= EPSILON || rightDuration <= EPSILON) return null;

  const left: TimelineSegment = {
    ...original,
    id: newId(),
    durationSec: leftDuration,
  };

  const right: TimelineSegment = {
    ...original,
    id: newId(),
    timelineStartSec: playheadSec,
    sourceStartSec: original.sourceStartSec + leftDuration,
    durationSec: rightDuration,
  };

  return [...track.slice(0, index), left, right, ...track.slice(index + 1)];
}

export function deleteSegmentById(
  track: TrackTimeline,
  clipId: string,
): TrackTimeline {
  return track.filter((segment) => segment.id !== clipId);
}

export function moveSegmentWithClamp(
  track: TrackTimeline,
  clipId: string,
  desiredStartSec: number,
): TrackTimeline {
  const index = track.findIndex((segment) => segment.id === clipId);
  if (index < 0) return track;
  const current = track[index];
  if (current == null) return track;

  const prev = index > 0 ? track[index - 1] : null;
  const next = index < track.length - 1 ? track[index + 1] : null;

  const minStart = prev != null ? getSegmentEndSec(prev) : 0;
  const maxStart =
    next != null
      ? Math.max(minStart, next.timelineStartSec - current.durationSec)
      : Number.POSITIVE_INFINITY;

  const nextStart = clamp(desiredStartSec, minStart, maxStart);
  if (Math.abs(nextStart - current.timelineStartSec) < EPSILON) return track;

  const moved: TimelineSegment = {
    ...current,
    timelineStartSec: nextStart,
  };

  return [...track.slice(0, index), moved, ...track.slice(index + 1)];
}

export function snapTimeSec(valueSec: number, beatSec: number): number {
  if (!Number.isFinite(beatSec) || beatSec <= 0) return valueSec;
  return Math.round(valueSec / beatSec) * beatSec;
}

export function buildWaveformPeaks(
  buffer: AudioBuffer,
  sourceStartSec: number,
  durationSec: number,
  buckets = 320,
): WaveformPeaks {
  const channelCount = buffer.numberOfChannels;
  if (channelCount <= 0 || buckets <= 0 || durationSec <= 0) return [];

  const sampleRate = buffer.sampleRate;
  const start = Math.max(0, Math.floor(sourceStartSec * sampleRate));
  const end = Math.min(
    buffer.length,
    Math.floor((sourceStartSec + durationSec) * sampleRate),
  );
  if (end <= start) return [];

  const channels: Float32Array[] = [];
  for (let i = 0; i < channelCount; i++) {
    channels.push(buffer.getChannelData(i));
  }

  const window = Math.max(1, Math.floor((end - start) / buckets));
  const peaks: number[] = [];

  for (let i = 0; i < buckets; i++) {
    const from = start + i * window;
    if (from >= end) {
      peaks.push(0);
      continue;
    }
    const to = Math.min(end, from + window);
    let peak = 0;
    for (let s = from; s < to; s++) {
      for (const channel of channels) {
        const value = Math.abs(channel[s] ?? 0);
        if (value > peak) peak = value;
      }
    }
    peaks.push(peak);
  }

  return normalizePeaks(peaks);
}

export function samplePeaksForSegment(
  peaks: WaveformPeaks,
  laneSourceDurationSec: number,
  segmentSourceStartSec: number,
  segmentDurationSec: number,
  bars: number,
): number[] {
  if (bars <= 0 || peaks.length === 0 || laneSourceDurationSec <= 0) {
    return [];
  }

  const samples: number[] = [];
  for (let i = 0; i < bars; i++) {
    const ratio = (i + 0.5) / bars;
    const sourceTime =
      segmentSourceStartSec + ratio * Math.max(segmentDurationSec, 0);
    const sourceRatio = clamp(sourceTime / laneSourceDurationSec, 0, 1);
    const peakIndex = Math.min(
      peaks.length - 1,
      Math.floor(sourceRatio * (peaks.length - 1)),
    );
    samples.push(peaks[peakIndex] ?? 0);
  }
  return samples;
}

function normalizePeaks(peaks: number[]): number[] {
  let max = 0;
  for (const peak of peaks) max = Math.max(max, peak);
  if (max <= EPSILON) return peaks.map(() => 0);
  return peaks.map((peak) => peak / max);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
