/*
 * Shared harmony engine utilities.
 *
 * This module holds the common musical building blocks used by every harmony
 * generator in this folder: chord-tone reduction, candidate enumeration,
 * voice-leading scoring, slash-bass handling, and small helpers for turning
 * chosen note triples into the app's HarmonyVoicing shape.
 *
 * The goal is to keep the distinct generation strategies focused on their
 * search approach while centralizing the low-level voicing rules in one place.
 */

import { chordSemitones, fullChordSemitones, rootSemitone } from "./parse";
import type {
  Chord,
  HarmonyRangeCoverage,
  HarmonyChordAnnotation,
  HarmonyLine,
  HarmonyVoicing,
  HarmonyVoicingGenerator,
  HarmonyVoicingStrategy,
  MidiNote,
  VocalRange,
} from "./types";

export type HarmonyVoicingCandidate = {
  notes: [MidiNote, MidiNote, MidiNote];
  strategy: HarmonyVoicingStrategy;
  recipePriority?: number;
};

export type DynamicHarmonyRecipe = {
  pitchClasses: [number, number, number];
  chordTones: HarmonyChordAnnotation["chordTones"];
};

type VoicedChord = {
  notes: [MidiNote, MidiNote, MidiNote];
  strategy: HarmonyChordAnnotation["strategy"];
};

type TopDirection = -1 | 0 | 1;

type BeamState = {
  path: HarmonyVoicingCandidate[];
  totalScore: number;
  previousCandidate: HarmonyVoicingCandidate;
  previousTopInterval: number | null;
  previousTopDirection: TopDirection;
  topMin: MidiNote;
  topMax: MidiNote;
  reversalStreak: number;
  unresolvedLeapDirection: Exclude<TopDirection, 0> | null;
  orderKey: number;
};

const DYNAMIC_BEAM_WIDTH = 24;
const TOP_LINE_SPAN_SOFT_LIMIT = 9;
const REVERSAL_AFTER_NONSTEP_PENALTY = 2.2;
const REPEATED_REVERSAL_PENALTY = 1.4;
const UNRECOVERED_LEAP_PENALTY = 3.4;
const TOP_LINE_SPAN_EXCESS_PENALTY = 0.8;
const TOP_LINE_COMMON_TONE_REWARD = 0.45;
const DYNAMIC_RECIPE_PRIORITY_PENALTY = 3;

export function resolveHarmonyPartCount(harmonyPartCount: number): number {
  return harmonyPartCount === 1 ? 1 : 3;
}

export function resolveHarmonyRange(
  range: VocalRange,
  coverage: HarmonyRangeCoverage,
): {
  harmonyRange: VocalRange;
  harmonyTop: MidiNote;
} {
  const rangeSpan = range.high - range.low;
  const harmonyTop =
    range.low + Math.round(rangeSpan * harmonyCoverageRatio(coverage));
  return {
    harmonyRange: { low: range.low, high: harmonyTop },
    harmonyTop,
  };
}

export function createEmptyHarmonyVoicing(
  range: VocalRange,
  harmonyPartCount: number,
): HarmonyVoicing {
  const resolvedHarmonyPartCount = resolveHarmonyPartCount(harmonyPartCount);
  return {
    lines: Array.from({ length: resolvedHarmonyPartCount }, () => []),
    harmonyPartCount: resolvedHarmonyPartCount,
    annotations: [],
    harmonyTop: range.low,
  };
}

export function createHarmonyLines(harmonyPartCount: number): HarmonyLine[] {
  return Array.from(
    { length: resolveHarmonyPartCount(harmonyPartCount) },
    () => [],
  );
}

export function appendVoicesToLines(
  lines: HarmonyLine[],
  voices: [MidiNote, MidiNote, MidiNote],
  harmonyPartCount: number,
) {
  const resolvedHarmonyPartCount = resolveHarmonyPartCount(harmonyPartCount);
  if (resolvedHarmonyPartCount === 1) {
    lines[0]?.push(voices[1]);
    return;
  }
  lines[0]?.push(voices[0]);
  lines[1]?.push(voices[1]);
  lines[2]?.push(voices[2]);
}

export function buildHarmonyVoicing(
  lines: HarmonyLine[],
  annotations: HarmonyChordAnnotation[],
  harmonyTop: MidiNote,
  harmonyPartCount: number,
): HarmonyVoicing {
  return {
    lines,
    harmonyPartCount: resolveHarmonyPartCount(harmonyPartCount),
    annotations,
    harmonyTop,
  };
}

export function makeAnnotation(
  generator: HarmonyVoicingGenerator,
  strategy: HarmonyVoicingStrategy,
  chord: Chord,
  chordTones: HarmonyChordAnnotation["chordTones"] = chordToneFormula(chord),
): HarmonyChordAnnotation {
  return {
    generator,
    strategy,
    chordTones,
  };
}

