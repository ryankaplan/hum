import { fullChordSemitones, rootSemitone } from "./parse";
import type { ChordQuality, ChordSymbol, MidiNote, VocalRange } from "./types";

export type HarmonyDyadCandidate = {
  notes: [MidiNote, MidiNote];
  recipePriority?: number;
};

const DYAD_RECIPE_PRIORITY_PENALTY = 2.5;
const DYAD_HARD_MAX_SPAN = 19;

export function generateDyadCandidates(
  chord: ChordSymbol,
  range: VocalRange,
): HarmonyDyadCandidate[] {
  const generated =
    chord.bass != null
      ? generateSlashDyadCandidates(chord, range)
      : generateNonSlashDyadCandidates(chord, range);

  return generated.sort((left, right) =>
    compareDyadSearchCandidates(left, right, chord, range),
  );
}

export function buildFallbackDyadCandidate(
  chord: ChordSymbol,
  range: VocalRange,
): HarmonyDyadCandidate {
  const sourcePitchClasses =
    chord.bass != null
      ? [
          normalizePitchClassFromNoteName(chord.bass),
          ...preferredSlashUpperClasses(
            chord,
            normalizePitchClassFromNoteName(chord.bass),
          ),
        ]
      : uniquePitchClasses(
          generateDyadRecipes(chord).flatMap((recipe) => [...recipe.pitchClasses]),
        );

  const distinctPitchClasses =
    sourcePitchClasses.length > 0 ? sourcePitchClasses : fullChordPitchClasses(chord);
  const allNotes = distinctPitchClasses.flatMap((pitchClass) =>
    pitchClassNotesInRange(pitchClass, range),
  );
  const sortedNotes = [...new Set(allNotes)].sort((left, right) => left - right);

  if (sortedNotes.length >= 2) {
    return {
      notes: [sortedNotes[0]!, sortedNotes[sortedNotes.length - 1]!],
    };
  }

  return {
    notes: [range.low, range.high],
  };
}

export function scoreDyadCandidate(
  candidate: HarmonyDyadCandidate,
  previousCandidate: HarmonyDyadCandidate | null,
  range: VocalRange,
  chord?: ChordSymbol,
): number {
  const [low, high] = candidate.notes;
  const span = high - low;
  let score = 0;

  if (!(low < high)) {
    score += 10000;
  }
  if (span < 3) {
    score += 10000;
  }
  if (span > DYAD_HARD_MAX_SPAN) {
    score += (span - DYAD_HARD_MAX_SPAN) * 100;
  }

  if (chord?.bass != null) {
    const preferredBass = normalizePitchClassFromNoteName(chord.bass);
    if (normalizePitchClass(low) !== preferredBass) {
      score += 60;
    }
  }

  score += dyadSpacingPenalty(span);

  if (previousCandidate == null) {
    const center = (range.low + range.high) / 2;
    const average = (low + high) / 2;
    const targetTop = range.high - 2;

    if (chord != null && chord.bass == null) {
      const preferredBass = normalizePitchClassFromNoteName(chord.root);
      if (normalizePitchClass(low) !== preferredBass) {
        score += 1.2;
      } else {
        score -= 1;
      }
    }

    score += Math.abs(average - center) * 1.15;
    score += Math.abs(high - targetTop) * 0.6;
    return score;
  }

  const [previousLow, previousHigh] = previousCandidate.notes;
  const lowDelta = Math.abs(low - previousLow);
  const highDelta = Math.abs(high - previousHigh);

  score += lowDelta * 0.85;
  score += highDelta;
  score += lowMotionPenalty(lowDelta);
  score += highMotionPenalty(highDelta);

  if (normalizePitchClass(low) === normalizePitchClass(previousLow)) {
    score -= 1.5;
  }
  if (normalizePitchClass(high) === normalizePitchClass(previousHigh)) {
    score -= 2;
  }

  const lowDirection = direction(low - previousLow);
  const highDirection = direction(high - previousHigh);
  if (lowDirection !== 0 && highDirection !== 0 && lowDirection === highDirection) {
    if (Math.max(lowDelta, highDelta) >= 3) {
      score += 2.2;
    }
    if (lowDelta >= 3 && highDelta >= 3) {
      score += 1.4;
    }
  }

  score +=
    Math.abs((low + high) / 2 - (previousLow + previousHigh) / 2) * 0.75;

  if (chord != null && chord.bass == null) {
    const preferredBass = normalizePitchClassFromNoteName(chord.root);
    if (normalizePitchClass(low) !== preferredBass) {
      score += 0.4;
    }
  }

  return score;
}

