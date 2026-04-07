import { describe, expect, it } from "vitest";
import {
  computeArrangementInfo,
  parseArrangementText,
  type ArrangementDocState,
} from "../src/state/arrangementModel";

type ExpectedMeasure = Array<{
  chordText: string;
  lyrics?: string;
  beats?: number;
}>;

function makeArrangementDocState(
  chordsInput: string,
  overrides: Partial<ArrangementDocState> = {},
): ArrangementDocState {
  return {
    chordsInput,
    tempo: 80,
    meter: [4, 4],
    vocalRangeLow: "C3",
    vocalRangeHigh: "A4",
    totalParts: 4,
    ...overrides,
  };
}

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
        beats: arrangement.parsedChords[flattenChordIndex(expectedMeasures, measureIndex, chordIndex)]?.beats,
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
    checkParseIssues(["A Hm C"], ["Line 1 contains unsupported chord text."]);
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

describe("computeArrangementInfo", () => {
  it("derives structured measures and validity from raw text input", () => {
    const info = computeArrangementInfo(makeArrangementDocState("A. Bm. C"));

    expect({
      progressionIsValid: info.progressionIsValid,
      isValid: info.isValid,
      measures: info.measures.map((measure) =>
        measure.chords.map((chord) => chord.chordText),
      ),
    }).toEqual({
      progressionIsValid: true,
      isValid: true,
      measures: [["A", "Bm"], ["C"]],
    });
  });

  it("blocks arrangement validity when parse issues exist", () => {
    const info = computeArrangementInfo(makeArrangementDocState("A. Bm"));

    expect({
      progressionIsValid: info.progressionIsValid,
      isValid: info.isValid,
      parseIssues: info.parseIssues,
    }).toEqual({
      progressionIsValid: false,
      isValid: false,
      parseIssues: ["A measure exceeds 4 beats while grouping dotted durations."],
    });
  });
});
