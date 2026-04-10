import { describe, expect, it } from "vitest";
import { createEmptyTracksDocument } from "../src/state/tracksModel";

describe("createEmptyTracksDocument", () => {
  it("defaults harmony tracks quieter than melody and uses 20% reverb", () => {
    const document = createEmptyTracksDocument(4);
    const orderedTracks = document.trackOrder.map(
      (trackId) => document.tracksById[trackId],
    );

    expect(orderedTracks.map((track) => track?.role)).toEqual([
      "harmony",
      "harmony",
      "harmony",
      "melody",
    ]);
    expect(orderedTracks.map((track) => track?.volume)).toEqual([
      0.6,
      0.6,
      0.6,
      1,
    ]);
    expect(document.reverbWet).toBe(0.2);
  });
});
