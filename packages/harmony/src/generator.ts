import { chooseBestHarmonyPath } from "./beamSearch";
import {
  buildFallbackCandidate,
  generateHarmonyCandidates,
  type HarmonyVoicingCandidate,
} from "./candidates";
import { chooseBestDyadPath } from "./dyadBeamSearch";
import {
  buildFallbackDyadCandidate,
  generateDyadCandidates,
  type HarmonyDyadCandidate,
} from "./dyadCandidates";
import { HARMONY_PRIORITY_PROFILES } from "./profiles";
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
  const { range, voices, priority = "voiceLeading" } = options;
  if (voices !== 2 && voices !== 3) {
    throw new RangeError("Harmony voices must be 2 or 3.");
  }
  if (range.high <= range.low) {
    throw new RangeError("Harmony range must have high > low.");
  }

  return voices === 2
    ? generateTwoVoiceHarmony(input, range, priority)
    : generateThreeVoiceHarmony(input, range);
}

function generateTwoVoiceHarmony(
  input: {
    events: Array<{
      symbol: ChordSymbol;
      startBeat: number;
      durationBeats: number;
    }>;
  },
  range: GenerateHarmonyOptions["range"],
  priority: NonNullable<GenerateHarmonyOptions["priority"]>,
): GeneratedHarmony {
  const profile = HARMONY_PRIORITY_PROFILES[priority];
  const chords = input.events.map((event) => event.symbol);
  if (chords.length === 0) {
    return createEmptyHarmonyResult(input, 2, range.low);
  }

  const candidateSets = chords.map((chord) =>
    {
      const candidates = generateDyadCandidates(chord, range, profile).slice(
        0,
        MAX_CANDIDATES_PER_CHORD,
      );
      if (candidates.length > 0) return candidates;
      return [
        buildFallbackDyadCandidate(chord, range),
      ] satisfies HarmonyDyadCandidate[];
    },
  );
  const bestPath = chooseBestDyadPath(chords, candidateSets, range, profile);
  const lines = createHarmonyLines(2);
  const annotations: HarmonyAnnotation[] = [];

  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i]!;
    const candidate = bestPath[i]!;
    annotations.push({
      chordTones: describeHarmonyNotesForChord(chord, candidate.notes),
    });
    lines[0]?.push(candidate.notes[0]);
    lines[1]?.push(candidate.notes[1]);
  }

  return buildGeneratedHarmony(input, lines, annotations, range.high);
}

function generateThreeVoiceHarmony(
  input: {
    events: Array<{
      symbol: ChordSymbol;
      startBeat: number;
      durationBeats: number;
    }>;
  },
  range: GenerateHarmonyOptions["range"],
): GeneratedHarmony {
  const chords = input.events.map((event) => event.symbol);
  if (chords.length === 0) {
    return createEmptyHarmonyResult(input, 3, range.low);
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
  const lines = createHarmonyLines(3);
  const annotations: HarmonyAnnotation[] = [];

  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i]!;
    const candidate = bestPath[i]!;
    annotations.push({
      chordTones: describeHarmonyNotesForChord(chord, candidate.notes),
    });
    appendThreeVoicesToLines(lines, candidate.notes);
  }

  return buildGeneratedHarmony(input, lines, annotations, range.high);
}

function createEmptyHarmonyResult(
  input: {
    events: Array<{
      symbol: ChordSymbol;
      startBeat: number;
      durationBeats: number;
    }>;
  },
  voices: 2 | 3,
  harmonyTop: MidiNote,
): GeneratedHarmony {
  const lines = createHarmonyLines(voices);
  return buildGeneratedHarmony(input, lines, [], harmonyTop);
}

function buildGeneratedHarmony(
  input: {
    events: Array<{
      symbol: ChordSymbol;
      startBeat: number;
      durationBeats: number;
    }>;
  },
  lines: HarmonyLine[],
  annotations: HarmonyAnnotation[],
  harmonyTop: MidiNote,
): GeneratedHarmony {
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

function createHarmonyLines(voices: 2 | 3): HarmonyLine[] {
  return Array.from({ length: voices }, () => []);
}

function appendThreeVoicesToLines(
  lines: HarmonyLine[],
  voices: [MidiNote, MidiNote, MidiNote],
) {
  lines[0]?.push(voices[0]);
  lines[1]?.push(voices[1]);
  lines[2]?.push(voices[2]);
}
