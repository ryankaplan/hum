import { describe, expect, it } from "vitest";
import { parseArrangementText } from "../src/state/arrangementModel";

type ExpectedSlice = {
  chordText: string;
  lyrics?: string;
  beats?: number;
  segmentKind?: "single" | "start" | "middle" | "end";
};

type ExpectedMeasure = ExpectedSlice[];

function checkParseArrangement(
  lines: string[],
  expectedMeasures: ExpectedMeasure[],
) {
  const arrangement = parseArrangementText(lines.join("\n"), 4);

  expect({
    parseIssues: arrangement.parseIssues,
    invalidChordIds: arrangement.invalidChordIds,
    measures: arrangement.measures.map((measure) =>
      measure.slices.map((slice) => ({
        chordText: slice.chordText,
        lyrics: slice.lyrics,
        beats: slice.durationBeats,
        segmentKind: slice.segmentKind,
      })),
    ),
  }).toEqual({
    parseIssues: [],
    invalidChordIds: [],
    measures: expectedMeasures.map((measure) =>
      measure.map((slice) => ({
        chordText: slice.chordText,
        lyrics: slice.lyrics ?? "",
        beats: slice.beats ?? 4,
        segmentKind: slice.segmentKind ?? "single",
      })),
    ),
  });
}

function checkParseIssues(lines: string[], expectedIssues: string[]) {
  const arrangement = parseArrangementText(lines.join("\n"), 4);
  expect(arrangement.parseIssues).toEqual(expectedIssues);
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

  it("builds sequential chord events without requiring bar fill", () => {
    const arrangement = parseArrangementText("A B. C", 4);
    expect(
      arrangement.chordEvents.map((event) => ({
        chordText: event.chordText,
        startBeat: event.startBeat,
        durationBeats: event.durationBeats,
      })),
    ).toEqual([
      { chordText: "A", startBeat: 0, durationBeats: 4 },
      { chordText: "B", startBeat: 4, durationBeats: 2 },
      { chordText: "C", startBeat: 6, durationBeats: 4 },
    ]);
  });

  it("derives continuation slices for cross-bar chords", () => {
    checkParseArrangement(["A. Bm"], [
      [
        { chordText: "A", beats: 2 },
        { chordText: "Bm", beats: 2, segmentKind: "start" },
      ],
      [{ chordText: "Bm", beats: 2, segmentKind: "end" }],
    ]);
  });

  it("allows partial final measures quietly", () => {
    checkParseArrangement(["A. Bm.."], [[
      { chordText: "A", beats: 2 },
      { chordText: "Bm", beats: 1 },
    ]]);
  });

  it("rejects retired grouped-bar syntax", () => {
    checkParseIssues(["[A B]"], ['Line 1: unsupported text "[".', 'Line 1: unsupported text "]".']);
  });
});