export function scoreDyadSearchCandidate(
  candidate: HarmonyDyadCandidate,
  previousCandidate: HarmonyDyadCandidate | null,
  range: VocalRange,
  chord?: ChordSymbol,
): number {
  return (
    scoreDyadCandidate(candidate, previousCandidate, range, chord) +
    (candidate.recipePriority ?? 0) * DYAD_RECIPE_PRIORITY_PENALTY
  );
}

function generateNonSlashDyadCandidates(
  chord: ChordSymbol,
  range: VocalRange,
): HarmonyDyadCandidate[] {
  const candidates = new Map<string, HarmonyDyadCandidate>();
  const recipes = generateDyadRecipes(chord);

  for (const [recipePriority, recipe] of recipes.entries()) {
    const orderings: Array<[number, number]> =
      recipe.intervals[0] === recipe.intervals[1]
        ? [recipe.pitchClasses]
        : [recipe.pitchClasses, [recipe.pitchClasses[1], recipe.pitchClasses[0]]];

    for (const [lowClass, highClass] of orderings) {
      const lowNotes = pitchClassNotesInRange(lowClass, range);
      const highNotes = pitchClassNotesInRange(highClass, range);

      for (const low of lowNotes) {
        for (const high of highNotes) {
          if (high <= low) continue;
          const notes = [low, high] as [MidiNote, MidiNote];
          if (!isDyadSpacingAllowed(notes)) continue;
          addDyadCandidate(candidates, {
            notes,
            recipePriority,
          });
        }
      }
    }
  }

  return [...candidates.values()];
}

function generateSlashDyadCandidates(
  chord: ChordSymbol,
  range: VocalRange,
): HarmonyDyadCandidate[] {
  if (chord.bass == null) return [];

  const bassClass = normalizePitchClassFromNoteName(chord.bass);
  const lowNotes = pitchClassNotesInRange(bassClass, range);
  const upperClasses = preferredSlashUpperClasses(chord, bassClass);
  const candidates = new Map<string, HarmonyDyadCandidate>();

  for (const low of lowNotes) {
    for (const [recipePriority, upperClass] of upperClasses.entries()) {
      const highNotes = pitchClassNotesInRange(upperClass, range);
      for (const high of highNotes) {
        if (high <= low) continue;
        const notes = [low, high] as [MidiNote, MidiNote];
        if (!isDyadSpacingAllowed(notes)) continue;
        addDyadCandidate(candidates, {
          notes,
          recipePriority,
        });
      }
    }
  }

  return [...candidates.values()];
}

function generateDyadRecipes(chord: ChordSymbol): Array<{
  intervals: [number, number];
  pitchClasses: [number, number];
}> {
  const rootPitchClass = normalizePitchClass(rootSemitone(chord.root));
  const availableIntervals = new Set(fullChordIntervals(chord));
  const seen = new Set<string>();
  const recipes: Array<{
    intervals: [number, number];
    pitchClasses: [number, number];
  }> = [];

  for (const intervals of dyadIntervalPreferences(chord.quality)) {
    const normalizedIntervals = intervals.map((interval) =>
      normalizePitchClass(interval),
    ) as [number, number];
    if (
      normalizedIntervals.some(
        (interval) => availableIntervals.has(interval) === false,
      )
    ) {
      continue;
    }

    const key = [...normalizedIntervals].sort((left, right) => left - right).join(",");
    if (seen.has(key)) continue;
    seen.add(key);

    recipes.push({
      intervals: normalizedIntervals,
      pitchClasses: normalizedIntervals.map((interval) =>
        normalizePitchClass(rootPitchClass + interval),
      ) as [number, number],
    });
  }

  return recipes;
}

function dyadIntervalPreferences(quality: ChordQuality): Array<[number, number]> {
  switch (quality) {
    case "major":
      return [[0, 4], [4, 7], [0, 7]];
    case "minor":
      return [[0, 3], [3, 7], [0, 7]];
    case "add9":
      return [[4, 2], [0, 2], [0, 4]];
    case "diminished":
      return [[0, 6], [3, 6], [0, 3]];
    case "major6":
      return [[0, 9], [4, 9], [0, 4]];
    case "minor6":
      return [[0, 9], [3, 9], [0, 3]];
    case "dominant7":
      return [[4, 10], [0, 10], [0, 4]];
    case "minor7":
      return [[3, 10], [0, 10], [0, 3]];
    case "major7":
      return [[4, 11], [0, 11], [0, 4]];
    case "dominant9":
      return [[4, 2], [0, 2], [4, 10]];
    case "minor9":
      return [[3, 2], [0, 2], [3, 10]];
    case "dominant7Flat9":
      return [[4, 1], [0, 1], [4, 10]];
    case "minor7Flat9":
      return [[3, 1], [0, 1], [3, 10]];
    case "sus2":
      return [[0, 2], [2, 7]];
    case "sus4":
      return [[0, 5], [5, 7]];
    case "dominant9Sus2":
      return [[0, 2], [2, 7], [0, 10]];
    case "dominant9Sus4":
      return [[0, 5], [5, 7], [0, 10]];
  }
}

