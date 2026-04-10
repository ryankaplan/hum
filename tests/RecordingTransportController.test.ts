import { describe, expect, it } from "vitest";
import { selectReferenceWaveformLane } from "../src/ui/RecordingTransportController";

describe("selectReferenceWaveformLane", () => {
  it("uses the designated reference track instead of the last prior lane", () => {
    const first = { trackId: "track-low", segments: [{ id: "first" }] };
    const second = { trackId: "track-mid", segments: [] };
    const third = { trackId: "track-melody", segments: [{ id: "third" }] };

    expect(
      selectReferenceWaveformLane([first, second, third], "track-low"),
    ).toBe(first);
  });

  it("returns null when the designated track is not among decoded prior lanes", () => {
    expect(
      selectReferenceWaveformLane([
        { trackId: "track-low", segments: [{ id: "low" }] },
        { trackId: "track-mid", segments: [{ id: "mid" }] },
      ], "track-melody"),
    ).toBeNull();
  });

  it("returns null when no reference track is set", () => {
    expect(
      selectReferenceWaveformLane([
        { trackId: "track-low", segments: [{ id: "low" }] },
        { trackId: "track-mid", segments: [{ id: "mid" }] },
      ], null),
    ).toBeNull();
  });

  it("returns null when the designated track has no decoded waveform segments", () => {
    expect(
      selectReferenceWaveformLane([
        { trackId: "track-low", segments: [] },
        { trackId: "track-mid", segments: [{ id: "mid" }] },
      ], "track-low"),
    ).toBeNull();
  });
});
