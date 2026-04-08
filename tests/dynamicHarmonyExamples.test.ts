import { describe, expect, it } from "vitest";
import { generateHarmonyDynamic } from "../src/music/harmony";
import { midiToNoteName } from "../src/music/types";
import { parseChordText } from "../src/music/parse";

function renderDynamicProgressionVoicings(tokens: readonly string[]): string[] {
  const chords = tokens.map((token) => {
    const chord = parseChordText(token, 4);
    if (chord == null) {
      throw new Error(`Expected test chord to parse: ${token}`);
    }
    return chord;
  });

  const voicing = generateHarmonyDynamic(
    chords,
    { low: 48, high: 72 },
    3,
    "lower two thirds",
  );

  return tokens.map((token, chordIndex) => {
    const notes = voicing.lines
      .map((line) => line[chordIndex])
      .filter((note): note is number => note != null)
      .map((note) => midiToNoteName(note))
      .join(" ");

    return `${token} -> ${notes}`;
  });
}

function renderDynamicChordVoicing(token: string): string {
  return renderDynamicProgressionVoicings([token])[0]!;
}

describe("dynamic harmony chord examples", () => {
  const examples = [
    "A",
    "Am",
    "A7",
    "Am7",
    "Amaj7",
    "A9",
    "Am9",
    "A7b9",
    "Asus2",
    "A9sus4",
    "D7/A",
    "C7/G",
    "E/G#",
    "Fm6/Ab",
  ] as const;

  it("shows one-chord dynamic voicings", () => {
    expect(examples.map((token) => renderDynamicChordVoicing(token)))
      .toMatchInlineSnapshot(`
        [
          "A -> A3 C#4 E4",
          "Am -> A3 C4 E4",
          "A7 -> G3 A3 C#4",
          "Am7 -> G3 A3 C4",
          "Amaj7 -> G#3 A3 C#4",
          "A9 -> A3 B3 C#4",
          "Am9 -> C3 A3 B3",
          "A7b9 -> A3 A#3 C#4",
          "Asus2 -> A3 B3 E4",
          "A9sus4 -> A3 B3 D4",
          "D7/A -> A3 C4 D4",
          "C7/G -> G3 A#3 E4",
          "E/G# -> G#3 B3 E4",
          "Fm6/Ab -> G#3 C4 D4",
        ]
      `);
  });

  it("shows a 4-5-1 dynamic progression", () => {
    expect(renderDynamicProgressionVoicings(["D", "E", "A"]))
      .toMatchInlineSnapshot(`
        [
          "D -> D3 F#3 A3",
          "E -> E3 G#3 B3",
          "A -> E3 A3 C#4",
        ]
      `);
  });
});
