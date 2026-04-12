import { chordSemitones, fullChordSemitones, rootSemitone } from "../parse";
import type {
  Chord,
  HarmonyChordAnnotation,
  HarmonyVoicingStrategy,
  MidiNote,
  VocalRange,
} from "../types";
import { formatChordIntervals, recipeIntervalPreferences } from "./annotation";

export type HarmonyVoicingCandidate = {
  notes: [MidiNote, MidiNote, MidiNote];
  strategy: HarmonyVoicingStrategy;
  recipePriority?: number;
};

export type HarmonyRecipe = {
  pitchClasses: [number, number, number];
  chordTones: HarmonyChordAnnotation["chordTones"];
};

type VoicedChord = {
  notes: [MidiNote, MidiNote, MidiNote];
  strategy: HarmonyChordAnnotation["strategy"];
};

const HARMONY_RECIPE_PRIORITY_PENALTY = 3;

export function generateHarmonyCandidates(
  chord: Chord,
  range: VocalRange,
): HarmonyVoicingCandidate[] {
  const candidates = new Map<string, HarmonyVoicingCandidate>();
  for (const candidate of generateRecipeBasedCandidates(chord, range)) {
    addCandidate(candidates, candidate);
  }

  const generated = [...candidates.values()];
  if (generated.length > 0) {
    return generated.sort((left, right) =>
      compareHarmonySearchCandidates(left, right, chord, range),
    );
  }

  return generated;
}

export function scoreHarmonyCandidate(
  candidate: HarmonyVoicingCandidate,
  previousCandidate: HarmonyVoicingCandidate | null,
  range: VocalRange,
  chord?: Chord,
): number {
  const notes = candidate.notes;
  const [low, middle, top] = notes;
  let score = 0;

  if (!(low < middle && middle < top)) {
    score += 10000;
  }

  if (chord?.bass != null) {
    const preferredBass = normalizePitchClassFromNoteName(chord.bass);
    const actualBass = normalizePitchClass(low);
    if (actualBass !== preferredBass) {
      score += 40;
    }
  }

  score += spacingPenalty(notes);

  if (previousCandidate == null) {
    const center = (range.low + range.high) / 2;
    const average = (low + middle + top) / 3;
    const targetTop = range.high - 2;
    if (chord != null && chord.bass == null) {
      const preferredBass = normalizePitchClassFromNoteName(chord.root);
      const actualBass = normalizePitchClass(low);
      if (actualBass !== preferredBass) {
        score += 8;
      }
    }
    score += Math.abs(average - center) * 1.5;
    score += Math.abs(top - targetTop) * 0.75;
    if (candidate.strategy === "drop2") {
      score -= 1;
    }
    if (candidate.strategy === "open") {
      score -= 0.4;
    }
    return score;
  }

  const previous = previousCandidate.notes;
  const average = (low + middle + top) / 3;
  const previousAverage = (previous[0] + previous[1] + previous[2]) / 3;
  const movements: number[] = [];
  const stationaryVoices = new Set<number>();

  for (let i = 0 as 0 | 1 | 2; i < 3; i = (i + 1) as 0 | 1 | 2) {
    const candidateNote = candidate.notes[i];
    const previousNote = previous[i];
    const delta = Math.abs(candidateNote - previousNote);
    movements.push(delta);
    score += delta;
    if (delta === 0) {
      score -= 4.5;
      stationaryVoices.add(i);
    } else if (delta <= 2) {
      score -= 2.5;
    } else if (delta <= 4) {
      score -= 0.75;
    }
    if (delta > 5) score += (delta - 5) * 7;
    if (delta > 8) score += (delta - 8) * 5;

    const candidateClass = ((candidateNote % 12) + 12) % 12;
    const previousClass = ((previousNote % 12) + 12) % 12;
    if (candidateClass === previousClass) {
      score -= 2.5;
    }
  }

  const directions = candidate.notes.map((note, index) =>
    Math.sign(note - previous[index]!),
  );
  const movingDirections = directions.filter((direction) => direction !== 0);
  const sameDirection =
    movingDirections.length > 1 &&
    movingDirections.every((direction) => direction === movingDirections[0]);
  if (sameDirection && movements.some((delta) => delta >= 3)) {
    score += 3.5;
  }
  const movementSpread = Math.max(...movements) - Math.min(...movements);
  score += movementSpread * 0.9;

  score -= stationaryVoices.size * 1.5;
  score += Math.abs(average - previousAverage) * 1.25;
  score += Math.abs(top - previous[2]) * 0.75;
  score += Math.abs(low - previous[0]) * 0.35;
  if (candidate.strategy === previousCandidate.strategy) {
    score -= 0.5;
  }
  if (candidate.strategy === "spread" && !stationaryVoices.size) {
    score += 1.5;
  }

  return score;
}

