import { describe, expect, it } from "vitest";
import { parseArrangementText } from "../src/state/arrangementModel";

type ExpectedMeasure = Array<{
  chordText: string;
  lyrics?: string;
  beats?: number;
}>;

function checkParseArrangement(
  lines: string[],
  expectedMeasures: ExpectedMeasure[],
) {
  const arrangement = parseArrangementText(lines.join("\n"), 4);

  expect({
    parseIssues: arrangement.parseIssues,
    invalidChordIds: arrangement.invalidChordIds,
    measures: arrangement.measures.map((measure, measureIndex) =>
      measure.chords.map((chord, chordIndex) => ({
        chordText: chord.chordText,
        lyrics: chord.lyrics,
        beats:
          arrangement.parsedChords[
            flattenChordIndex(expectedMeasures, measureIndex, chordIndex)
          ]?.beats,
      })),
    ),
  }).toEqual({
    parseIssues: [],
    invalidChordIds: [],
    measures: expectedMeasures.map((measure) =>
      measure.map((chord) => ({
        chordText: chord.chordText,
        lyrics: chord.lyrics ?? "",
        beats: chord.beats ?? 4,
      })),
    ),
  });
}

function checkParseIssues(lines: string[], expectedIssues: string[]) {
  const arrangement = parseArrangementText(lines.join("\n"), 4);

  expect(arrangement.parseIssues).toEqual(expectedIssues);
}

function flattenChordIndex(
  measures: ExpectedMeasure[],
  measureIndex: number,
  chordIndex: number,
): number {
  let index = 0;
  for (let i = 0; i < measureIndex; i++) {
    index += measures[i]?.length ?? 0;
  }
  return index + chordIndex;
}

