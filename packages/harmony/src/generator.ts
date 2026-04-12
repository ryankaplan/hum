import { chooseBestHarmonyPath } from "./beamSearch";
import {
  buildFallbackCandidate,
  generateHarmonyCandidates,
  type HarmonyVoicingCandidate,
} from "./candidates";
import { describeHarmonyNotesForChord } from "./annotation";
import type {
  ChordSymbol,
  GenerateHarmonyOptions,
  GeneratedHarmony,
  HarmonyAnnotation,
  HarmonyCoverage,
  HarmonyLine,
  MidiNote,
} from "./types";

const MAX_CANDIDATES_PER_CHORD = 40;

export function generateHarmony(
  input: {
    events: Array<{
      symbol: ChordSymbol;
      startBeat: number;
      durationBeats: number;
    }>;
  },
  options: GenerateHarmonyOptions,
): GeneratedHarmony {
  const { range, coverage = "lowerTwoThirds", voices } = options;
  if (range.high <= range.low) {
    throw new RangeError("Harmony range must have high > low.");
  }

  const chords = input.events.map((event) => event.symbol);
  if (chords.length === 0) {
    return {
      lines: Array.from({ length: voices }, () => []),
      annotations: [],
      timedVoices: Array.from({ length: voices }, () => ({ events: [] })),
      harmonyTop: range.low,
    };
  }

  const { harmonyRange, harmonyTop } = resolveHarmonyRange(range, coverage);
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
  const lines = createHarmonyLines(voices);
  const annotations: HarmonyAnnotation[] = [];

  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i]!;
    const candidate = bestPath[i]!;
    annotations.push({
      strategy: candidate.strategy,
      chordTones: describeHarmonyNotesForChord(chord, candidate.notes),
    });
    appendVoicesToLines(lines, candidate.notes, voices);
  }

  const timedVoices = lines.map((line) => ({
    events: input.events.map((event, index) => ({
      startBeat: event.startBeat,
      durationBeats: event.durationBeats,
      midi: line[index] ?? null,
    })),
  }));

  return {
    lines,
    annotations,
    timedVoices,
    harmonyTop,
  };
}

function resolveHarmonyRange(
  range: GenerateHarmonyOptions["range"],
  coverage: HarmonyCoverage,
): {
  harmonyRange: GenerateHarmonyOptions["range"];
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

function createHarmonyLines(voices: 1 | 3): HarmonyLine[] {
  return Array.from({ length: voices }, () => []);
}

function appendVoicesToLines(
  lines: HarmonyLine[],
  voices: [MidiNote, MidiNote, MidiNote],
  requestedVoices: 1 | 3,
) {
  if (requestedVoices === 1) {
    lines[0]?.push(voices[1]);
    return;
  }
  lines[0]?.push(voices[0]);
  lines[1]?.push(voices[1]);
  lines[2]?.push(voices[2]);
}

function harmonyCoverageRatio(coverage: HarmonyCoverage): number {
  switch (coverage) {
    case "lowerTwoThirds":
      return 2 / 3;
    case "wholeRange":
      return 1;
  }
}
