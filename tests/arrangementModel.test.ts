import { describe, expect, it } from "vitest";
import {
  computeArrangementInfo,
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
    ...overrides,
  };
}

describe("computeArrangementInfo", () => {
  it("uses the selected harmony placement to set harmony top", () => {
    const lowerThreeQuarters = computeArrangementInfo(
      makeArrangementDocState("A", {
        harmonyRangeCoverage: "lower three quarters",
      }),
    );
    const wholeRange = computeArrangementInfo(
      makeArrangementDocState("A", {
        harmonyRangeCoverage: "whole-range",
      }),
    );

    expect(lowerThreeQuarters.harmonyVoicing?.harmonyTop).toBe(64);
    expect(wholeRange.harmonyVoicing?.harmonyTop).toBe(69);
  });
});
