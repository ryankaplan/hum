import { chordSemitones } from "./parse";
import type {
  Chord,
  HarmonyChordAnnotation,
  HarmonyLine,
  HarmonyVoicing,
  HarmonyVoicingStrategy,
  MidiNote,
  VocalRange,
} from "./types";

// Generates harmony voice lines from a chord progression and vocal range.
// The bottom 2/3 of the range is used for harmony; melody lives in the top 1/3.
//
// Strategy: soprano-led drop-2 voicings.
//   1. The top harmony voice (soprano) is placed near the top of the harmony
//      range and moves to the nearest chord tone on each chord change.
//   2. A closed-position voicing is built downward from the soprano (two more
//      chord tones within one octave below, stacked in thirds).
//   3. Drop-2 is applied: the second-highest voice drops an octave, opening
//      the voicing into the characteristic spread sound used in jazz/choral
//      a cappella arrangements.
export function generateHarmony(
  chords: Chord[],
  range: VocalRange,
  harmonyPartCount: number,
): HarmonyVoicing {
  const resolvedHarmonyPartCount = harmonyPartCount === 1 ? 1 : 3;

  if (chords.length === 0) {
    return {
      lines: Array.from({ length: resolvedHarmonyPartCount }, () => []),
      harmonyPartCount: resolvedHarmonyPartCount,
      annotations: [],
      harmonyTop: range.low,
    };
  }

  const rangeSpan = range.high - range.low;
  const harmonyTop = range.low + Math.round((rangeSpan * 2) / 3);
  const harmonyRange: VocalRange = { low: range.low, high: harmonyTop };

  const lines: HarmonyLine[] = Array.from(
    { length: resolvedHarmonyPartCount },
    () => [],
  );
  const annotations: HarmonyChordAnnotation[] = [];
  let prevSoprano: MidiNote | null = null;

  for (const chord of chords) {
    const voiced = voiceChord(chord, harmonyRange, prevSoprano);
    const voices = voiced.notes;
    annotations.push({
      generator: "legacy",
      strategy: voiced.strategy,
      chordTones: chordToneFormula(chord),
    });
    if (resolvedHarmonyPartCount === 1) {
      // For duet mode, use the middle voice to keep enough vertical space
      // below melody while still sounding harmonically grounded.
      lines[0]?.push(voices[1]);
    } else {
      lines[0]?.push(voices[0]);
      lines[1]?.push(voices[1]);
      lines[2]?.push(voices[2]);
    }
    prevSoprano = voices[2];
  }

  return {
    lines,
    harmonyPartCount: resolvedHarmonyPartCount,
    annotations,
    harmonyTop,
  };
}

export type HarmonyVoicingCandidate = {
  notes: [MidiNote, MidiNote, MidiNote];
  strategy: HarmonyVoicingStrategy;
};

export function generateHarmonyGreedy(
  chords: Chord[],
  range: VocalRange,
  harmonyPartCount: number,
): HarmonyVoicing {
  const resolvedHarmonyPartCount = harmonyPartCount === 1 ? 1 : 3;

  if (chords.length === 0) {
    return {
      lines: Array.from({ length: resolvedHarmonyPartCount }, () => []),
      harmonyPartCount: resolvedHarmonyPartCount,
      annotations: [],
      harmonyTop: range.low,
    };
  }

  const rangeSpan = range.high - range.low;
  const harmonyTop = range.low + Math.round((rangeSpan * 2) / 3);
  const harmonyRange: VocalRange = { low: range.low, high: harmonyTop };

  const lines: HarmonyLine[] = Array.from(
    { length: resolvedHarmonyPartCount },
    () => [],
  );
  const annotations: HarmonyChordAnnotation[] = [];
  let previousCandidate: HarmonyVoicingCandidate | null = null;

  for (const chord of chords) {
    const candidate = chooseBestGreedyCandidate(
      generateHarmonyCandidates(chord, harmonyRange),
      previousCandidate,
      harmonyRange,
    );
    const resolvedCandidate: HarmonyVoicingCandidate =
      candidate ??
      buildFallbackCandidate(
        chord,
        harmonyRange,
        previousCandidate?.notes[2] ?? null,
      );
    const voices = resolvedCandidate.notes;

    annotations.push({
      generator: "greedy",
      strategy: resolvedCandidate.strategy,
      chordTones: chordToneFormula(chord),
    });
    if (resolvedHarmonyPartCount === 1) {
      lines[0]?.push(voices[1]);
    } else {
      lines[0]?.push(voices[0]);
      lines[1]?.push(voices[1]);
      lines[2]?.push(voices[2]);
    }
    previousCandidate = resolvedCandidate;
  }

  return {
    lines,
    harmonyPartCount: resolvedHarmonyPartCount,
    annotations,
    harmonyTop,
  };
}

