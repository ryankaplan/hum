import { describe, expect, it } from "vitest";
import { selectReferenceWaveformLane } from "../src/ui/RecordingTransportController";

describe("selectReferenceWaveformLane", () => {
  it("prefers the most recent prior lane with audio", () => {
    const first = { segments: [{ id: "first" }] };
    const second = { segments: [] };
    const third = { segments: [{ id: "third" }] };

    expect(selectReferenceWaveformLane([first, second, third])).toBe(third);
  });

  it("returns null when no prior lane has audio", () => {
    expect(
      selectReferenceWaveformLane([
        { segments: [] },
        { segments: [] },
      ]),
    ).toBeNull();
  });
});
