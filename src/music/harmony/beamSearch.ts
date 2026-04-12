import type { Chord, MidiNote, VocalRange } from "../types";
import {
  scoreHarmonySearchCandidate,
  type HarmonyVoicingCandidate,
} from "./candidates";

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

const BEAM_WIDTH = 24;
const TOP_LINE_SPAN_SOFT_LIMIT = 9;
const REVERSAL_AFTER_NONSTEP_PENALTY = 2.2;
const REPEATED_REVERSAL_PENALTY = 1.4;
const UNRECOVERED_LEAP_PENALTY = 3.4;
const TOP_LINE_SPAN_EXCESS_PENALTY = 0.8;
const TOP_LINE_COMMON_TONE_REWARD = 0.45;

export function chooseBestHarmonyPath(
  chords: Chord[],
  candidateSets: HarmonyVoicingCandidate[][],
  range: VocalRange,
): HarmonyVoicingCandidate[] {
  let beam: BeamState[] = candidateSets[0]!
    .map((candidate, index) => {
      const top = candidate.notes[2];
      return {
        path: [candidate],
        totalScore: scoreHarmonySearchCandidate(candidate, null, range, chords[0]),
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
    .slice(0, BEAM_WIDTH);

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
            scoreHarmonySearchCandidate(
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

    beam = nextBeam.sort(compareBeamStates).slice(0, BEAM_WIDTH);
  }

  return beam[0]?.path ?? [];
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

function normalizePitchClass(note: number): number {
  return ((note % 12) + 12) % 12;
}