export function generateHarmonyDynamic(
  chords: Chord[],
  range: VocalRange,
  harmonyPartCount: number,
): HarmonyVoicing {
  const resolvedHarmonyPartCount = harmonyPartCount === 1 ? 1 : 3;

  if (chords.length === 0) {
    return {
      lines: Array.from({ length: resolvedHarmonyPartCount }, () => []),
      harmonyPartCount: resolvedHarmonyPartCount,
      annotations: [],
      harmonyTop: range.low,
    };
  }

  const rangeSpan = range.high - range.low;
  const harmonyTop = range.low + Math.round((rangeSpan * 2) / 3);
  const harmonyRange: VocalRange = { low: range.low, high: harmonyTop };
  const candidateSets = chords.map((chord) => {
    const candidates = generateHarmonyCandidates(chord, harmonyRange);
    if (candidates.length > 0) return candidates;
    return [
      buildFallbackCandidate(chord, harmonyRange, null),
    ] satisfies HarmonyVoicingCandidate[];
  });

  const bestPath = chooseBestDynamicPath(candidateSets, harmonyRange);
  const lines: HarmonyLine[] = Array.from(
    { length: resolvedHarmonyPartCount },
    () => [],
  );
  const annotations: HarmonyChordAnnotation[] = [];

  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i]!;
    const candidate = bestPath[i]!;
    const voices = candidate.notes;
    annotations.push({
      generator: "dynamic",
      strategy: candidate.strategy,
      chordTones: chordToneFormula(chord),
    });
    if (resolvedHarmonyPartCount === 1) {
      lines[0]?.push(voices[1]);
    } else {
      lines[0]?.push(voices[0]);
      lines[1]?.push(voices[1]);
      lines[2]?.push(voices[2]);
    }
  }

  return {
    lines,
    harmonyPartCount: resolvedHarmonyPartCount,
    annotations,
    harmonyTop,
  };
}

type VoicedChord = {
  notes: [MidiNote, MidiNote, MidiNote];
  strategy: HarmonyChordAnnotation["strategy"];
};

function voiceChord(
  chord: Chord,
  range: VocalRange,
  prevSoprano: MidiNote | null,
): VoicedChord {
  const classes = new Set(chordClasses(chord));

  // Soprano targets the previous soprano for smooth voice leading, or the top
  // of the harmony range on the first chord.
  const sopranoTarget = prevSoprano ?? range.high;
  const soprano = nearestChordTone(classes, sopranoTarget, range.low, range.high);

  // Build closed voicing from soprano downward, then apply drop-2.
  const closed = buildClosedVoicing(soprano, classes);
  const dropped = applyDrop2(closed);

  if (dropped[0] >= range.low) {
    return { notes: dropped, strategy: "drop2" };
  }

  // Drop-2 pushed the lowest voice below the range. Try the soprano an octave
  // higher — this raises the whole stack and may keep everything in range.
  const sopranoUp = soprano + 12;
  if (sopranoUp <= range.high) {
    const closedUp = buildClosedVoicing(sopranoUp, classes);
    const droppedUp = applyDrop2(closedUp);
    if (droppedUp[0] >= range.low) {
      return { notes: droppedUp, strategy: "drop2" };
    }
  }

  // Fallback: use the closed voicing without drop-2 (still sounds fine, just
  // tighter spacing).
  return { notes: closed, strategy: "closed" };
}

function chordToneFormula(chord: Chord): HarmonyChordAnnotation["chordTones"] {
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
  }
}

// Returns the 3 pitch classes (0–11) used to voice the chord.
function chordClasses(chord: Chord): [number, number, number] {
  const [r, t, f] = chordSemitones(chord.root, chord.quality);
  return [normalizePitchClass(r), normalizePitchClass(t), normalizePitchClass(f)];
}

export function generateHarmonyCandidates(
  chord: Chord,
  range: VocalRange,
): HarmonyVoicingCandidate[] {
  const classes = chordClasses(chord);
  const classSet = new Set(classes);
  const candidates = new Map<string, HarmonyVoicingCandidate>();

  for (let soprano = range.low; soprano <= range.high; soprano++) {
    if (!classSet.has(normalizePitchClass(soprano))) continue;

    const closed = buildClosedVoicing(soprano, classSet);
    if (isCandidateInRange(closed, range)) {
      addCandidate(candidates, {
        notes: closed,
        strategy: "closed",
      });
    }

    const dropped = applyDrop2(closed);
    if (isCandidateInRange(dropped, range)) {
      addCandidate(candidates, {
        notes: dropped,
        strategy: "drop2",
      });
    }
  }

  for (const permutation of permuteChordClasses(classes)) {
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
          });
        }
      }
    }
  }

  return [...candidates.values()].sort(compareCandidates);
}

