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
    selectedHarmonyGenerator: "dynamic",
    totalParts: 4,
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

    expect(lowerTwoThirds.harmonyVoicingLegacy?.harmonyTop).toBe(62);
    expect(wholeRange.harmonyVoicingLegacy?.harmonyTop).toBe(69);
  });

  it("defaults new arrangements to dynamic harmony selection", () => {
    expect(createDefaultArrangementDocState().selectedHarmonyGenerator).toBe(
      "dynamic",
    );

    const info = computeArrangementInfo(makeArrangementDocState("A9"));

    expect(info.selectedHarmonyVoicing).toBe(info.harmonyVoicingDynamic);
    expect(info.selectedHarmonyVoicing).not.toBe(info.harmonyVoicingLegacy);
  });

  it("can explicitly select the legacy harmony voicing", () => {
    const info = computeArrangementInfo(
      makeArrangementDocState("A9", {
        selectedHarmonyGenerator: "legacy",
      }),
    );

    expect(info.selectedHarmonyVoicing).toBe(info.harmonyVoicingLegacy);
    expect(info.selectedHarmonyVoicing).not.toBe(info.harmonyVoicingDynamic);
  });

  it("recomputes chord annotations when custom harmony adds non-chord tones", () => {
    const info = computeArrangementInfo(
      makeArrangementDocState("Em", {
        customHarmony: {
          lines: [[52], [59], [62]],
        },
      }),
    );

    expect(info.selectedHarmonyVoicing?.annotations[0]?.chordTones).toBe(
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
        customHarmony: {
          lines: [
            [45, null],
            [52, 52],
            [57, 59],
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
});
