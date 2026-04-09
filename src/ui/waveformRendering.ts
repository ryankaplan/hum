import { buildWaveformPeaks, samplePeaksForSegment } from "./timeline";

export type ReferenceWaveform = {
  peaks: number[];
  durationSec: number;
};

export type ReferenceWaveformSegment = {
  buffer: AudioBuffer;
  timelineStartSec: number;
  sourceStartSec: number;
  durationSec: number;
};

export const REFERENCE_WAVEFORM_BUCKETS_PER_SEC = 120;
export const REFERENCE_WAVEFORM_BUCKETS_MIN = 64;
export const REFERENCE_WAVEFORM_BUCKETS_MAX = 4096;
export const REFERENCE_WAVEFORM_BAR_STEP_PX = 2;
export const REFERENCE_WAVEFORM_BAR_COUNT_MAX = 4096;

export const FINAL_REVIEW_WAVEFORM_BUCKETS_PER_SEC = 120;
export const FINAL_REVIEW_WAVEFORM_BAR_STEP_PX = 2;
export const FINAL_REVIEW_WAVEFORM_BARS_MIN = 16;
export const FINAL_REVIEW_WAVEFORM_BARS_MAX = 2400;

export function computeWaveformBarCount(
  widthPx: number,
  stepPx: number,
  minBars: number,
  maxBars: number,
): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) {
    return Math.max(0, minBars);
  }
  if (!Number.isFinite(stepPx) || stepPx <= 0) {
    return Math.max(0, minBars);
  }
  const rawCount = Math.round(widthPx / stepPx);
  return Math.max(minBars, Math.min(maxBars, rawCount));
}

export function buildReferenceWaveform(input: {
  segments: ReferenceWaveformSegment[];
  maxDurationSec: number;
}): ReferenceWaveform | null {
  const { segments, maxDurationSec } = input;
  const durationSec = Math.max(0, maxDurationSec);
  if (durationSec <= 0) return null;

  const bucketCount = Math.max(
    REFERENCE_WAVEFORM_BUCKETS_MIN,
    Math.min(
      REFERENCE_WAVEFORM_BUCKETS_MAX,
      Math.round(durationSec * REFERENCE_WAVEFORM_BUCKETS_PER_SEC),
    ),
  );
  const peaks = new Array<number>(bucketCount).fill(0);

  for (const segment of segments) {
    const safeTimelineStartSec = clamp(segment.timelineStartSec, 0, durationSec);
    const safeSourceStartSec = Math.max(0, segment.sourceStartSec);
    const safeSegmentDurationSec = Math.max(
      0,
      Math.min(
        segment.durationSec,
        durationSec - safeTimelineStartSec,
        segment.buffer.duration - safeSourceStartSec,
      ),
    );
    if (safeSegmentDurationSec <= 0) continue;

    const startIndex = Math.max(
      0,
      Math.floor((safeTimelineStartSec / durationSec) * bucketCount),
    );
    const endIndex = Math.min(
      bucketCount,
      Math.ceil(
        ((safeTimelineStartSec + safeSegmentDurationSec) / durationSec) *
          bucketCount,
      ),
    );
    const segmentBucketCount = Math.max(1, endIndex - startIndex);
    const segmentPeaks = buildWaveformPeaks(
      segment.buffer,
      safeSourceStartSec,
      safeSegmentDurationSec,
      segmentBucketCount,
    );

    for (let i = 0; i < segmentBucketCount; i++) {
      const peakIndex = startIndex + i;
      if (peakIndex >= peaks.length) break;
      peaks[peakIndex] = Math.max(peaks[peakIndex] ?? 0, segmentPeaks[i] ?? 0);
    }
  }

  return {
    peaks,
    durationSec,
  };
}

export function sampleReferenceWaveformBars(input: {
  waveform: ReferenceWaveform | null;
  widthPx: number;
}): number[] {
  const { waveform, widthPx } = input;
  if (
    waveform == null ||
    waveform.durationSec <= 0 ||
    waveform.peaks.length === 0 ||
    widthPx <= 0
  ) {
    return [];
  }

  const barCount = computeWaveformBarCount(
    widthPx,
    REFERENCE_WAVEFORM_BAR_STEP_PX,
    1,
    REFERENCE_WAVEFORM_BAR_COUNT_MAX,
  );
  if (barCount <= 0) return [];

  return samplePeaksForSegment(
    waveform.peaks,
    waveform.durationSec,
    0,
    waveform.durationSec,
    barCount,
  ).map((sample) => Math.max(0, Math.round(sample * 100)));
}

export function computeFinalReviewWaveformBarCount(widthPx: number): number {
  return computeWaveformBarCount(
    widthPx,
    FINAL_REVIEW_WAVEFORM_BAR_STEP_PX,
    FINAL_REVIEW_WAVEFORM_BARS_MIN,
    FINAL_REVIEW_WAVEFORM_BARS_MAX,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
