import { rootSemitone } from "../parse";
import type { Chord, HarmonyChordAnnotation, MidiNote } from "../types";

export function chordToneFormula(
  chord: Chord,
): HarmonyChordAnnotation["chordTones"] {
  switch (chord.quality) {
    case "major":
      return "R 3 5";
    case "minor":
      return "R b3 5";
    case "add9":
      return "R 3 9";
    case "diminished":
      return "R b3 b5";
    case "major6":
      return "R 3 6";
    case "minor6":
      return "R b3 6";
    case "dominant7":
      return "R 3 b7";
    case "minor7":
      return "R b3 b7";
    case "major7":
      return "R 3 7";
    case "dominant9":
      return "R 3 9";
    case "minor9":
      return "R b3 9";
    case "dominant7Flat9":
      return "R 3 b9";
    case "minor7Flat9":
      return "R b3 b9";
    case "sus2":
      return "R 2 5";
    case "sus4":
      return "R 4 5";
    case "dominant9Sus2":
      return "R 2 9";
    case "dominant9Sus4":
      return "R 4 9";
  }
}

export function describeHarmonyNotesForChord(
  chord: Chord,
  notes: readonly MidiNote[],
): HarmonyChordAnnotation["chordTones"] {
  const rootPitchClass = normalizePitchClass(rootSemitone(chord.root));
  const intervals = sortIntervalsForQuality(
    chord.quality,
    uniquePitchClasses(
      notes.map((note) => normalizePitchClass(note - rootPitchClass)),
    ),
  );
  if (intervals.length === 0) {
    return chordToneFormula(chord);
  }
  return formatChordIntervals(chord.quality, intervals);
}

export function labelHarmonyNoteForChord(chord: Chord, midi: MidiNote): string {
  const rootPitchClass = normalizePitchClass(rootSemitone(chord.root));
  return labelIntervalForQuality(
    chord.quality,
    normalizePitchClass(midi - rootPitchClass),
  );
}

export function formatChordIntervals(
  quality: Chord["quality"],
  intervals: readonly number[],
): HarmonyChordAnnotation["chordTones"] {
  return intervals
    .map((interval) =>
      labelIntervalForQuality(quality, normalizePitchClass(interval)),
    )
    .join(" ");
}

function recipeIntervalPreferences(
  quality: Chord["quality"],
): Array<[number, number, number]> {
  switch (quality) {
    case "major":
      return [[0, 4, 7]];
    case "minor":
      return [[0, 3, 7]];
    case "add9":
      return [
        [0, 4, 2],
        [4, 7, 2],
        [0, 4, 7],
      ];
    case "diminished":
      return [[0, 3, 6]];
    case "major6":
      return [
        [0, 4, 9],
        [4, 7, 9],
      ];
    case "minor6":
      return [
        [0, 3, 9],
        [3, 7, 9],
      ];
    case "dominant7":
      return [
        [0, 4, 10],
        [4, 7, 10],
      ];
    case "minor7":
      return [
        [0, 3, 10],
        [3, 7, 10],
      ];
    case "major7":
      return [
        [0, 4, 11],
        [4, 7, 11],
      ];
    case "dominant9":
      return [
        [4, 10, 2],
        [0, 4, 10],
        [4, 7, 10],
      ];
    case "minor9":
      return [
        [3, 10, 2],
        [0, 3, 10],
        [3, 7, 10],
      ];
    case "dominant7Flat9":
      return [
        [4, 10, 1],
        [0, 4, 10],
        [4, 7, 10],
      ];
    case "minor7Flat9":
      return [
        [3, 10, 1],
        [0, 3, 10],
        [3, 7, 10],
      ];
    case "sus2":
      return [[0, 2, 7]];
    case "sus4":
      return [[0, 5, 7]];
    case "dominant9Sus2":
      return [
        [0, 2, 10],
        [2, 7, 10],
      ];
    case "dominant9Sus4":
      return [
        [5, 10, 2],
        [0, 5, 10],
        [5, 7, 10],
      ];
  }
}

function formulaIntervals(quality: Chord["quality"]): number[] {
  switch (quality) {
    case "major":
      return [0, 4, 7];
    case "minor":
      return [0, 3, 7];
    case "add9":
      return [0, 4, 7, 2];
    case "diminished":
      return [0, 3, 6];
    case "major6":
      return [0, 4, 7, 9];
    case "minor6":
      return [0, 3, 7, 9];
    case "dominant7":
      return [0, 4, 7, 10];
    case "minor7":
      return [0, 3, 7, 10];
    case "major7":
      return [0, 4, 7, 11];
    case "dominant9":
      return [0, 4, 7, 10, 2];
    case "minor9":
      return [0, 3, 7, 10, 2];
    case "dominant7Flat9":
      return [0, 4, 7, 10, 1];
    case "minor7Flat9":
      return [0, 3, 7, 10, 1];
    case "sus2":
      return [0, 2, 7];
    case "sus4":
      return [0, 5, 7];
    case "dominant9Sus2":
      return [0, 2, 7, 10];
    case "dominant9Sus4":
      return [0, 5, 7, 10, 2];
  }
}

function sortIntervalsForQuality(
  quality: Chord["quality"],
  intervals: readonly number[],
): number[] {
  const order = formulaIntervals(quality);
  return [...intervals].sort((left, right) => {
    const leftIndex = order.indexOf(left);
    const rightIndex = order.indexOf(right);
    if (leftIndex !== rightIndex) {
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    }
    return left - right;
  });
}

function labelIntervalForQuality(
  quality: Chord["quality"],
  interval: number,
): string {
  switch (normalizePitchClass(interval)) {
    case 0:
      return "R";
    case 1:
      return "b9";
    case 2:
      return quality === "sus2" || quality === "dominant9Sus2" ? "2" : "9";
    case 3:
      return "b3";
    case 4:
      return "3";
    case 5:
      return "4";
    case 6:
      return "b5";
    case 7:
      return "5";
    case 8:
      return "#5";
    case 9:
      return "6";
    case 10:
      return "b7";
    case 11:
      return "7";
    default:
      return String(interval);
  }
}

function uniquePitchClasses(values: readonly number[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];

  for (const value of values) {
    const normalized = normalizePitchClass(value);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function normalizePitchClass(note: number): number {
  return ((note % 12) + 12) % 12;
}

export { recipeIntervalPreferences };
