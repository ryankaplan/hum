import { describe, expect, it } from "vitest";
import { generateHarmony } from "../src/music/harmony";
import { midiToNoteName } from "../src/music/types";
import { parseChordText } from "../src/music/parse";

function renderProgressionVoicings(
  tokens: readonly string[],
  beats: readonly number[] = tokens.map(() => 4),
  generator: typeof generateHarmony = generateHarmony,
): string[] {
  const chords = tokens.map((token, index) => {
    const chord = parseChordText(token, beats[index] ?? 4);
    if (chord == null) {
      throw new Error(`Expected test chord to parse: ${token}`);
    }
    return chord;
  });

  const voicing = generator(
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
  return renderProgressionVoicings([token])[0]!;
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
          "A7 -> E3 G3 C#4",
          "Am7 -> E3 G3 C4",
          "Amaj7 -> E3 G#3 C#4",
          "A9 -> C#3 G3 B3",
          "Am9 -> C3 G3 B3",
          "A7b9 -> G3 A#3 C#4",
          "Asus2 -> A3 B3 E4",
          "A9sus4 -> G3 B3 D4",
          "D7/A -> A3 C4 D4",
          "C7/G -> G3 A#3 E4",
          "E/G# -> G#3 B3 E4",
          "Fm6/Ab -> G#3 C4 D4",
        ]
      `);
  });

  it("shows a 4-5-1 dynamic progression", () => {
    expect(renderProgressionVoicings(["D", "E", "A"]))
      .toMatchInlineSnapshot(`
        [
          "D -> D3 F#3 A3",
          "E -> E3 G#3 B3",
          "A -> E3 A3 C#4",
        ]
      `);
  });

  it("renders an extended suspended progression", () => {
    const tokens = ["Am6", "E(b9)/G#", "Gm7", "C9sus4", "Fdim", "F6"] as const;
    const beats = [4, 4, 2, 2, 2, 2] as const;
    const dynamic = renderProgressionVoicings(tokens, beats, generateHarmony);

    expect(dynamic).toMatchInlineSnapshot(`
      [
        "Am6 -> F#3 A3 C4",
        "E(b9)/G# -> G#3 B3 D4",
        "Gm7 -> F3 A#3 D4",
        "C9sus4 -> F3 A#3 D4",
        "Fdim -> F3 G#3 B3",
        "F6 -> F3 A3 D4",
      ]
    `);
  });
});
