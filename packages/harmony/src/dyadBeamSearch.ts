import {
  scoreDyadSearchCandidate,
  type HarmonyDyadCandidate,
} from "./dyadCandidates";
import type { ChordSymbol, MidiNote, VocalRange } from "./types";

type Direction = -1 | 0 | 1;

type BeamState = {
  path: HarmonyDyadCandidate[];
  totalScore: number;
  previousCandidate: HarmonyDyadCandidate;
  previousHighInterval: number | null;
  previousHighDirection: Direction;
  highMin: MidiNote;
  highMax: MidiNote;
  highReversalStreak: number;
  unresolvedHighLeapDirection: Exclude<Direction, 0> | null;
  previousLowInterval: number | null;
  previousLowDirection: Direction;
  lowMin: MidiNote;
  lowMax: MidiNote;
  lowReversalStreak: number;
  unresolvedLowLeapDirection: Exclude<Direction, 0> | null;
  orderKey: number;
};

const BEAM_WIDTH = 24;

const HIGH_SPAN_SOFT_LIMIT = 9;
const HIGH_REVERSAL_AFTER_NONSTEP_PENALTY = 2.2;
const HIGH_REPEATED_REVERSAL_PENALTY = 1.4;
const HIGH_UNRECOVERED_LEAP_PENALTY = 3.4;
const HIGH_SPAN_EXCESS_PENALTY = 0.8;
const HIGH_COMMON_TONE_REWARD = 0.45;

const LOW_SPAN_SOFT_LIMIT = 12;
const LOW_REVERSAL_AFTER_NONSTEP_PENALTY = 0.9;
const LOW_REPEATED_REVERSAL_PENALTY = 0.55;
const LOW_UNRECOVERED_LEAP_PENALTY = 1.6;
const LOW_SPAN_EXCESS_PENALTY = 0.25;
const LOW_COMMON_TONE_REWARD = 0.2;

const SAME_DIRECTION_LARGE_MOTION_PENALTY = 1.2;
const SAME_DIRECTION_BOTH_ACTIVE_PENALTY = 0.75;

export function chooseBestDyadPath(
  chords: ChordSymbol[],
  candidateSets: HarmonyDyadCandidate[][],
  range: VocalRange,
): HarmonyDyadCandidate[] {
  let beam: BeamState[] = candidateSets[0]!
    .map((candidate, index) => {
      const [low, high] = candidate.notes;
      return {
        path: [candidate],
        totalScore: scoreDyadSearchCandidate(candidate, null, range, chords[0]),
        previousCandidate: candidate,
        previousHighInterval: null,
        previousHighDirection: 0,
        highMin: high,
        highMax: high,
        highReversalStreak: 0,
        unresolvedHighLeapDirection: null,
        previousLowInterval: null,
        previousLowDirection: 0,
        lowMin: low,
        lowMax: low,
        lowReversalStreak: 0,
        unresolvedLowLeapDirection: null,
        orderKey: index,
      } satisfies BeamState;
    })
    .sort(compareBeamStates)
    .slice(0, BEAM_WIDTH);

  for (let chordIndex = 1; chordIndex < candidateSets.length; chordIndex++) {
    const nextBeam: BeamState[] = [];
    const chord = chords[chordIndex]!;
    let orderKey = 0;

    for (const state of beam) {
      for (const candidate of candidateSets[chordIndex]!) {
        nextBeam.push({
          path: [...state.path, candidate],
          totalScore:
            state.totalScore +
            scoreDyadSearchCandidate(
              candidate,
              state.previousCandidate,
              range,
              chord,
            ) +
            scoreContourTransition(state, candidate),
          previousCandidate: candidate,
          previousHighInterval:
            candidate.notes[1] - state.previousCandidate.notes[1],
          previousHighDirection: direction(
            candidate.notes[1] - state.previousCandidate.notes[1],
          ),
          highMin: Math.min(state.highMin, candidate.notes[1]),
          highMax: Math.max(state.highMax, candidate.notes[1]),
          highReversalStreak: nextReversalStreak(
            state.highReversalStreak,
            state.previousHighDirection,
            candidate.notes[1] - state.previousCandidate.notes[1],
          ),
          unresolvedHighLeapDirection: nextUnresolvedLeapDirection(
            candidate.notes[1] - state.previousCandidate.notes[1],
          ),
          previousLowInterval:
            candidate.notes[0] - state.previousCandidate.notes[0],
          previousLowDirection: direction(
            candidate.notes[0] - state.previousCandidate.notes[0],
          ),
          lowMin: Math.min(state.lowMin, candidate.notes[0]),
          lowMax: Math.max(state.lowMax, candidate.notes[0]),
          lowReversalStreak: nextReversalStreak(
            state.lowReversalStreak,
            state.previousLowDirection,
            candidate.notes[0] - state.previousCandidate.notes[0],
          ),
          unresolvedLowLeapDirection: nextUnresolvedLeapDirection(
            candidate.notes[0] - state.previousCandidate.notes[0],
          ),
          orderKey: orderKey++,
        });
      }
    }

    beam = nextBeam.sort(compareBeamStates).slice(0, BEAM_WIDTH);
  }

  return beam[0]?.path ?? [];
}

