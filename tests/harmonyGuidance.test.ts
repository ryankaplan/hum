import { describe, expect, it } from "vitest";
import { resolveRecordingHarmonyGuidance } from "../src/recording/harmonyGuidance";
import {
  computeArrangementInfo,
  createDefaultArrangementDocState,
} from "../src/state/arrangementModel";

function makeArrangementInfo(selectedHarmonyGenerator: "legacy" | "dynamic") {
  return computeArrangementInfo({
    ...createDefaultArrangementDocState(),
    chordsInput: "A9",
    selectedHarmonyGenerator,
  });
}

describe("resolveRecordingHarmonyGuidance", () => {
  it("uses the selected arrangement's guide tones and count-in cue", () => {
    const legacyInfo = makeArrangementInfo("legacy");
    const dynamicInfo = makeArrangementInfo("dynamic");

    const legacyGuidance = resolveRecordingHarmonyGuidance(
      legacyInfo.selectedHarmonyVoicing,
      0,
      4,
    );
    const dynamicGuidance = resolveRecordingHarmonyGuidance(
      dynamicInfo.selectedHarmonyVoicing,
      0,
      4,
    );

    expect(legacyGuidance.harmonyLine).toEqual(
      legacyInfo.harmonyVoicingLegacy?.lines[0] ?? null,
    );
    expect(dynamicGuidance.harmonyLine).toEqual(
      dynamicInfo.harmonyVoicingDynamic?.lines[0] ?? null,
    );
    expect(legacyGuidance.countInCueMidi).toBe(
      legacyInfo.harmonyVoicingLegacy?.lines[0]?.[0] ?? null,
    );
    expect(dynamicGuidance.countInCueMidi).toBe(
      dynamicInfo.harmonyVoicingDynamic?.lines[0]?.[0] ?? null,
    );
    expect(dynamicGuidance.countInCueMidi).not.toBe(
      legacyGuidance.countInCueMidi,
    );
  });
});
