/*
 * Dynamic-programming harmony generation.
 *
 * This approach builds the same candidate set as the greedy generator, but
 * instead of committing immediately at each chord, it scores whole paths across
 * the progression. A dynamic-programming pass finds the lowest-cost route from
 * start to finish, which lets it trade off a slightly worse local move for a
 * better long-range result.
 *
 * It is the most globally optimized method in this folder and serves as the
 * "best path" search over the shared voicing candidate space.
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
  chooseBestDynamicPath,
  createEmptyHarmonyVoicing,
  createHarmonyLines,
  generateHarmonyCandidates,
  HarmonyVoicingCandidate,
  makeAnnotation,
  resolveHarmonyPartCount,
  resolveHarmonyRange,
} from "./harmonyShared";

export function generateHarmonyDynamic(
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
  const candidateSets = chords.map((chord) => {
    const candidates = generateHarmonyCandidates(chord, harmonyRange);
    if (candidates.length > 0) return candidates;
    return [
      buildFallbackCandidate(chord, harmonyRange, null),
    ] satisfies HarmonyVoicingCandidate[];
  });

  const bestPath = chooseBestDynamicPath(chords, candidateSets, harmonyRange);
  const lines = createHarmonyLines(resolvedHarmonyPartCount);
  const annotations: HarmonyChordAnnotation[] = [];

  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i]!;
    const candidate = bestPath[i]!;
    annotations.push(makeAnnotation("dynamic", candidate.strategy, chord));
    appendVoicesToLines(lines, candidate.notes, resolvedHarmonyPartCount);
  }

  return buildHarmonyVoicing(
    lines,
    annotations,
    harmonyTop,
    resolvedHarmonyPartCount,
  );
}
