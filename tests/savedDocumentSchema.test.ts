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
      customArrangement: null,
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
      guideToneVolume: 1,
      beatVolume: 1,
      priorHarmonyVolume: 1,
    },
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
        customArrangement: {
          voices: [
            {
              id: "voice-0",
              events: [
                {
                  id: "bad",
                  startTick: 0,
                  durationTicks: 16,
                  midi: "not-a-midi-note",
                },
              ],
            },
          ],
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
        customArrangement: {
          voices: [
            {
              id: "voice-0",
              events: [
                { id: "a0", startTick: 0, durationTicks: 16, midi: 48 },
                { id: "a1", startTick: 16, durationTicks: 16, midi: null },
                { id: "a2", startTick: 32, durationTicks: 16, midi: 55 },
              ],
            },
          ],
        },
      },
    });

    expect(parsed?.arrangement.customArrangement?.voices[0]?.events).toEqual([
      { id: "a0", startTick: 0, durationTicks: 16, midi: 48 },
      { id: "a1", startTick: 16, durationTicks: 16, midi: null },
      { id: "a2", startTick: 32, durationTicks: 16, midi: 55 },
    ]);
  });

  it("accepts current drafts without persisted workflow state", () => {
    const parsed = parseSavedHumDocument(makeSavedHumDocument("lower two thirds"));

    expect(parsed?.tracks.reverbWet).toBe(0.2);
  });

  it("accepts persisted recording monitor preferences", () => {
    const parsed = parseSavedHumDocument(makeSavedHumDocument("lower two thirds"));

    expect(parsed?.recordingMonitorPreferences).toEqual({
      guideToneVolume: 1,
      beatVolume: 1,
      priorHarmonyVolume: 1,
    });
  });
});