function scoreContourTransition(
  state: BeamState,
  candidate: HarmonyDyadCandidate,
): number {
  const previousLow = state.previousCandidate.notes[0];
  const previousHigh = state.previousCandidate.notes[1];
  const currentLow = candidate.notes[0];
  const currentHigh = candidate.notes[1];
  const lowInterval = currentLow - previousLow;
  const highInterval = currentHigh - previousHigh;
  const lowMotion = Math.abs(lowInterval);
  const highMotion = Math.abs(highInterval);
  const lowDirection = direction(lowInterval);
  const highDirection = direction(highInterval);

  let score = 0;
  score += scoreVoiceContourTransition({
    previousInterval: state.previousHighInterval,
    previousDirection: state.previousHighDirection,
    currentInterval: highInterval,
    currentDirection: highDirection,
    unresolvedLeapDirection: state.unresolvedHighLeapDirection,
    spanMin: state.highMin,
    spanMax: state.highMax,
    currentNote: currentHigh,
    previousNote: previousHigh,
    reversalStreak: state.highReversalStreak,
    spanSoftLimit: HIGH_SPAN_SOFT_LIMIT,
    reversalAfterNonStepPenalty: HIGH_REVERSAL_AFTER_NONSTEP_PENALTY,
    repeatedReversalPenalty: HIGH_REPEATED_REVERSAL_PENALTY,
    unrecoveredLeapPenalty: HIGH_UNRECOVERED_LEAP_PENALTY,
    spanExcessPenalty: HIGH_SPAN_EXCESS_PENALTY,
    commonToneReward: HIGH_COMMON_TONE_REWARD,
  });
  score += scoreVoiceContourTransition({
    previousInterval: state.previousLowInterval,
    previousDirection: state.previousLowDirection,
    currentInterval: lowInterval,
    currentDirection: lowDirection,
    unresolvedLeapDirection: state.unresolvedLowLeapDirection,
    spanMin: state.lowMin,
    spanMax: state.lowMax,
    currentNote: currentLow,
    previousNote: previousLow,
    reversalStreak: state.lowReversalStreak,
    spanSoftLimit: LOW_SPAN_SOFT_LIMIT,
    reversalAfterNonStepPenalty: LOW_REVERSAL_AFTER_NONSTEP_PENALTY,
    repeatedReversalPenalty: LOW_REPEATED_REVERSAL_PENALTY,
    unrecoveredLeapPenalty: LOW_UNRECOVERED_LEAP_PENALTY,
    spanExcessPenalty: LOW_SPAN_EXCESS_PENALTY,
    commonToneReward: LOW_COMMON_TONE_REWARD,
  });

  if (lowDirection !== 0 && highDirection !== 0 && lowDirection === highDirection) {
    if (Math.max(lowMotion, highMotion) >= 3) {
      score += SAME_DIRECTION_LARGE_MOTION_PENALTY;
    }
    if (lowMotion > 0 && highMotion > 0) {
      score += SAME_DIRECTION_BOTH_ACTIVE_PENALTY;
    }
  }

  return score;
}

function scoreVoiceContourTransition(input: {
  previousInterval: number | null;
  previousDirection: Direction;
  currentInterval: number;
  currentDirection: Direction;
  unresolvedLeapDirection: Exclude<Direction, 0> | null;
  spanMin: MidiNote;
  spanMax: MidiNote;
  currentNote: MidiNote;
  previousNote: MidiNote;
  reversalStreak: number;
  spanSoftLimit: number;
  reversalAfterNonStepPenalty: number;
  repeatedReversalPenalty: number;
  unrecoveredLeapPenalty: number;
  spanExcessPenalty: number;
  commonToneReward: number;
}): number {
  const topMotion = Math.abs(input.currentInterval);
  let score = 0;

  if (input.unresolvedLeapDirection != null) {
    const recovered =
      input.currentDirection === -input.unresolvedLeapDirection &&
      topMotion > 0 &&
      topMotion <= 2;
    if (!recovered) {
      score += input.unrecoveredLeapPenalty;
    }
  }

  const reversesAfterNonStep =
    input.previousDirection !== 0 &&
    input.currentDirection !== 0 &&
    input.currentDirection !== input.previousDirection &&
    Math.abs(input.previousInterval ?? 0) > 2;
  const reversesDirection =
    input.previousDirection !== 0 &&
    input.currentDirection !== 0 &&
    input.currentDirection !== input.previousDirection;

  if (reversesAfterNonStep) {
    score += input.reversalAfterNonStepPenalty;
  }
  if (reversesDirection && input.reversalStreak > 0) {
    score += input.repeatedReversalPenalty * input.reversalStreak;
  }

  const nextMin = Math.min(input.spanMin, input.currentNote);
  const nextMax = Math.max(input.spanMax, input.currentNote);
  const nextSpan = nextMax - nextMin;
  if (nextSpan > input.spanSoftLimit) {
    score += (nextSpan - input.spanSoftLimit) * input.spanExcessPenalty;
  }

  if (normalizePitchClass(input.previousNote) === normalizePitchClass(input.currentNote)) {
    score -= input.commonToneReward;
  }

  return score;
}

function nextReversalStreak(
  currentStreak: number,
  previousDirection: Direction,
  currentInterval: number,
): number {
  const currentDirection = direction(currentInterval);
  const reversesDirection =
    previousDirection !== 0 &&
    currentDirection !== 0 &&
    currentDirection !== previousDirection;
  return reversesDirection ? currentStreak + 1 : 0;
}

function nextUnresolvedLeapDirection(
  currentInterval: number,
): Exclude<Direction, 0> | null {
  const currentDirection = direction(currentInterval);
  if (Math.abs(currentInterval) > 5 && currentDirection !== 0) {
    return currentDirection;
  }
  return null;
}

function compareBeamStates(left: BeamState, right: BeamState): number {
  if (left.totalScore !== right.totalScore) {
    return left.totalScore - right.totalScore;
  }
  return left.orderKey - right.orderKey;
}

function direction(value: number): Direction {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

function normalizePitchClass(note: number): number {
  return ((note % 12) + 12) % 12;
}