export function scoreHarmonySearchCandidate(
  candidate: HarmonyVoicingCandidate,
  previousCandidate: HarmonyVoicingCandidate | null,
  range: VocalRange,
  chord?: Chord,
): number {
  return (
    scoreHarmonyCandidate(candidate, previousCandidate, range, chord) +
    (candidate.recipePriority ?? 0) * HARMONY_RECIPE_PRIORITY_PENALTY
  );
}

export function buildFallbackCandidate(
  chord: Chord,
  range: VocalRange,
  prevSoprano: MidiNote | null,
): HarmonyVoicingCandidate {
  const voiced = voiceChord(chord, range, prevSoprano);
  return {
    notes: voiced.notes,
    strategy: voiced.strategy,
  };
}

export function generateHarmonyRecipes(chord: Chord): HarmonyRecipe[] {
  const rootPitchClass = normalizePitchClass(rootSemitone(chord.root));
  const availableIntervals = new Set(fullChordIntervals(chord));
  const seen = new Set<string>();
  const recipes: HarmonyRecipe[] = [];

  for (const intervals of recipeIntervalPreferences(chord.quality)) {
    const normalizedIntervals = intervals.map((interval) =>
      normalizePitchClass(interval),
    ) as [number, number, number];
    if (
      normalizedIntervals.some((interval) => availableIntervals.has(interval) === false)
    ) {
      continue;
    }

    const dedupedIntervals = uniquePitchClasses(normalizedIntervals);
    if (dedupedIntervals.length !== 3) continue;

    const pitchClasses = dedupedIntervals.map((interval) =>
      normalizePitchClass(rootPitchClass + interval),
    ) as [number, number, number];
    const key = pitchClasses.join(",");
    if (seen.has(key)) continue;
    seen.add(key);

    recipes.push({
      pitchClasses,
      chordTones: formatChordIntervals(chord.quality, normalizedIntervals),
    });
  }

  return recipes;
}

function chordClasses(chord: Chord): [number, number, number] {
  const [r, t, f] = chordSemitones(chord.root, chord.quality);
  return [
    normalizePitchClass(r),
    normalizePitchClass(t),
    normalizePitchClass(f),
  ];
}

function fullChordPitchClasses(chord: Chord): number[] {
  return [
    ...new Set(
      fullChordSemitones(chord.root, chord.quality).map((tone) =>
        normalizePitchClass(tone),
      ),
    ),
  ];
}

function fullChordIntervals(chord: Chord): number[] {
  const rootPitchClass = normalizePitchClass(rootSemitone(chord.root));
  return uniquePitchClasses(
    fullChordSemitones(chord.root, chord.quality).map((tone) =>
      normalizePitchClass(tone - rootPitchClass),
    ),
  );
}

function generateRecipeBasedCandidates(
  chord: Chord,
  range: VocalRange,
): HarmonyVoicingCandidate[] {
  if (chord.bass != null) {
    const slashCandidates = generateRecipeBasedSlashCandidates(chord, range);
    if (slashCandidates.length > 0) {
      return slashCandidates;
    }
  }

  return generateRecipeBasedNonSlashCandidates(chord, range);
}

function generateRecipeBasedNonSlashCandidates(
  chord: Chord,
  range: VocalRange,
): HarmonyVoicingCandidate[] {
  const candidates = new Map<string, HarmonyVoicingCandidate>();

  for (const [recipePriority, recipe] of generateHarmonyRecipes(chord).entries()) {
    for (const permutation of permuteChordClasses(recipe.pitchClasses)) {
      const [lowClass, midClass, topClass] = permutation;
      const lowNotes = pitchClassNotesInRange(lowClass, range);
      const midNotes = pitchClassNotesInRange(midClass, range);
      const topNotes = pitchClassNotesInRange(topClass, range);

      for (const low of lowNotes) {
        for (const middle of midNotes) {
          if (middle <= low) continue;
          for (const top of topNotes) {
            if (top <= middle) continue;
            const notes = [low, middle, top] as [MidiNote, MidiNote, MidiNote];
            if (!isCandidateSpacingAllowed(notes)) continue;
            addCandidate(candidates, {
              notes,
              strategy: classifyCandidateStrategy(notes),
              recipePriority,
            });
          }
        }
      }
    }
  }

  return [...candidates.values()];
}

