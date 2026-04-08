import { describe, expect, it } from "vitest";
import { generateHarmonyGreedy } from "../src/music/harmony";
import { midiToNoteName } from "../src/music/types";
import { parseChordText } from "../src/music/parse";

function renderGreedyChordVoicing(token: string): string {
  const chord = parseChordText(token, 4);
  if (chord == null) {
    throw new Error(`Expected test chord to parse: ${token}`);
  }

  const voicing = generateHarmonyGreedy(
    [chord],
    { low: 48, high: 72 },
    3,
    "lower-two-thirds",
  );

  const notes = voicing.lines
    .map((line) => line[0])
    .filter((note): note is number => note != null)
    .map((note) => midiToNoteName(note))
    .join(" ");

  return `${token} -> ${notes}`;
}

describe("greedy harmony chord examples", () => {
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

  it("shows one-chord greedy voicings", () => {
    expect(examples.map((token) => renderGreedyChordVoicing(token)))
      .toMatchInlineSnapshot(`
        [
          "A -> C#3 A3 E4",
          "Am -> C3 A3 E4",
          "A7 -> G3 A3 C#4",
          "Am7 -> G3 A3 C4",
          "Amaj7 -> G#3 A3 C#4",
          "A9 -> C#3 A3 B3",
          "Am9 -> C3 A3 B3",
          "A7b9 -> C#3 A3 A#3",
          "Asus2 -> E3 A3 B3",
          "A9sus4 -> D3 A3 B3",
          "D7/A -> C3 F#3 D4",
          "C7/G -> G3 A#3 E4",
          "E/G# -> G#3 B3 E4",
          "Fm6/Ab -> F3 G#3 D4",
        ]
      `);
  });
});
