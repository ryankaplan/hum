import { describe, expect, it } from "vitest";
import {
  describeHarmonyNotesForChord,
  labelHarmonyNoteForChord,
} from "../src/music/harmony";
import { parseChordText } from "../src/music/parse";

function parse(token: string) {
  const chord = parseChordText(token, 4);
  if (chord == null) {
    throw new Error(`Expected test chord to parse: ${token}`);
  }
  return chord;
}

describe("harmony annotation", () => {
  it("labels D over Em as b7", () => {
    expect(labelHarmonyNoteForChord(parse("Em"), 62)).toBe("b7");
  });

  it("keeps sus2 extensions labeled as 2", () => {
    expect(labelHarmonyNoteForChord(parse("Asus2"), 59)).toBe("2");
  });

  it("labels add9 extensions as 9", () => {
    expect(labelHarmonyNoteForChord(parse("Cadd9"), 62)).toBe("9");
  });

  it("labels the augmented fifth as #5", () => {
    expect(labelHarmonyNoteForChord(parse("C"), 68)).toBe("#5");
  });

  it("dedupes and sorts edited notes into a stable formula", () => {
    expect(
      describeHarmonyNotesForChord(parse("Em"), [62, 59, 52, 74]),
    ).toBe("R 5 b7");
  });
});