export function chordToneFormula(
  chord: Chord,
): HarmonyChordAnnotation["chordTones"] {
  switch (chord.quality) {
    case "major":
      return "R 3 5";
    case "minor":
      return "R b3 5";
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
      compareDynamicSearchCandidates(left, right, chord, range),
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

export function chooseBestDynamicPath(
  chords: Chord[],
  candidateSets: HarmonyVoicingCandidate[][],
  range: VocalRange,
): HarmonyVoicingCandidate[] {
  let beam: BeamState[] = candidateSets[0]!
    .map((candidate, index) => {
      const top = candidate.notes[2];
      return {
        path: [candidate],
        totalScore: scoreDynamicSearchCandidate(
          candidate,
          null,
          range,
          chords[0],
        ),
        previousCandidate: candidate,
        previousTopInterval: null,
        previousTopDirection: 0,
        topMin: top,
        topMax: top,
        reversalStreak: 0,
        unresolvedLeapDirection: null,
        orderKey: index,
      } satisfies BeamState;
    })
    .sort(compareBeamStates)
    .slice(0, DYNAMIC_BEAM_WIDTH);

  for (let chordIndex = 1; chordIndex < candidateSets.length; chordIndex++) {
    const nextBeam: BeamState[] = [];
    const chord = chords[chordIndex]!;
    let orderKey = 0;

    for (const state of beam) {
      for (const candidate of candidateSets[chordIndex]!) {
        const contourScore = scoreContourTransition(state, candidate);
        nextBeam.push({
          path: [...state.path, candidate],
          totalScore:
            state.totalScore +
            scoreDynamicSearchCandidate(
              candidate,
              state.previousCandidate,
              range,
              chord,
            ) +
            contourScore,
          previousCandidate: candidate,
          previousTopInterval:
            candidate.notes[2] - state.previousCandidate.notes[2],
          previousTopDirection: topDirection(
            candidate.notes[2] - state.previousCandidate.notes[2],
          ),
          topMin: Math.min(state.topMin, candidate.notes[2]),
          topMax: Math.max(state.topMax, candidate.notes[2]),
          reversalStreak: nextReversalStreak(state, candidate),
          unresolvedLeapDirection: nextUnresolvedLeapDirection(
            state,
            candidate,
          ),
          orderKey: orderKey++,
        });
      }
    }

    beam = nextBeam.sort(compareBeamStates).slice(0, DYNAMIC_BEAM_WIDTH);
  }

  return beam[0]?.path ?? [];
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

function isCandidateInRange(
  notes: [MidiNote, MidiNote, MidiNote],
  range: VocalRange,
): boolean {
  return notes[0] >= range.low && notes[2] <= range.high;
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

function normalizePitchClass(note: number): number {
  return ((note % 12) + 12) % 12;
}

function normalizePitchClassFromNoteName(note: Chord["root"]): number {
  return normalizePitchClass(chordSemitones(note, "major")[0]);
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

  for (const [recipePriority, recipe] of generateDynamicHarmonyRecipes(
    chord,
  ).entries()) {
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

export function generateDynamicHarmonyRecipes(
  chord: Chord,
): DynamicHarmonyRecipe[] {
  const rootPitchClass = normalizePitchClass(rootSemitone(chord.root));
  const availableIntervals = new Set(fullChordIntervals(chord));
  const seen = new Set<string>();
  const recipes: DynamicHarmonyRecipe[] = [];

  for (const intervals of dynamicRecipeIntervalPreferences(chord.quality)) {
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
      chordTones: formatChordIntervals(
        chord.quality,
        normalizedIntervals,
      ),
    });
  }

  return recipes;
}

export function describeHarmonyCandidateChordTones(
  chord: Chord,
  candidate: HarmonyVoicingCandidate,
): HarmonyChordAnnotation["chordTones"] {
  return describeHarmonyNotesForChord(chord, candidate.notes);
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

function dynamicRecipeIntervalPreferences(
  quality: Chord["quality"],
): Array<[number, number, number]> {
  switch (quality) {
    case "major":
      return [[0, 4, 7]];
    case "minor":
      return [[0, 3, 7]];
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

function dynamicPriorityPitchClasses(chord: Chord): number[] {
  const rootPitchClass = normalizePitchClass(rootSemitone(chord.root));
  return uniquePitchClasses(
    dynamicPriorityIntervals(chord).map((interval) =>
      normalizePitchClass(rootPitchClass + interval),
    ),
  );
}

function dynamicPriorityIntervals(chord: Chord): number[] {
  const availableIntervals = new Set(fullChordIntervals(chord));
  return dynamicPriorityIntervalPreferences(chord.quality).filter((interval) =>
    availableIntervals.has(normalizePitchClass(interval)),
  );
}

function dynamicPriorityIntervalPreferences(quality: Chord["quality"]): number[] {
  switch (quality) {
    case "major":
      return [0, 4, 7];
    case "minor":
      return [0, 3, 7];
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

function dynamicFormulaIntervals(quality: Chord["quality"]): number[] {
  switch (quality) {
    case "major":
      return [0, 4, 7];
    case "minor":
      return [0, 3, 7];
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
  const order = dynamicFormulaIntervals(quality);
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

function formatChordIntervals(
  quality: Chord["quality"],
  intervals: readonly number[],
): HarmonyChordAnnotation["chordTones"] {
  return intervals
    .map((interval) =>
      labelIntervalForQuality(quality, normalizePitchClass(interval)),
    )
    .join(" ");
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

function preferredSlashUpperPairs(
  chord: Chord,
  bassClass: number,
): Array<[number, number]> {
  const priorityClasses = dynamicPriorityPitchClasses(chord).filter(
    (pitchClass) => pitchClass !== bassClass,
  );
  const prioritizedSource =
    priorityClasses.length >= 2
      ? priorityClasses
      : fullChordPitchClasses(chord).filter((pitchClass) => pitchClass !== bassClass);
  const source = prioritizedSource.length >= 2
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

function uniquePitchClasses(values: number[]): number[] {
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

function compareDynamicSearchCandidates(
  left: HarmonyVoicingCandidate,
  right: HarmonyVoicingCandidate,
  chord: Chord,
  range: VocalRange,
): number {
  const leftScore = scoreDynamicSearchCandidate(left, null, range, chord);
  const rightScore = scoreDynamicSearchCandidate(right, null, range, chord);
  if (leftScore !== rightScore) return leftScore - rightScore;
  return compareCandidates(left, right);
}

function scoreDynamicSearchCandidate(
  candidate: HarmonyVoicingCandidate,
  previousCandidate: HarmonyVoicingCandidate | null,
  range: VocalRange,
  chord?: Chord,
): number {
  return (
    scoreHarmonyCandidate(candidate, previousCandidate, range, chord) +
    (candidate.recipePriority ?? 0) * DYNAMIC_RECIPE_PRIORITY_PENALTY
  );
}

function scoreContourTransition(
  state: BeamState,
  candidate: HarmonyVoicingCandidate,
): number {
  const previousTop = state.previousCandidate.notes[2];
  const currentTop = candidate.notes[2];
  const topInterval = currentTop - previousTop;
  const topMotion = Math.abs(topInterval);
  const currentDirection = topDirection(topInterval);
  let score = 0;

  if (state.unresolvedLeapDirection != null) {
    const recovered =
      currentDirection === -state.unresolvedLeapDirection &&
      topMotion > 0 &&
      topMotion <= 2;
    if (!recovered) {
      score += UNRECOVERED_LEAP_PENALTY;
    }
  }

  const reversesAfterNonStep =
    state.previousTopDirection !== 0 &&
    currentDirection !== 0 &&
    currentDirection !== state.previousTopDirection &&
    Math.abs(state.previousTopInterval ?? 0) > 2;
  const reversesDirection =
    state.previousTopDirection !== 0 &&
    currentDirection !== 0 &&
    currentDirection !== state.previousTopDirection;

  if (reversesAfterNonStep) {
    score += REVERSAL_AFTER_NONSTEP_PENALTY;
  }
  if (reversesDirection && state.reversalStreak > 0) {
    score += REPEATED_REVERSAL_PENALTY * state.reversalStreak;
  }

  const nextTopMin = Math.min(state.topMin, currentTop);
  const nextTopMax = Math.max(state.topMax, currentTop);
  const nextSpan = nextTopMax - nextTopMin;
  if (nextSpan > TOP_LINE_SPAN_SOFT_LIMIT) {
    score += (nextSpan - TOP_LINE_SPAN_SOFT_LIMIT) * TOP_LINE_SPAN_EXCESS_PENALTY;
  }

  if (normalizePitchClass(previousTop) === normalizePitchClass(currentTop)) {
    score -= TOP_LINE_COMMON_TONE_REWARD;
  }

  return score;
}

function nextReversalStreak(
  state: BeamState,
  candidate: HarmonyVoicingCandidate,
): number {
  const topInterval = candidate.notes[2] - state.previousCandidate.notes[2];
  const currentDirection = topDirection(topInterval);
  const reversesDirection =
    state.previousTopDirection !== 0 &&
    currentDirection !== 0 &&
    currentDirection !== state.previousTopDirection;
  return reversesDirection ? state.reversalStreak + 1 : 0;
}

function nextUnresolvedLeapDirection(
  state: BeamState,
  candidate: HarmonyVoicingCandidate,
): Exclude<TopDirection, 0> | null {
  const topInterval = candidate.notes[2] - state.previousCandidate.notes[2];
  const currentDirection = topDirection(topInterval);
  const topMotion = Math.abs(topInterval);
  if (topMotion > 5 && currentDirection !== 0) {
    return currentDirection;
  }
  return null;
}

function topDirection(value: number): TopDirection {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

function compareBeamStates(left: BeamState, right: BeamState): number {
  if (left.totalScore !== right.totalScore) {
    return left.totalScore - right.totalScore;
  }
  return left.orderKey - right.orderKey;
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

function harmonyCoverageRatio(coverage: HarmonyRangeCoverage): number {
  switch (coverage) {
    case "lower two thirds":
      return 2 / 3;
    case "whole-range":
      return 1;
  }
}
