/*
 * Legacy harmony generation.
 *
 * This approach follows a direct soprano-led voicing recipe rather than
 * searching a large candidate graph. For each chord, it places a soprano near
 * the top of the harmony range, builds a compact closed voicing beneath it,
 * and then applies a drop-2 opening when possible.
 *
 * It is simple, deterministic, and musically serviceable, but it does not look
 * ahead across the progression. That makes it a good baseline to compare more
 * optimization-heavy generators against.
 */

import type {
  Chord,
  HarmonyChordAnnotation,
  HarmonyRangeCoverage,
  HarmonyVoicing,
  MidiNote,
  VocalRange,
} from "./types";
import {
  appendVoicesToLines,
  buildFallbackCandidate,
  buildHarmonyVoicing,
  createEmptyHarmonyVoicing,
  createHarmonyLines,
  makeAnnotation,
  resolveHarmonyPartCount,
  resolveHarmonyRange,
} from "./harmonyShared";

export function generateHarmony(
  chords: Chord[],
  range: VocalRange,
  harmonyPartCount: number,
  harmonyRangeCoverage: HarmonyRangeCoverage = "lower two thirds",
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
  let prevSoprano: MidiNote | null = null;

  for (const chord of chords) {
    const voiced = buildFallbackCandidate(chord, harmonyRange, prevSoprano);
    annotations.push(makeAnnotation("legacy", voiced.strategy, chord));
    appendVoicesToLines(lines, voiced.notes, resolvedHarmonyPartCount);
    prevSoprano = voiced.notes[2];
  }

  return buildHarmonyVoicing(
    lines,
    annotations,
    harmonyTop,
    resolvedHarmonyPartCount,
  );
}