function preferredSlashUpperClasses(
  chord: ChordSymbol,
  bassClass: number,
): number[] {
  const rootPitchClass = normalizePitchClass(rootSemitone(chord.root));
  const availableIntervals = new Set(fullChordIntervals(chord));
  const orderedIntervals = [
    4,
    3,
    11,
    10,
    2,
    1,
    9,
    5,
    0,
    7,
  ];
  const pitchClasses = orderedIntervals
    .filter((interval) => availableIntervals.has(normalizePitchClass(interval)))
    .map((interval) => normalizePitchClass(rootPitchClass + interval))
    .filter((pitchClass, index, source) =>
      pitchClass !== bassClass && source.indexOf(pitchClass) === index,
    );

  if (pitchClasses.length > 0) return pitchClasses;

  return uniquePitchClasses(
    fullChordPitchClasses(chord).filter((pitchClass) => pitchClass !== bassClass),
  );
}

function compareDyadSearchCandidates(
  left: HarmonyDyadCandidate,
  right: HarmonyDyadCandidate,
  chord: ChordSymbol,
  range: VocalRange,
): number {
  const leftScore = scoreDyadSearchCandidate(left, null, range, chord);
  const rightScore = scoreDyadSearchCandidate(right, null, range, chord);
  if (leftScore !== rightScore) return leftScore - rightScore;
  return compareDyadCandidates(left, right);
}

function compareDyadCandidates(
  left: HarmonyDyadCandidate,
  right: HarmonyDyadCandidate,
): number {
  if (left.notes[0] !== right.notes[0]) return left.notes[0] - right.notes[0];
  return left.notes[1] - right.notes[1];
}

function addDyadCandidate(
  target: Map<string, HarmonyDyadCandidate>,
  candidate: HarmonyDyadCandidate,
) {
  const key = candidate.notes.join(",");
  if (!target.has(key)) {
    target.set(key, candidate);
  }
}

function dyadSpacingPenalty(span: number): number {
  let score = 0;

  if (span < 4) {
    score += (4 - span) * 4;
  } else if (span > 12) {
    score += (span - 12) * 1.4;
  }

  return score;
}

function lowMotionPenalty(delta: number): number {
  if (delta === 0) return -3.2;
  if (delta <= 2) return -1.9;
  if (delta <= 4) return -0.35;

  let score = (delta - 4) * 2.8;
  if (delta > 5) {
    score += (delta - 5) * 3.8;
  }
  return score;
}

function highMotionPenalty(delta: number): number {
  if (delta === 0) return -3.8;
  if (delta <= 2) return -2.3;
  if (delta <= 4) return -0.55;

  let score = (delta - 4) * 3.4;
  if (delta > 5) {
    score += (delta - 5) * 4.8;
  }
  return score;
}

function isDyadSpacingAllowed(notes: [MidiNote, MidiNote]): boolean {
  const span = notes[1] - notes[0];
  return span >= 3 && span <= DYAD_HARD_MAX_SPAN;
}

function pitchClassNotesInRange(
  pitchClass: number,
  range: VocalRange,
): MidiNote[] {
  const notes: MidiNote[] = [];
  for (let midi = range.low; midi <= range.high; midi++) {
    if (normalizePitchClass(midi) === pitchClass) {
      notes.push(midi);
    }
  }
  return notes;
}

function fullChordPitchClasses(chord: ChordSymbol): number[] {
  return uniquePitchClasses(
    fullChordSemitones(chord.root, chord.quality).map((tone) =>
      normalizePitchClass(tone),
    ),
  );
}

function fullChordIntervals(chord: ChordSymbol): number[] {
  const rootPitchClass = normalizePitchClass(rootSemitone(chord.root));
  return uniquePitchClasses(
    fullChordSemitones(chord.root, chord.quality).map((tone) =>
      normalizePitchClass(tone - rootPitchClass),
    ),
  );
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

function normalizePitchClassFromNoteName(note: ChordSymbol["root"]): number {
  return normalizePitchClass(rootSemitone(note));
}

function direction(value: number): -1 | 0 | 1 {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}
