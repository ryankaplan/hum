/*
 * Beam-search harmony generation.
 *
 * This module assembles per-chord candidates into the app's HarmonyVoicing
 * shape and uses beam search to choose the best path across a progression.
 */

import type {
  Chord,
  HarmonyChordAnnotation,
  HarmonyLine,
  HarmonyRangeCoverage,
  HarmonyVoicing,
  HarmonyVoicingStrategy,
  MidiNote,
  VocalRange,
} from "../types";
import { chordToneFormula, describeHarmonyNotesForChord } from "./annotation";
import { chooseBestHarmonyPath } from "./beamSearch";
import {
  buildFallbackCandidate,
  generateHarmonyCandidates,
  type HarmonyVoicingCandidate,
} from "./candidates";

const MAX_CANDIDATES_PER_CHORD = 40;

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
  const candidateSets = chords.map((chord) => {
    const candidates = generateHarmonyCandidates(chord, harmonyRange).slice(
      0,
      MAX_CANDIDATES_PER_CHORD,
    );
    if (candidates.length > 0) return candidates;
    return [
      buildFallbackCandidate(chord, harmonyRange, null),
    ] satisfies HarmonyVoicingCandidate[];
  });

  const bestPath = chooseBestHarmonyPath(chords, candidateSets, harmonyRange);
  const lines = createHarmonyLines(resolvedHarmonyPartCount);
  const annotations: HarmonyChordAnnotation[] = [];

  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i]!;
    const candidate = bestPath[i]!;
    annotations.push(
      makeAnnotation(
        candidate.strategy,
        chord,
        describeHarmonyNotesForChord(chord, candidate.notes),
      ),
    );
    appendVoicesToLines(lines, candidate.notes, resolvedHarmonyPartCount);
  }

  return buildHarmonyVoicing(
    lines,
    annotations,
    harmonyTop,
    resolvedHarmonyPartCount,
  );
}

function resolveHarmonyPartCount(harmonyPartCount: number): number {
  return harmonyPartCount === 1 ? 1 : 3;
}

function resolveHarmonyRange(
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

function createEmptyHarmonyVoicing(
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

function createHarmonyLines(harmonyPartCount: number): HarmonyLine[] {
  return Array.from(
    { length: resolveHarmonyPartCount(harmonyPartCount) },
    () => [],
  );
}

function appendVoicesToLines(
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

function buildHarmonyVoicing(
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

function makeAnnotation(
  strategy: HarmonyVoicingStrategy,
  chord: Chord,
  chordTones: HarmonyChordAnnotation["chordTones"] = chordToneFormula(chord),
): HarmonyChordAnnotation {
  return {
    strategy,
    chordTones,
  };
}

function harmonyCoverageRatio(coverage: HarmonyRangeCoverage): number {
  switch (coverage) {
    case "lower two thirds":
      return 2 / 3;
    case "whole-range":
      return 1;
  }
}