export function scoreHarmonyCandidate(
  candidate: HarmonyVoicingCandidate,
  previousCandidate: HarmonyVoicingCandidate | null,
  range: VocalRange,
): number {
  const notes = candidate.notes;
  const [low, middle, top] = notes;
  let score = 0;

  if (!(low < middle && middle < top)) {
    score += 10000;
  }

  score += spacingPenalty(notes);

  if (previousCandidate == null) {
    const center = (range.low + range.high) / 2;
    const average =
      (low + middle + top) / 3;
    const targetTop = range.high - 2;
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
  const average =
    (low + middle + top) / 3;
  const previousAverage =
    (previous[0] + previous[1] + previous[2]) / 3;
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

function chooseBestGreedyCandidate(
  candidates: HarmonyVoicingCandidate[],
  previousCandidate: HarmonyVoicingCandidate | null,
  range: VocalRange,
): HarmonyVoicingCandidate | null {
  let best: HarmonyVoicingCandidate | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const score = scoreHarmonyCandidate(candidate, previousCandidate, range);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function chooseBestDynamicPath(
  candidateSets: HarmonyVoicingCandidate[][],
  range: VocalRange,
): HarmonyVoicingCandidate[] {
  const scores: number[][] = candidateSets.map((set) =>
    set.map(() => Number.POSITIVE_INFINITY),
  );
  const previousIndexes: number[][] = candidateSets.map((set) =>
    set.map(() => -1),
  );

  for (let candidateIndex = 0; candidateIndex < candidateSets[0]!.length; candidateIndex++) {
    const candidate = candidateSets[0]![candidateIndex]!;
    scores[0]![candidateIndex] = scoreHarmonyCandidate(candidate, null, range);
  }

  for (let chordIndex = 1; chordIndex < candidateSets.length; chordIndex++) {
    const currentSet = candidateSets[chordIndex]!;
    const previousSet = candidateSets[chordIndex - 1]!;

    for (let candidateIndex = 0; candidateIndex < currentSet.length; candidateIndex++) {
      const candidate = currentSet[candidateIndex]!;
      let bestScore = Number.POSITIVE_INFINITY;
      let bestPreviousIndex = -1;

      for (
        let previousIndex = 0;
        previousIndex < previousSet.length;
        previousIndex++
      ) {
        const previousCandidate = previousSet[previousIndex]!;
        const priorScore = scores[chordIndex - 1]![previousIndex]!;
        const nextScore =
          priorScore +
          scoreHarmonyCandidate(candidate, previousCandidate, range);

        if (nextScore < bestScore) {
          bestScore = nextScore;
          bestPreviousIndex = previousIndex;
        }
      }

      scores[chordIndex]![candidateIndex] = bestScore;
      previousIndexes[chordIndex]![candidateIndex] = bestPreviousIndex;
    }
  }

  const lastScores = scores[scores.length - 1]!;
  let bestFinalIndex = 0;
  for (let i = 1; i < lastScores.length; i++) {
    if (lastScores[i]! < lastScores[bestFinalIndex]!) {
      bestFinalIndex = i;
    }
  }

  const result = Array.from({ length: candidateSets.length }, () => null) as Array<
    HarmonyVoicingCandidate | null
  >;
  let cursor = bestFinalIndex;
  for (let chordIndex = candidateSets.length - 1; chordIndex >= 0; chordIndex--) {
    result[chordIndex] = candidateSets[chordIndex]![cursor]!;
    cursor = chordIndex > 0 ? previousIndexes[chordIndex]![cursor]! : -1;
  }

  return result.filter(
    (candidate): candidate is HarmonyVoicingCandidate => candidate != null,
  );
}

function buildFallbackCandidate(
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

// Finds the chord tone nearest to `target` within [low, high], searching
// outward from target so that ties prefer the upward direction (keeps the
// soprano from drifting low).
function nearestChordTone(
  classes: Set<number>,
  target: MidiNote,
  low: MidiNote,
  high: MidiNote,
): MidiNote {
  for (let delta = 0; delta <= high - low; delta++) {
    if (target + delta <= high) {
      if (classes.has(((target + delta) % 12 + 12) % 12)) {
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

// Builds a closed-position voicing [low, mid, high] starting from soprano
// and filling in the two nearest chord tones below it (each a distinct pitch
// class), within a maximum of 12 semitones below the previous voice.
function buildClosedVoicing(
  soprano: MidiNote,
  classes: Set<number>,
): [MidiNote, MidiNote, MidiNote] {
  const usedClasses = new Set([((soprano % 12) + 12) % 12]);
  const voices: MidiNote[] = [soprano];
  let below = soprano;

  for (let slot = 0; slot < 2; slot++) {
    for (let delta = 1; delta <= 12; delta++) {
      const candidate = below - delta;
      const cls = ((candidate % 12) + 12) % 12;
      if (classes.has(cls) && !usedClasses.has(cls)) {
        voices.push(candidate);
        usedClasses.add(cls);
        below = candidate;
        break;
      }
    }
  }

  voices.sort((a, b) => a - b);
  return [voices[0]!, voices[1]!, voices[2]!];
}

// Drop-2: drops the second-highest voice (index 1 in the sorted triple) down
// an octave, opening up the closed voicing.
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