function generateRecipeBasedSlashCandidates(
  chord: Chord,
  range: VocalRange,
): HarmonyVoicingCandidate[] {
  if (chord.bass == null) return [];

  const bassClass = normalizePitchClassFromNoteName(chord.bass);
  const lowNotes = pitchClassNotesInRange(bassClass, range);
  const upperPairs = preferredSlashUpperPairs(chord, bassClass);
  const candidates = new Map<string, HarmonyVoicingCandidate>();

  for (const low of lowNotes) {
    for (const [recipePriority, [firstUpper, secondUpper]] of upperPairs.entries()) {
      const upperPermutations: Array<[number, number]> = [
        [firstUpper, secondUpper],
        [secondUpper, firstUpper],
      ];

      for (const [midClass, topClass] of upperPermutations) {
        const middleNotes = pitchClassNotesInRange(midClass, range);
        const topNotes = pitchClassNotesInRange(topClass, range);

        for (const middle of middleNotes) {
          if (middle <= low) continue;
          for (const top of topNotes) {
            if (top <= middle) continue;
            const notes = [low, middle, top] as [MidiNote, MidiNote, MidiNote];
            if (!isBassAnchoredCandidateSpacingAllowed(notes)) continue;
            addCandidate(candidates, {
              notes,
              strategy: classifyCandidateStrategy(notes),
              recipePriority,
            });
          }
        }
      }
    }
  }

  return [...candidates.values()];
}

function voiceChord(
  chord: Chord,
  range: VocalRange,
  prevSoprano: MidiNote | null,
): VoicedChord {
  if (chord.bass != null) {
    const bassAnchored = chooseBassAnchoredCandidate(
      chord,
      range,
      prevSoprano ?? range.high,
    );
    if (bassAnchored != null) {
      return bassAnchored;
    }
  }

  const classes = new Set(chordClasses(chord));
  const sopranoTarget = prevSoprano ?? range.high;
  const soprano = nearestChordTone(
    classes,
    sopranoTarget,
    range.low,
    range.high,
  );

  const closed = buildClosedVoicing(soprano, classes);
  const dropped = applyDrop2(closed);

  if (dropped[0] >= range.low) {
    return { notes: dropped, strategy: "drop2" };
  }

  const sopranoUp = soprano + 12;
  if (sopranoUp <= range.high) {
    const closedUp = buildClosedVoicing(sopranoUp, classes);
    const droppedUp = applyDrop2(closedUp);
    if (droppedUp[0] >= range.low) {
      return { notes: droppedUp, strategy: "drop2" };
    }
  }

  return { notes: closed, strategy: "closed" };
}

function chooseBassAnchoredCandidate(
  chord: Chord,
  range: VocalRange,
  sopranoTarget: MidiNote,
): VoicedChord | null {
  const candidates = generateBassAnchoredCandidates(chord, range);
  if (candidates.length === 0) return null;

  let best: HarmonyVoicingCandidate | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const [low, middle, top] = candidate.notes;
    const average = (low + middle + top) / 3;
    const score =
      Math.abs(top - sopranoTarget) +
      Math.abs(average - (range.low + range.high) / 2) * 0.35 +
      spacingPenalty(candidate.notes);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best == null ? null : { notes: best.notes, strategy: best.strategy };
}

function addCandidate(
  target: Map<string, HarmonyVoicingCandidate>,
  candidate: HarmonyVoicingCandidate,
) {
  const key = candidate.notes.join(",");
  if (!target.has(key)) {
    target.set(key, candidate);
  }
}

function compareCandidates(
  left: HarmonyVoicingCandidate,
  right: HarmonyVoicingCandidate,
): number {
  if (left.notes[0] !== right.notes[0]) return left.notes[0] - right.notes[0];
  if (left.notes[1] !== right.notes[1]) return left.notes[1] - right.notes[1];
  if (left.notes[2] !== right.notes[2]) return left.notes[2] - right.notes[2];
  return left.strategy.localeCompare(right.strategy);
}

function nearestChordTone(
  classes: Set<number>,
  target: MidiNote,
  low: MidiNote,
  high: MidiNote,
): MidiNote {
  for (let delta = 0; delta <= high - low; delta++) {
    if (target + delta <= high) {
      if (classes.has((((target + delta) % 12) + 12) % 12)) {
        return target + delta;
      }
    }
    if (delta > 0 && target - delta >= low) {
      if (classes.has((((target - delta) % 12) + 12) % 12)) {
        return target - delta;
      }
    }
  }
  return Math.max(low, Math.min(high, target));
}

