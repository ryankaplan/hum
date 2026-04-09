import { describe, expect, it } from "vitest";
import {
  parseSavedHumDocument,
  SAVED_HUM_DOCUMENT_SCHEMA_VERSION,
} from "../src/state/savedDocumentSchema";

function makeSavedHumDocument(
  harmonyRangeCoverage: string,
  selectedHarmonyGenerator?: "legacy" | "dynamic",
) {
  return {
    schemaVersion: SAVED_HUM_DOCUMENT_SCHEMA_VERSION,
    id: "current",
    arrangement: {
      chordsInput: "A",
      tempo: 80,
      meter: [4, 4],
      vocalRangeLow: "C3",
      vocalRangeHigh: "A4",
      harmonyRangeCoverage,
      selectedHarmonyGenerator,
      totalParts: 4,
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
    currentPartIndex: 0,
    appScreen: "setup",
    latencyCorrectionSec: 0,
    isCalibrated: false,
    selectedMicId: "mic-1",
  };
}

describe("parseSavedHumDocument", () => {
  it("rejects older schema versions", () => {
    const parsed = parseSavedHumDocument({
      ...makeSavedHumDocument("lower two thirds"),
      schemaVersion: "4",
    });

    expect(parsed).toBeNull();
  });

  it("accepts the current harmony coverage values", () => {
    const coverages = ["lower two thirds", "whole-range"] as const;

    for (const coverage of coverages) {
      const parsed = parseSavedHumDocument(makeSavedHumDocument(coverage));
      expect(parsed?.arrangement.harmonyRangeCoverage).toBe(coverage);
    }
  });

  it("accepts supported selected harmony generators", () => {
    const generators = ["legacy", "dynamic"] as const;

    for (const generator of generators) {
      const parsed = parseSavedHumDocument(
        makeSavedHumDocument("lower two thirds", generator),
      );
      expect(parsed?.arrangement.selectedHarmonyGenerator).toBe(generator);
    }
  });

  it("rejects retired harmony coverage values", () => {
    const parsed = parseSavedHumDocument(makeSavedHumDocument("lower-half"));

    expect(parsed).toBeNull();
  });

  it("rejects invalid custom harmony payloads", () => {
    const parsed = parseSavedHumDocument({
      ...makeSavedHumDocument("lower two thirds"),
      arrangement: {
        ...makeSavedHumDocument("lower two thirds").arrangement,
        customHarmony: {
          lines: [["not-a-midi-note"]],
        },
      },
    });

    expect(parsed).toBeNull();
  });

  it("accepts nullable custom harmony payloads", () => {
    const parsed = parseSavedHumDocument({
      ...makeSavedHumDocument("lower two thirds"),
      arrangement: {
        ...makeSavedHumDocument("lower two thirds").arrangement,
        customHarmony: {
          lines: [[48, null, 55]],
        },
      },
    });

    expect(parsed?.arrangement.customHarmony?.lines).toEqual([[48, null, 55]]);
  });

  it("accepts a missing selected mic id for older drafts", () => {
    const raw = makeSavedHumDocument("lower two thirds");
    delete raw.selectedMicId;

    const parsed = parseSavedHumDocument(raw);

    expect(parsed?.selectedMicId).toBeUndefined();
  });
});
