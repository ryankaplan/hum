import { describe, expect, it } from "vitest";
import {
  computeArrangementInfo,
  parseArrangementText,
  type ArrangementDocState,
} from "../src/state/arrangementModel";
import { generateHarmony } from "../src/music/harmony";
import { chordPitchClassNames, parseChordText, rootSemitone } from "../src/music/parse";

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

describe("simple seventh-chord support", () => {
  it("normalizes supported simple seventh spellings into chord qualities", () => {
    expect(parseChordText("A-", 4)?.quality).toBe("minor");
    expect(parseChordText("Adim", 4)?.quality).toBe("diminished");
    expect(parseChordText("Ao", 4)?.quality).toBe("diminished");
    expect(parseChordText("A6", 4)?.quality).toBe("major6");
    expect(parseChordText("Am6", 4)?.quality).toBe("minor6");
    expect(parseChordText("A-6", 4)?.quality).toBe("minor6");
    expect(parseChordText("A7", 4)?.quality).toBe("dominant7");
    expect(parseChordText("Am7", 4)?.quality).toBe("minor7");
    expect(parseChordText("A-7", 4)?.quality).toBe("minor7");
    expect(parseChordText("Amaj7", 4)?.quality).toBe("major7");
    expect(parseChordText("AM7", 4)?.quality).toBe("major7");
  });

  it("shows the expected three pitch classes for seventh chords", () => {
    expect(chordPitchClassNames(parseChordText("Adim", 4)!)).toBe("A C D#");
    expect(chordPitchClassNames(parseChordText("A6", 4)!)).toBe("A C# F#");
    expect(chordPitchClassNames(parseChordText("Am6", 4)!)).toBe("A C F#");
    expect(chordPitchClassNames(parseChordText("A7", 4)!)).toBe("A C# G");
    expect(chordPitchClassNames(parseChordText("Am7", 4)!)).toBe("A C G");
    expect(chordPitchClassNames(parseChordText("Amaj7", 4)!)).toBe("A C# G#");
  });

  it("annotates diminished chords with the expected formula", () => {
    const voicing = generateHarmony(
      [parseChordText("Adim", 4)!],
      { low: 48, high: 72 },
      3,
    );

    expect(voicing.annotations.map((annotation) => annotation.chordTones)).toEqual([
      "R b3 b5",
    ]);
  });

  it("annotates sixth chords with the expected formulas", () => {
    const voicing = generateHarmony(
      [parseChordText("A6", 4)!, parseChordText("Am6", 4)!],
      { low: 48, high: 72 },
      3,
    );

    expect(voicing.annotations.map((annotation) => annotation.chordTones)).toEqual([
      "R 3 6",
      "R b3 6",
    ]);
  });

  it("annotates seventh chords with the expected formulas", () => {
    const voicing = generateHarmony(
      [
        parseChordText("A7", 4)!,
        parseChordText("Am7", 4)!,
        parseChordText("Amaj7", 4)!,
      ],
      { low: 48, high: 72 },
      3,
    );

    expect(voicing.annotations.map((annotation) => annotation.chordTones)).toEqual([
      "R 3 b7",
      "R b3 b7",
      "R 3 7",
    ]);
  });

  it("omits the fifth when voicing seventh chords", () => {
    const chord = parseChordText("A7", 4)!;
    const voicing = generateHarmony([chord], { low: 48, high: 72 }, 3);
    const voicedPitchClasses = voicing.lines.map((line) => ((line[0] ?? 0) % 12 + 12) % 12);

    expect(new Set(voicedPitchClasses)).toEqual(
      new Set([
        rootSemitone(chord.root) % 12,
        (rootSemitone(chord.root) + 4) % 12,
        (rootSemitone(chord.root) + 10) % 12,
      ]),
    );
    expect(new Set(voicedPitchClasses)).not.toContain((rootSemitone(chord.root) + 7) % 12);
  });
});
