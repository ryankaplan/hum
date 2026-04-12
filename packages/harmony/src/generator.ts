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
  const { range, voices } = options;
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

  const candidateSets = chords.map((chord) => {
    const candidates = generateHarmonyCandidates(chord, range).slice(
      0,
      MAX_CANDIDATES_PER_CHORD,
    );
    if (candidates.length > 0) return candidates;
    return [
      buildFallbackCandidate(chord, range, null),
    ] satisfies HarmonyVoicingCandidate[];
  });

  const bestPath = chooseBestHarmonyPath(chords, candidateSets, range);
  const lines = createHarmonyLines(voices);
  const annotations: HarmonyAnnotation[] = [];

  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i]!;
    const candidate = bestPath[i]!;
    annotations.push({
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
    harmonyTop: range.high,
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
