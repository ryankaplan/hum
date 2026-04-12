import type {
  ChordQuality as PackageChordQuality,
  ChordSymbol,
  GeneratedHarmony,
  HarmonyAnnotation,
  HarmonyCoverage,
  HarmonyLine as PackageHarmonyLine,
  HarmonyVoicingStrategy,
  MidiNote,
  NoteName,
  VocalRange,
} from "@hum/harmony";
import { NOTE_NAMES } from "@hum/harmony";

export type { MidiNote, NoteName, VocalRange, HarmonyVoicingStrategy };
export type ChordQuality = PackageChordQuality;

export type Chord = ChordSymbol & {
  // How many beats this chord lasts (e.g. "A x2" in 4/4 = 8 beats)
  beats: number;
};

// The note a single voice sings for each chord in the progression.
// One entry per chord, same length as the Chord[] array.
// Null means that voice rests for that chord.
export type HarmonyLine = PackageHarmonyLine;

export function getHarmonyLineNote(
  line: HarmonyLine | null | undefined,
  chordIndex: number,
): MidiNote | null {
  return line?.[chordIndex] ?? null;
}

export type HarmonyRangeCoverage = "lower two thirds" | "whole-range";

export type ChordToneFormula = string;

export type HarmonyChordAnnotation = HarmonyAnnotation;

// The full voicing output: one or more harmony lines + computed melody range
// ceiling.
export type HarmonyVoicing = GeneratedHarmony & {
  harmonyPartCount: number;
};

export type Meter = [number, number]; // [beats per bar, note value]

export type ProjectConfig = {
  chords: string; // raw input string
  tempo: number;
  meter: Meter;
  vocalRangeLow: string; // e.g. "C3"
  vocalRangeHigh: string; // e.g. "C5"
};

export type PartIndex = number;

const FOUR_PART_LABELS = [
  "Harmony Low",
  "Harmony Mid",
  "Harmony High",
  "Melody",
] as const;

export function getPartLabel(index: number, totalParts: number): string {
  if (totalParts === 2) {
    return index === 0 ? "Harmony" : "Melody";
  }
  return FOUR_PART_LABELS[index] ?? `Part ${index + 1}`;
}

// MIDI note number helpers
export { NOTE_NAMES };

export function midiToNoteName(midi: MidiNote): string {
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES[midi % 12];
  return `${name}${octave}`;
}

export function noteNameToMidi(name: string): MidiNote {
  // e.g. "C4", "F#3", "Bb2"
  const match = name.match(/^([A-G][#b]?)(-?\d+)$/);
  if (match == null) {
    throw new Error(`Invalid note name: ${name}`);
  }
  const notePart = match[1]!;
  const octave = parseInt(match[2]!, 10);

  // Normalize flats to sharps
  const normalized = flatToSharp(notePart);
  const semitone = NOTE_NAMES.indexOf(normalized as NoteName);
  if (semitone === -1) {
    throw new Error(`Unknown note: ${notePart}`);
  }
  return (octave + 1) * 12 + semitone;
}

function flatToSharp(note: string): string {
  const flats: Record<string, string> = {
    Bb: "A#",
    Db: "C#",
    Eb: "D#",
    Gb: "F#",
    Ab: "G#",
  };
  return flats[note] ?? note;
}
