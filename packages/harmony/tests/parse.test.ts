import { describe, expect, it } from "vitest";
import { parseHarmonyInput } from "../src/index";

describe("parseHarmonyInput", () => {
  it("parses chart strings into timed events and measures", () => {
    const parsed = parseHarmonyInput("A. Bm", { beatsPerBar: 4 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value.events.map((event) => ({
      sourceText: event.sourceText,
      startBeat: event.startBeat,
      durationBeats: event.durationBeats,
    }))).toEqual([
      { sourceText: "A", startBeat: 0, durationBeats: 2 },
      { sourceText: "Bm", startBeat: 2, durationBeats: 4 },
    ]);
    expect(parsed.value.measures[0]?.slices[1]?.segmentKind).toBe("start");
    expect(parsed.value.measures[1]?.slices[0]?.segmentKind).toBe("end");
  });

  it("preserves original spelling in sourceText", () => {
    const parsed = parseHarmonyInput("Bbmaj7", { beatsPerBar: 4 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value.events[0]?.sourceText).toBe("Bbmaj7");
    expect(parsed.value.events[0]?.symbol.root).toBe("A#");
  });

  it("returns structured issues for invalid input", () => {
    const parsed = parseHarmonyInput("[A B]", { beatsPerBar: 4 });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;

    expect(parsed.issues.map((issue) => issue.message)).toEqual([
      'Line 1: unsupported text "[".',
      'Line 1: unsupported text "]".',
    ]);
  });
});
