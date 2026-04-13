import { describe, expect, it } from "vitest";
import {
  deserializeHumDocument,
  serializeHumDocument,
  type DraftSnapshot,
} from "../src/state/serialization";

function makeDraftSnapshot(
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
        harmonyPriority: "chordIntent",
        totalParts: 4,
        customArrangement: {
          voices: [
            {
              id: "voice-0",
              events: [
                { id: "a0", startTick: 0, durationTicks: 16, midi: 48 },
                { id: "a1", startTick: 16, durationTicks: 16, midi: null },
              ],
            },
            {
              id: "voice-1",
              events: [
                { id: "b0", startTick: 0, durationTicks: 16, midi: 52 },
                { id: "b1", startTick: 16, durationTicks: 16, midi: 53 },
              ],
            },
            {
              id: "voice-2",
              events: [
                { id: "c0", startTick: 0, durationTicks: 16, midi: 55 },
                { id: "c1", startTick: 16, durationTicks: 16, midi: 57 },
              ],
            },
          ],
        },
      },
      tracks: {
        trackOrder: [],
        tracksById: {},
        clipsById: {},
        recordingsById: {},
        referenceWaveformTrackId: null,
        reverbWet: 0.2,
      },
    },
  };
}

describe("serializeHumDocument / deserializeHumDocument", () => {
  it("round-trips nullable custom harmony slots", () => {
    const serialized = serializeHumDocument(makeDraftSnapshot());
    const restored = deserializeHumDocument(serialized);

    expect(restored.document.arrangement.harmonyPriority).toBe("chordIntent");
    expect(restored.document.arrangement.customArrangement?.voices[0]?.events).toEqual([
      { id: "a0", startTick: 0, durationTicks: 16, midi: 48 },
      { id: "a1", startTick: 16, durationTicks: 16, midi: null },
    ]);
  });

  it("does not serialize UI preferences into saved drafts", () => {
    const serialized = serializeHumDocument(makeDraftSnapshot());

    expect("recordingMonitorPreferences" in serialized).toBe(false);
    expect("exportPreferences" in serialized).toBe(false);
  });

  it("round-trips the reference waveform track id and defaults missing values to null", () => {
    const serialized = serializeHumDocument(makeDraftSnapshot());
    serialized.tracks.trackOrder = ["track-1"];
    serialized.tracks.tracksById = {
      "track-1": {
        id: "track-1",
        role: "melody",
        clipIds: [],
        volume: 1,
        muted: false,
      },
    };
    serialized.tracks.referenceWaveformTrackId = "track-1";

    const restored = deserializeHumDocument(serialized);
    expect(restored.document.tracks.referenceWaveformTrackId).toBe("track-1");

    delete serialized.tracks.referenceWaveformTrackId;
    const restoredWithoutReference = deserializeHumDocument(serialized);
    expect(restoredWithoutReference.document.tracks.referenceWaveformTrackId).toBeNull();
  });
});
