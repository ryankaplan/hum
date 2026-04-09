import { buildWaveformPeaks, samplePeaksForSegment } from "./timeline";

export type ReferenceWaveform = {
  peaks: number[];
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
  buffer: AudioBuffer;
  trimOffsetSec: number;
  maxDurationSec: number;
}): ReferenceWaveform | null {
  const { buffer, trimOffsetSec, maxDurationSec } = input;
  const sourceStartSec = clamp(trimOffsetSec, 0, buffer.duration);
  const durationSec = Math.max(
    0,
    Math.min(Math.max(0, maxDurationSec), buffer.duration - sourceStartSec),
  );
  if (durationSec <= 0) return null;

  const bucketCount = Math.max(
    REFERENCE_WAVEFORM_BUCKETS_MIN,
    Math.min(
      REFERENCE_WAVEFORM_BUCKETS_MAX,
      Math.round(durationSec * REFERENCE_WAVEFORM_BUCKETS_PER_SEC),
    ),
  );
  return {
    peaks: buildWaveformPeaks(buffer, sourceStartSec, durationSec, bucketCount),
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
