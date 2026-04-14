import { describe, expect, it } from "vitest";
import {
  chordPitchClassNames,
  formatChordSymbol,
  parseChordText,
} from "../src/music/parse";

describe("chord parsing", () => {
  it("round-trips add9 chords and keeps their reduced color tone", () => {
    const chord = parseChordText("Cadd9/G", 4);

    expect(chord).toMatchObject({
      root: "C",
      quality: "add9",
      bass: "G",
      beats: 4,
    });
    expect(chordPitchClassNames(chord!)).toBe("C E D");
    expect(formatChordSymbol(chord!)).toBe("Cadd9/G");
  });
});