describe("parseArrangementText", () => {
  it("parses plain space-separated chords as one full measure each", () => {
    checkParseArrangement(["A Bm C"], [
      [{ chordText: "A" }],
      [{ chordText: "Bm" }],
      [{ chordText: "C" }],
    ]);
  });

  it("groups half-measure dotted chords into the same measure", () => {
    checkParseArrangement(["A. Bm. C"], [
      [
        { chordText: "A", beats: 2 },
        { chordText: "Bm", beats: 2 },
      ],
      [{ chordText: "C" }],
    ]);
  });

  it("groups quarter-measure dotted chords into one measure", () => {
    checkParseArrangement(["A.. Bm.. C.. D.."], [
      [
        { chordText: "A", beats: 1 },
        { chordText: "Bm", beats: 1 },
        { chordText: "C", beats: 1 },
        { chordText: "D", beats: 1 },
      ],
    ]);
  });

  it("supports mixed durations across multiple measures", () => {
    checkParseArrangement(["A. Bm. C.. D.. E."], [
      [
        { chordText: "A", beats: 2 },
        { chordText: "Bm", beats: 2 },
      ],
      [
        { chordText: "C", beats: 1 },
        { chordText: "D", beats: 1 },
        { chordText: "E", beats: 2 },
      ],
    ]);
  });

  it("parses alternating chord and lyric lines by monospaced alignment", () => {
    checkParseArrangement(
      [
        "A          E    F#m     D      A    E",
        "Where are we?   What the hell is going on?",
      ],
      [
        [{ chordText: "A", lyrics: "Where are we?" }],
        [{ chordText: "E" }],
        [{ chordText: "F#m", lyrics: "What the" }],
        [{ chordText: "D", lyrics: "hell is" }],
        [{ chordText: "A", lyrics: "going" }],
        [{ chordText: "E", lyrics: "on?" }],
      ],
    );
  });

  it("treats the first two chord lines as chord-only mode", () => {
    checkParseArrangement(["A Bm C", "D Em F"], [
      [{ chordText: "A" }],
      [{ chordText: "Bm" }],
      [{ chordText: "C" }],
      [{ chordText: "D" }],
      [{ chordText: "Em" }],
      [{ chordText: "F" }],
    ]);
  });

  it("ignores blank lines when deciding chord-only versus lyric mode", () => {
    checkParseArrangement(["A Bm C", "", "D Em F"], [
      [{ chordText: "A" }],
      [{ chordText: "Bm" }],
      [{ chordText: "C" }],
      [{ chordText: "D" }],
      [{ chordText: "Em" }],
      [{ chordText: "F" }],
    ]);
  });

  it("flags unsupported chord text", () => {
    checkParseIssues(["A Hm C"], ['Line 1: unsupported text "Hm".']);
  });

  it("reports the exact unsupported chord token when a matched token fails to parse", () => {
    checkParseIssues(["C9/F#"], ['Line 1: unsupported chord token "C9/F#".']);
  });

  it("parses diminished triad spellings", () => {
    checkParseArrangement(["Adim Ao"], [
      [{ chordText: "Adim" }],
      [{ chordText: "Ao" }],
    ]);
  });

  it("parses simple seventh-chord spellings and minor dash aliases", () => {
    checkParseArrangement(["A- A7 Am7 A-7 Amaj7 AM7"], [
      [{ chordText: "A-" }],
      [{ chordText: "A7" }],
      [{ chordText: "Am7" }],
      [{ chordText: "A-7" }],
      [{ chordText: "Amaj7" }],
      [{ chordText: "AM7" }],
    ]);
  });

  it("parses simple sixth-chord spellings", () => {
    checkParseArrangement(["A6 Am6 A-6"], [
      [{ chordText: "A6" }],
      [{ chordText: "Am6" }],
      [{ chordText: "A-6" }],
    ]);
  });

  it("parses seventh chords inside dotted-duration measures", () => {
    checkParseArrangement(["A7. A-7. AM7"], [
      [
        { chordText: "A7", beats: 2 },
        { chordText: "A-7", beats: 2 },
      ],
      [{ chordText: "AM7" }],
    ]);
  });

  it("parses lyric-aligned seventh chords", () => {
    checkParseArrangement(
      [
        "A7        A-7      AM7",
        "where     do we    land",
      ],
      [
        [{ chordText: "A7", lyrics: "where" }],
        [{ chordText: "A-7", lyrics: "do we" }],
        [{ chordText: "AM7", lyrics: "land" }],
      ],
    );
  });

  it("parses add9, ninth, suspended, and slash chords", () => {
    checkParseArrangement(
      ["Cadd9 C9 Cm9 C7b9 C(b9) Cm7b9 Csus2 Csus4 C9sus2 C9sus4 E/G# Fm6/Ab"],
      [
        [{ chordText: "Cadd9" }],
        [{ chordText: "C9" }],
        [{ chordText: "Cm9" }],
        [{ chordText: "C7b9" }],
        [{ chordText: "C(b9)" }],
        [{ chordText: "Cm7b9" }],
        [{ chordText: "Csus2" }],
        [{ chordText: "Csus4" }],
        [{ chordText: "C9sus2" }],
        [{ chordText: "C9sus4" }],
        [{ chordText: "E/G#" }],
        [{ chordText: "Fm6/Ab" }],
      ],
    );
  });

  it("parses dotted durations for ninth and slash chords", () => {
    checkParseArrangement(["C9. C9sus4. Fm6/Ab"], [
      [
        { chordText: "C9", beats: 2 },
        { chordText: "C9sus4", beats: 2 },
      ],
      [{ chordText: "Fm6/Ab" }],
    ]);
  });

  it("parses lyric-aligned ninth and slash chords", () => {
    checkParseArrangement(
      [
        "E/G#      G9sus4    Fm6/Ab",
        "quiet     how       lovely",
      ],
      [
        [{ chordText: "E/G#", lyrics: "quiet" }],
        [{ chordText: "G9sus4", lyrics: "how" }],
        [{ chordText: "Fm6/Ab", lyrics: "lovely" }],
      ],
    );
  });

  it("accepts slash chords whose bass is a non-reduced chord tone", () => {
    checkParseArrangement(["D7/A C7/G Cadd9/G"], [
      [{ chordText: "D7/A" }],
      [{ chordText: "C7/G" }],
      [{ chordText: "Cadd9/G" }],
    ]);
  });

  it("disambiguates parenthesized b9 from flat-root nine in arrangement lines", () => {
    checkParseArrangement(["E(b9) Eb9"], [
      [{ chordText: "E(b9)" }],
      [{ chordText: "Eb9" }],
    ]);
  });

  it("parses the quiet nights chart fixture", () => {
    checkParseArrangement(
      [
        "Am6",
        "Quiet nights of quiet stars",
        "E",
        "Quiet chords from my guitar",
        "Gm7             C                Fdim   F6",
        "Floating on the silence that sur rounds us",
        "Fm7            B",
        "Quiet thoughts and quiet dreams",
        "E7             A7",
        "Quiet walks by quiet streams",
        "Am7          Am6               Fm6",
        "And a window that looks out on Corcovado,",
        "G      Fm6",
        "Oh how lovely!",
      ],
      [
        [{ chordText: "Am6", lyrics: "Quiet nights of quiet stars" }],
        [{ chordText: "E", lyrics: "Quiet chords from my guitar" }],
        [{ chordText: "Gm7", lyrics: "Floating on the" }],
        [{ chordText: "C", lyrics: "silence that sur" }],
        [{ chordText: "Fdim", lyrics: "rounds" }],
        [{ chordText: "F6", lyrics: "us" }],
        [{ chordText: "Fm7", lyrics: "Quiet thoughts" }],
        [{ chordText: "B", lyrics: "and quiet dreams" }],
        [{ chordText: "E7", lyrics: "Quiet walks by" }],
        [{ chordText: "A7", lyrics: "quiet streams" }],
        [{ chordText: "Am7", lyrics: "And a window" }],
        [{ chordText: "Am6", lyrics: "that looks out on" }],
        [{ chordText: "Fm6", lyrics: "Corcovado," }],
        [{ chordText: "G", lyrics: "Oh how" }],
        [{ chordText: "Fm6", lyrics: "lovely!" }],
      ],
    );
  });

  it("parses the quiet nights sample block with new chord forms", () => {
    checkParseArrangement(
      [
        "Am6",
        "Quiet nights of quiet stars",
        "E/G#",
        "Quiet chords from my guitar",
        "Gm7             C9sus4         Fdim      F6",
        "Floating on the silence that surrounds us",
        "Fm7             B",
        "Quiet thoughts and quiet dreams",
        "E7          A7",
        "Quiet walks by quiet streams",
        "Am7             Am6             Fm6/Ab",
        "And a window that looks out on Corcovado,",
        "G9sus4  Fm6/Ab",
        "Oh how lovely!",
      ],
      [
        [{ chordText: "Am6", lyrics: "Quiet nights of quiet stars" }],
        [{ chordText: "E/G#", lyrics: "Quiet chords from my guitar" }],
        [{ chordText: "Gm7", lyrics: "Floating on the" }],
        [{ chordText: "C9sus4", lyrics: "silence that surrounds" }],
        [{ chordText: "Fdim", lyrics: "us" }],
        [{ chordText: "F6" }],
        [{ chordText: "Fm7", lyrics: "Quiet thoughts and" }],
        [{ chordText: "B", lyrics: "quiet dreams" }],
        [{ chordText: "E7", lyrics: "Quiet walks" }],
        [{ chordText: "A7", lyrics: "by quiet streams" }],
        [{ chordText: "Am7", lyrics: "And a window that" }],
        [{ chordText: "Am6", lyrics: "looks out on Corcovado," }],
        [{ chordText: "Fm6/Ab" }],
        [{ chordText: "G9sus4", lyrics: "Oh how lovely!" }],
        [{ chordText: "Fm6/Ab" }],
      ],
    );
  });

  it("rejects incomplete measures", () => {
    checkParseIssues(
      ["A. Bm.."],
      ["A measure is incomplete; dotted durations must add up to 4 beats."],
    );
  });

  it("rejects overflowing measures", () => {
    checkParseIssues(
      ["A. Bm"],
      ["A measure exceeds 4 beats while grouping dotted durations."],
    );
  });
});
