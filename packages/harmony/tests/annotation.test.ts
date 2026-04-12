import { describe, expect, it } from "vitest";
import { parseHarmonyInput, generateHarmony } from "../src/index";
import { labelHarmonyNoteForChord, describeHarmonyNotesForChord } from "../src/annotation";

function parseSymbol(token: string) {
  const parsed = parseHarmonyInput(token, { beatsPerBar: 4 });
  if (!parsed.ok) {
    throw new Error(parsed.issues[0]?.message ?? "Failed to parse chord");
  }
  return parsed.value.events[0]!.symbol;
}

describe("harmony annotation", () => {
  it("labels D over Em as b7", () => {
    expect(labelHarmonyNoteForChord(parseSymbol("Em"), 62)).toBe("b7");
  });

  it("dedupes and sorts edited notes into a stable formula", () => {
    expect(
      describeHarmonyNotesForChord(parseSymbol("Em"), [62, 59, 52, 74]),
    ).toBe("R 5 b7");
  });

  it("generates annotations from parsed input", () => {
    const parsed = parseHarmonyInput("A9", { beatsPerBar: 4 });
    if (!parsed.ok) throw new Error("Expected parse success");

    const harmony = generateHarmony(parsed.value, {
      range: { low: 48, high: 64 },
      voices: 3,
    });

    expect(harmony.annotations[0]?.chordTones).toBe("3 b7 9");
  });
});