function buildClosedVoicing(
  soprano: MidiNote,
  classes: Set<number>,
): [MidiNote, MidiNote, MidiNote] {
  const usedClasses = new Set([((soprano % 12) + 12) % 12]);
  const voices: MidiNote[] = [soprano];
  let below = soprano;

  for (let slot = 0; slot < 2; slot++) {
    let added = false;
    for (let delta = 1; delta <= 12; delta++) {
      const candidate = below - delta;
      const cls = ((candidate % 12) + 12) % 12;
      if (classes.has(cls) && !usedClasses.has(cls)) {
        voices.push(candidate);
        usedClasses.add(cls);
        below = candidate;
        added = true;
        break;
      }
    }
    if (added) continue;

    for (let delta = 1; delta <= 12; delta++) {
      const candidate = below - delta;
      const cls = ((candidate % 12) + 12) % 12;
      if (classes.has(cls)) {
        voices.push(candidate);
        below = candidate;
        break;
      }
    }
  }

  voices.sort((a, b) => a - b);
  return [voices[0]!, voices[1]!, voices[2]!];
}

function applyDrop2(
  voices: [MidiNote, MidiNote, MidiNote],
): [MidiNote, MidiNote, MidiNote] {
  const result = [voices[0], voices[1] - 12, voices[2]];
  result.sort((a, b) => a - b);
  return [result[0]!, result[1]!, result[2]!];
}

