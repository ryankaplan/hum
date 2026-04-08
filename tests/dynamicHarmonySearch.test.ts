import { describe, expect, it } from "vitest";
import {
  generateDynamicHarmonyRecipes,
  generateHarmonyCandidates,
  scoreHarmonyCandidate,
  type HarmonyVoicingCandidate,
} from "../src/music/harmony";
import { chooseBestDynamicPath } from "../src/music/harmonyShared";
import { parseChordText } from "../src/music/parse";

function parse(token: string) {
  const chord = parseChordText(token, 4);
  if (chord == null) {
    throw new Error(`Expected test chord to parse: ${token}`);
  }
  return chord;
}

function candidate(
  low: number,
  middle: number,
  top: number,
): HarmonyVoicingCandidate {
  return {
    notes: [low, middle, top],
    strategy: "closed",
  };
}

function greedyTopLine(
  chords: ReturnType<typeof parse>[],
  candidateSets: HarmonyVoicingCandidate[][],
  range: { low: number; high: number },
): number[] {
  let previous = candidateSets[0]![0]!;
  const tops = [previous.notes[2]];

  for (let i = 1; i < candidateSets.length; i++) {
    let best = candidateSets[i]![0]!;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const option of candidateSets[i]!) {
      const score = scoreHarmonyCandidate(option, previous, range, chords[i]);
      if (score < bestScore) {
        best = option;
        bestScore = score;
      }
    }

    tops.push(best.notes[2]);
    previous = best;
  }

  return tops;
}

describe("dynamic harmony recipe generation", () => {
  it("prefers 3-b7-9 for dominant 9 chords", () => {
    expect(generateDynamicHarmonyRecipes(parse("A9"))[0]?.chordTones).toBe(
      "3 b7 9",
    );
  });

  it("prefers 3-b7-b9 for flat-9 dominant chords", () => {
    expect(generateDynamicHarmonyRecipes(parse("A7b9"))[0]?.chordTones).toBe(
      "3 b7 b9",
    );
  });

  it("keeps the seventh in preferred major- and minor-seventh recipes", () => {
    expect(generateDynamicHarmonyRecipes(parse("Amaj7")).map((recipe) => recipe.chordTones))
      .toContain("R 3 7");
    expect(generateDynamicHarmonyRecipes(parse("Am7")).map((recipe) => recipe.chordTones))
      .toContain("R b3 b7");
  });

  it("pins slash-chord bass notes in the low voice", () => {
    const gSharpPitchClass = 8;
    const candidates = generateHarmonyCandidates(parse("E/G#"), {
      low: 48,
      high: 67,
    });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => candidate.notes[0] % 12 === gSharpPitchClass)).toBe(true);
  });
});

describe("chooseBestDynamicPath", () => {
  it("can prefer a smoother top line than local voice-leading alone", () => {
    const chords = ["A", "A", "A", "A"].map(parse);
    const range = { low: 48, high: 72 };
    const candidateSets = [
      [candidate(48, 55, 60)],
      [candidate(48, 55, 57), candidate(48, 55, 62)],
      [candidate(48, 55, 60), candidate(48, 55, 64)],
      [candidate(48, 55, 57), candidate(48, 55, 65)],
    ];

    const greedy = greedyTopLine(chords, candidateSets, range);
    const dynamic = chooseBestDynamicPath(chords, candidateSets, range).map(
      (choice) => choice.notes[2],
    );

    expect(greedy).toEqual([60, 62, 60, 57]);
    expect(dynamic).toEqual([60, 62, 64, 65]);
  });

  it("penalizes unrecovered leaps in the top line", () => {
    const chords = ["A", "A", "A"].map(parse);
    const path = chooseBestDynamicPath(
      chords,
      [
        [candidate(48, 55, 60)],
        [candidate(48, 55, 67)],
        [candidate(48, 55, 69), candidate(48, 55, 65)],
      ],
      { low: 48, high: 72 },
    );

    expect(path.map((choice) => choice.notes[2])).toEqual([60, 67, 65]);
  });
});
