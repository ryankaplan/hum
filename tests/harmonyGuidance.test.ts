import { describe, expect, it } from "vitest";
import { resolveRecordingHarmonyGuidance } from "../src/recording/harmonyGuidance";
import {
  computeArrangementInfo,
  createDefaultArrangementDocState,
} from "../src/state/arrangementModel";

function makeArrangementInfo() {
  return computeArrangementInfo({
    ...createDefaultArrangementDocState(),
    chordsInput: "A9",
  });
}

describe("resolveRecordingHarmonyGuidance", () => {
  it("uses the generated arrangement's guide tones and count-in cue", () => {
    const info = makeArrangementInfo();

    const guidance = resolveRecordingHarmonyGuidance(
      info.harmonyVoicing,
      info.effectiveCustomArrangement?.voices ?? [],
      0,
      4,
    );

    expect(guidance.harmonyLine).toEqual(
      info.harmonyVoicing?.lines[0] ?? null,
    );
    expect(guidance.countInCueMidi).toBe(
      info.effectiveCustomArrangement?.voices[0]?.events[0]?.midi ?? null,
    );
  });

  it("treats the last part as melody in 3-part mode", () => {
    const info = computeArrangementInfo({
      ...createDefaultArrangementDocState(),
      chordsInput: "A9",
      totalParts: 3,
    });

    const guidance = resolveRecordingHarmonyGuidance(
      info.harmonyVoicing,
      info.effectiveCustomArrangement?.voices ?? [],
      2,
      3,
    );

    expect(guidance.harmonyLine).toBeNull();
    expect(guidance.arrangementVoice).toBeNull();
  });

  it("uses the first active rhythmic event for the count-in cue", () => {
    const info = computeArrangementInfo({
      ...createDefaultArrangementDocState(),
      chordsInput: "A9",
      harmonyRhythmPatternId: "offbeat_comp",
    });

    const guidance = resolveRecordingHarmonyGuidance(
      info.harmonyVoicing,
      info.effectiveCustomArrangement?.voices ?? [],
      0,
      4,
    );

    expect(guidance.arrangementVoice?.events[0]?.midi).toBeNull();
    expect(guidance.countInCueMidi).toBe(49);
  });
});