function permuteChordClasses(
  classes: [number, number, number],
): Array<[number, number, number]> {
  const permutations: Array<[number, number, number]> = [];
  const source = [...classes];

  const visit = (current: number[], remaining: number[]) => {
    if (remaining.length === 0) {
      permutations.push([current[0]!, current[1]!, current[2]!]);
      return;
    }
    for (let i = 0; i < remaining.length; i++) {
      const next = remaining[i]!;
      visit(
        [...current, next],
        [...remaining.slice(0, i), ...remaining.slice(i + 1)],
      );
    }
  };

  visit([], source);
  return permutations;
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

function preferredSlashUpperPairs(
  chord: Chord,
  bassClass: number,
): Array<[number, number]> {
  const priorityClasses = preferredPitchClasses(chord).filter(
    (pitchClass) => pitchClass !== bassClass,
  );
  const prioritizedSource =
    priorityClasses.length >= 2
      ? priorityClasses
      : fullChordPitchClasses(chord).filter((pitchClass) => pitchClass !== bassClass);
  const source =
    prioritizedSource.length >= 2
      ? uniquePitchClasses(prioritizedSource)
      : uniquePitchClasses(fullChordPitchClasses(chord));
  const pairs: Array<[number, number]> = [];

  for (let i = 0; i < source.length; i++) {
    for (let j = i + 1; j < source.length; j++) {
      pairs.push([source[i]!, source[j]!]);
    }
  }

  return pairs;
}

function preferredPitchClasses(chord: Chord): number[] {
  const rootPitchClass = normalizePitchClass(rootSemitone(chord.root));
  return uniquePitchClasses(
    preferredIntervals(chord).map((interval) =>
      normalizePitchClass(rootPitchClass + interval),
    ),
  );
}

function preferredIntervals(chord: Chord): number[] {
  const availableIntervals = new Set(fullChordIntervals(chord));
  return preferredIntervalPreferences(chord.quality).filter((interval) =>
    availableIntervals.has(normalizePitchClass(interval)),
  );
}

function preferredIntervalPreferences(quality: Chord["quality"]): number[] {
  switch (quality) {
    case "major":
      return [0, 4, 7];
    case "minor":
      return [0, 3, 7];
    case "add9":
      return [0, 4, 2, 7];
    case "diminished":
      return [0, 3, 6];
    case "major6":
      return [0, 4, 9, 7];
    case "minor6":
      return [0, 3, 9, 7];
    case "dominant7":
      return [4, 10, 0, 7];
    case "minor7":
      return [3, 10, 0, 7];
    case "major7":
      return [4, 11, 0, 7];
    case "dominant9":
      return [4, 10, 2, 0, 7];
    case "minor9":
      return [3, 10, 2, 0, 7];
    case "dominant7Flat9":
      return [4, 10, 1, 0, 7];
    case "minor7Flat9":
      return [3, 10, 1, 0, 7];
    case "sus2":
      return [0, 2, 7];
    case "sus4":
      return [0, 5, 7];
    case "dominant9Sus2":
      return [2, 10, 0, 7];
    case "dominant9Sus4":
      return [5, 10, 2, 0, 7];
  }
}

function compareHarmonySearchCandidates(
  left: HarmonyVoicingCandidate,
  right: HarmonyVoicingCandidate,
  chord: Chord,
  range: VocalRange,
): number {
  const leftScore = scoreHarmonySearchCandidate(left, null, range, chord);
  const rightScore = scoreHarmonySearchCandidate(right, null, range, chord);
  if (leftScore !== rightScore) return leftScore - rightScore;
  return compareCandidates(left, right);
}

function generateBassAnchoredCandidates(
  chord: Chord,
  range: VocalRange,
): HarmonyVoicingCandidate[] {
  if (chord.bass == null) return [];

  const bassClass = normalizePitchClassFromNoteName(chord.bass);
  const lowNotes = pitchClassNotesInRange(bassClass, range);
  const candidates = new Map<string, HarmonyVoicingCandidate>();
  const upperClassPairs = selectSlashUpperClassPairs(
    fullChordPitchClasses(chord),
    bassClass,
  );

  for (const low of lowNotes) {
    for (const [firstUpper, secondUpper] of upperClassPairs) {
      const upperPermutations: Array<[number, number]> = [
        [firstUpper, secondUpper],
        [secondUpper, firstUpper],
      ];
      for (const [midClass, topClass] of upperPermutations) {
        const middleNotes = pitchClassNotesInRange(midClass, range);
        const topNotes = pitchClassNotesInRange(topClass, range);

        for (const middle of middleNotes) {
          if (middle <= low) continue;
          for (const top of topNotes) {
            if (top <= middle) continue;
            const notes = [low, middle, top] as [MidiNote, MidiNote, MidiNote];
            if (!isBassAnchoredCandidateSpacingAllowed(notes)) continue;
            addCandidate(candidates, {
              notes,
              strategy: classifyCandidateStrategy(notes),
            });
          }
        }
      }
    }
  }

  return [...candidates.values()].sort(compareCandidates);
}

function selectSlashUpperClassPairs(
  classes: number[],
  bassClass: number,
): Array<[number, number]> {
  const uniqueClasses = [...new Set(classes)];
  const eligibleClasses = uniqueClasses.filter(
    (pitchClass) => pitchClass !== bassClass,
  );
  const source = eligibleClasses.length >= 2 ? eligibleClasses : uniqueClasses;
  const pairs: Array<[number, number]> = [];

  for (let i = 0; i < source.length; i++) {
    for (let j = i + 1; j < source.length; j++) {
      pairs.push([source[i]!, source[j]!]);
    }
  }

  return pairs;
}

function isCandidateSpacingAllowed(
  notes: [MidiNote, MidiNote, MidiNote],
): boolean {
  const [low, middle, top] = notes;
  const lowerGap = middle - low;
  const upperGap = top - middle;
  const totalSpan = top - low;

  return (
    lowerGap >= 2 &&
    upperGap >= 2 &&
    lowerGap <= 14 &&
    upperGap <= 12 &&
    totalSpan >= 6 &&
    totalSpan <= 21
  );
}

function isBassAnchoredCandidateSpacingAllowed(
  notes: [MidiNote, MidiNote, MidiNote],
): boolean {
  const [low, middle, top] = notes;
  const lowerGap = middle - low;
  const upperGap = top - middle;
  const totalSpan = top - low;

  return (
    lowerGap >= 2 &&
    upperGap >= 2 &&
    lowerGap <= 14 &&
    upperGap <= 12 &&
    totalSpan >= 5 &&
    totalSpan <= 21
  );
}

function classifyCandidateStrategy(
  notes: [MidiNote, MidiNote, MidiNote],
): HarmonyVoicingStrategy {
  const [low, middle, top] = notes;
  const lowerGap = middle - low;
  const upperGap = top - middle;
  const totalSpan = top - low;

  if (totalSpan <= 12) return "closed";
  if (lowerGap >= upperGap + 4) return "drop2";
  if (lowerGap >= 9 || upperGap >= 8 || totalSpan >= 17) return "spread";
  return "open";
}

function spacingPenalty(notes: [MidiNote, MidiNote, MidiNote]): number {
  const [low, middle, top] = notes;
  const lowerGap = middle - low;
  const upperGap = top - middle;
  let score = 0;

  if (lowerGap < 3) score += (3 - lowerGap) * 4;
  else if (lowerGap > 9) score += (lowerGap - 9) * 1.5;

  if (upperGap < 3) score += (3 - upperGap) * 3;
  else if (upperGap > 8) score += (upperGap - 8) * 1.25;

  return score;
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

function normalizePitchClassFromNoteName(note: Chord["root"]): number {
  return normalizePitchClass(chordSemitones(note, "major")[0]);
}
