/*
 * Greedy harmony generation.
 *
 * This approach enumerates many legal voicing candidates for each chord and
 * chooses the locally best next option using a voice-leading score. It tries
 * to keep motion smooth, preserve common tones, and avoid lopsided movement,
 * but it only optimizes one chord transition at a time.
 *
 * In practice, it is more flexible than the legacy generator while remaining
 * fast and straightforward to reason about.
 */

import type {
  Chord,
  HarmonyChordAnnotation,
  HarmonyRangeCoverage,
  HarmonyVoicing,
  VocalRange,
} from "./types";
import {
  appendVoicesToLines,
  buildFallbackCandidate,
  buildHarmonyVoicing,
  chooseBestGreedyCandidate,
  createEmptyHarmonyVoicing,
  createHarmonyLines,
  generateHarmonyCandidates,
  HarmonyVoicingCandidate,
  makeAnnotation,
  resolveHarmonyPartCount,
  resolveHarmonyRange,
} from "./harmonyShared";

export function generateHarmonyGreedy(
  chords: Chord[],
  range: VocalRange,
  harmonyPartCount: number,
  harmonyRangeCoverage: HarmonyRangeCoverage = "lower-two-thirds",
): HarmonyVoicing {
  const resolvedHarmonyPartCount = resolveHarmonyPartCount(harmonyPartCount);

  if (chords.length === 0) {
    return createEmptyHarmonyVoicing(range, resolvedHarmonyPartCount);
  }

  const { harmonyRange, harmonyTop } = resolveHarmonyRange(
    range,
    harmonyRangeCoverage,
  );
  const lines = createHarmonyLines(resolvedHarmonyPartCount);
  const annotations: HarmonyChordAnnotation[] = [];
  let previousCandidate: HarmonyVoicingCandidate | null = null;

  for (const chord of chords) {
    const candidate = chooseBestGreedyCandidate(
      chord,
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

    annotations.push(
      makeAnnotation("greedy", resolvedCandidate.strategy, chord),
    );
    appendVoicesToLines(lines, resolvedCandidate.notes, resolvedHarmonyPartCount);
    previousCandidate = resolvedCandidate;
  }

  return buildHarmonyVoicing(
    lines,
    annotations,
    harmonyTop,
    resolvedHarmonyPartCount,
  );
}
