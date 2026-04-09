import { describe, expect, it } from "vitest";

import {
  scoreShiftCandidate,
  shouldWarnDraggedRightEdgeBeat,
  type SpeechCalibrationCapture,
} from "../src/recording/latencyCalibration";

function buildEnvelopeValues(
  peakTimesSec: number[],
  peakValue = 1,
  durationSec = 2,
  stepSec = 0.01,
): number[] {
  const frameCount = Math.ceil(durationSec / stepSec) + 1;
  const values = new Array(frameCount).fill(0);

  for (const peakTimeSec of peakTimesSec) {
    const index = Math.round(peakTimeSec / stepSec);
    if (index >= 0 && index < values.length) {
      values[index] = peakValue;
    }
  }

  return values;
}

function makeCapture(
  overrides: Partial<SpeechCalibrationCapture> = {},
): SpeechCalibrationCapture {
  return {
    audioBuffer: { duration: 2, sampleRate: 48_000 } as AudioBuffer,
    waveformPeaks: [],
    sourceStartSec: 0,
    durationSec: 2,
    secPerBeat: 0.5,
    beatTimesSec: [0, 0.5, 1, 1.5],
    targetBeatIndices: [0, 1, 2, 3],
    previewSpeechGain: 1,
    previewClickGain: 1,
    onsetEnvelopeValues: buildEnvelopeValues([0.1, 0.6, 1.1, 1.6]),
    onsetEnvelopeStartSec: 0,
    onsetEnvelopeStepSec: 0.01,
    onsetEnvelopeEnergyP95: 1,
    ...overrides,
  };
}

describe("latencyCalibration", () => {
  it("weights later beats more heavily when scoring a shift candidate", () => {
    const beatTimesSec = [0, 0.5, 1, 1.5];
    const searchRadiusSec = 0.05;

    const earlyBeatScore = scoreShiftCandidate(
      {
        values: buildEnvelopeValues([0, 0.5, 1.0]),
        startSec: 0,
        stepSec: 0.01,
        energyP95: 1,
      },
      beatTimesSec,
      0,
      searchRadiusSec,
    );

    const lateBeatScore = scoreShiftCandidate(
      {
        values: buildEnvelopeValues([0.5, 1.0, 1.5]),
        startSec: 0,
        stepSec: 0.01,
        energyP95: 1,
      },
      beatTimesSec,
      0,
      searchRadiusSec,
    );

    expect(earlyBeatScore.matchedBeatCount).toBe(3);
    expect(lateBeatScore.matchedBeatCount).toBe(3);
    expect(lateBeatScore.score).toBeGreaterThan(earlyBeatScore.score);
  });

  it("warns only when a strong onset has been dragged past the right edge", () => {
    const capture = makeCapture({
      onsetEnvelopeValues: buildEnvelopeValues([0.4, 0.9, 1.6]),
    });

    expect(shouldWarnDraggedRightEdgeBeat(capture, 0.5)).toBe(true);
    expect(shouldWarnDraggedRightEdgeBeat(capture, 0.15)).toBe(false);
  });
});
