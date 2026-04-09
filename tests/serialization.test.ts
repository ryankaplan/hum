import { describe, expect, it } from "vitest";
import {
  deserializeHumDocument,
  serializeHumDocument,
  type DraftSnapshot,
} from "../src/state/serialization";

function makeDraftSnapshot(
  selectedHarmonyGenerator: "legacy" | "dynamic",
): DraftSnapshot {
  return {
    document: {
      arrangement: {
        chordsInput: "A9",
        tempo: 80,
        meter: [4, 4],
        vocalRangeLow: "C3",
        vocalRangeHigh: "A4",
        harmonyRangeCoverage: "lower two thirds",
        selectedHarmonyGenerator,
        totalParts: 4,
        customHarmony: {
          lines: [[48, null], [52, 53], [55, 57]],
        },
      },
      tracks: {
        trackOrder: [],
        tracksById: {},
        clipsById: {},
        recordingsById: {},
        reverbWet: 0.2,
      },
      exportPreferences: {
        preferredFormat: null,
      },
      recordingMonitorPreferences: {
        guideToneVolume: 0.4,
        beatVolume: 0.7,
        priorHarmonyVolume: 0.2,
      },
    },
  };
}

describe("serializeHumDocument / deserializeHumDocument", () => {
  it("round-trips the selected harmony generator", () => {
    const serialized = serializeHumDocument(makeDraftSnapshot("legacy"));
    const restored = deserializeHumDocument(serialized);

    expect(restored.document.arrangement.selectedHarmonyGenerator).toBe(
      "legacy",
    );
  });

  it("defaults missing selected harmony generator values to dynamic", () => {
    const serialized = serializeHumDocument(makeDraftSnapshot("legacy"));
    delete serialized.arrangement.selectedHarmonyGenerator;

    const restored = deserializeHumDocument(serialized);

    expect(restored.document.arrangement.selectedHarmonyGenerator).toBe(
      "dynamic",
    );
  });

  it("round-trips nullable custom harmony slots", () => {
    const serialized = serializeHumDocument(makeDraftSnapshot("dynamic"));
    const restored = deserializeHumDocument(serialized);

    expect(restored.document.arrangement.customHarmony?.lines).toEqual([
      [48, null],
      [52, 53],
      [55, 57],
    ]);
  });

  it("round-trips recording monitor preferences", () => {
    const serialized = serializeHumDocument(makeDraftSnapshot("dynamic"));
    const restored = deserializeHumDocument(serialized);

    expect(restored.document.recordingMonitorPreferences).toEqual({
      guideToneVolume: 0.4,
      beatVolume: 0.7,
      priorHarmonyVolume: 0.2,
    });
  });
});
