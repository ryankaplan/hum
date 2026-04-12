import { describe, expect, it } from "vitest";
import {
  computeArrangementInfo,
  createDefaultArrangementDocState,
  type ArrangementDocState,
} from "../src/state/arrangementModel";

function makeArrangementDocState(
  chordsInput: string,
  overrides: Partial<ArrangementDocState> = {},
): ArrangementDocState {
  return {
    chordsInput,
    tempo: 80,
    meter: [4, 4],
    vocalRangeLow: "C3",
    vocalRangeHigh: "A4",
    harmonyRangeCoverage: "lower two thirds",
    totalParts: 4,
    customArrangement: null,
    ...overrides,
  };
}

describe("computeArrangementInfo", () => {
  it("uses the selected harmony placement to set harmony top", () => {
    const lowerTwoThirds = computeArrangementInfo(
      makeArrangementDocState("A", {
        harmonyRangeCoverage: "lower two thirds",
      }),
    );
    const wholeRange = computeArrangementInfo(
      makeArrangementDocState("A", {
        harmonyRangeCoverage: "whole-range",
      }),
    );

    expect(lowerTwoThirds.harmonyVoicing?.harmonyTop).toBe(62);
    expect(wholeRange.harmonyVoicing?.harmonyTop).toBe(69);
  });

  it("recomputes chord annotations when custom harmony adds non-chord tones", () => {
    const info = computeArrangementInfo(
      makeArrangementDocState("Em", {
        customArrangement: {
          voices: [
            {
              id: "voice-0",
              events: [{ id: "a", startTick: 0, durationTicks: 16, midi: 52 }],
            },
            {
              id: "voice-1",
              events: [{ id: "b", startTick: 0, durationTicks: 16, midi: 59 }],
            },
            {
              id: "voice-2",
              events: [{ id: "c", startTick: 0, durationTicks: 16, midi: 62 }],
            },
          ],
        },
      }),
    );

    expect(info.harmonyVoicing?.annotations[0]?.chordTones).toBe(
      "R b3 5",
    );
    expect(info.hasCustomHarmony).toBe(true);
    expect(info.effectiveHarmonyVoicing?.annotations[0]?.chordTones).toBe(
      "R 5 b7",
    );
  });

  it("keeps nullable custom harmony slots and ignores rests in annotations", () => {
    const info = computeArrangementInfo(
      makeArrangementDocState("A E", {
        customArrangement: {
          voices: [
            {
              id: "voice-0",
              events: [
                { id: "a0", startTick: 0, durationTicks: 16, midi: 45 },
                { id: "a1", startTick: 16, durationTicks: 16, midi: null },
              ],
            },
            {
              id: "voice-1",
              events: [
                { id: "b0", startTick: 0, durationTicks: 16, midi: 52 },
                { id: "b1", startTick: 16, durationTicks: 16, midi: 52 },
              ],
            },
            {
              id: "voice-2",
              events: [
                { id: "c0", startTick: 0, durationTicks: 16, midi: 57 },
                { id: "c1", startTick: 16, durationTicks: 16, midi: 59 },
              ],
            },
          ],
        },
      }),
    );

    expect(info.hasCustomHarmony).toBe(true);
    expect(info.effectiveHarmonyVoicing?.lines[0]).toEqual([45, null]);
    expect(info.effectiveHarmonyVoicing?.annotations[1]?.chordTones).toBe(
      "R 5",
    );
  });

  it("builds editor spans from beat-based chord events", () => {
    const info = computeArrangementInfo(makeArrangementDocState("A. B"));

    expect(info.chordEvents.map((event) => event.startBeat)).toEqual([0, 2]);
    expect(info.editorSpans.map((span) => span.startTick)).toEqual([0, 8]);
  });

  it("generates two harmony voices for 3-part mode", () => {
    const info = computeArrangementInfo(
      makeArrangementDocState("A9 D E", {
        totalParts: 3,
      }),
    );

    expect(info.harmonyVoicing?.harmonyPartCount).toBe(2);
    expect(info.harmonyVoicing?.lines).toHaveLength(2);
    expect(info.effectiveCustomArrangement?.voices).toHaveLength(2);
  });

  it("rejects 3-part custom arrangements with the wrong voice count", () => {
    const info = computeArrangementInfo(
      makeArrangementDocState("A", {
        totalParts: 3,
        customArrangement: {
          voices: [
            {
              id: "voice-0",
              events: [{ id: "a", startTick: 0, durationTicks: 16, midi: 45 }],
            },
          ],
        },
      }),
    );

    expect(info.hasCustomHarmony).toBe(false);
    expect(info.effectiveCustomArrangement?.voices).toHaveLength(2);
  });
});
