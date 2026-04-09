import { describe, expect, it } from "vitest";
import {
  computeFinalReviewWaveformBarCount,
  sampleReferenceWaveformBars,
} from "../src/ui/waveformRendering";

describe("sampleReferenceWaveformBars", () => {
  it("computes dense bars and preserves silent cutouts", () => {
    const bars = sampleReferenceWaveformBars({
      waveform: {
        durationSec: 8,
        peaks: [
          1, 1, 1, 1,
          0.9, 0.8, 0, 0,
          0, 0, 0, 0,
          0.8, 0.9, 1, 1,
        ],
      },
      widthPx: 10,
    });

    expect(bars).toHaveLength(5);
    expect(bars[0]).toBeGreaterThan(0);
    expect(bars[1]).toBeGreaterThan(0);
    expect(bars[2]).toBe(0);
    expect(bars[3]).toBe(0);
    expect(bars[4]).toBeGreaterThan(0);
  });

  it("returns an empty bar set when no reference waveform is available", () => {
    expect(
      sampleReferenceWaveformBars({
        waveform: null,
        widthPx: 24,
      }),
    ).toEqual([]);

    expect(
      sampleReferenceWaveformBars({
        waveform: {
          durationSec: 4,
          peaks: [],
        },
        widthPx: 24,
      }),
    ).toEqual([]);

    expect(
      sampleReferenceWaveformBars({
        waveform: {
          durationSec: 4,
          peaks: [1, 0.5, 0],
        },
        widthPx: 0,
      }),
    ).toEqual([]);
  });
});

describe("computeFinalReviewWaveformBarCount", () => {
  it("keeps dense long-clip waveforms above the old clamp", () => {
    expect(computeFinalReviewWaveformBarCount(2200)).toBe(1100);
    expect(computeFinalReviewWaveformBarCount(2200)).toBeGreaterThan(960);
  });
});
