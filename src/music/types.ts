export type NoteName =
  | "C"
  | "C#"
  | "D"
  | "D#"
  | "E"
  | "F"
  | "F#"
  | "G"
  | "G#"
  | "A"
  | "A#"
  | "B";

export type ChordQuality =
  | "major"
  | "minor"
  | "add9"
  | "diminished"
  | "major6"
  | "minor6"
  | "dominant7"
  | "minor7"
  | "major7"
  | "dominant9"
  | "minor9"
  | "dominant7Flat9"
  | "minor7Flat9"
  | "sus2"
  | "sus4"
  | "dominant9Sus2"
  | "dominant9Sus4";

export type Chord = {
  root: NoteName;
  quality: ChordQuality;
  bass: NoteName | null;
  // How many beats this chord lasts (e.g. "A x2" in 4/4 = 8 beats)
  beats: number;
};

// A single MIDI note number (60 = middle C)
export type MidiNote = number;

// The note a single voice sings for each chord in the progression.
// One entry per chord, same length as the Chord[] array.
// Null means that voice rests for that chord.
export type HarmonyLine = Array<MidiNote | null>;

export function getHarmonyLineNote(
  line: HarmonyLine | null | undefined,
  chordIndex: number,
): MidiNote | null {
  return line?.[chordIndex] ?? null;
}

export type VocalRange = {
  low: MidiNote;
  high: MidiNote;
};

export type HarmonyRangeCoverage = "lower two thirds" | "whole-range";

export type HarmonyVoicingStrategy = "drop2" | "closed" | "open" | "spread";
export type HarmonyVoicingGenerator = "legacy" | "dynamic";
export type SelectedHarmonyGenerator = HarmonyVoicingGenerator;

export type ChordToneFormula = string;

export type HarmonyChordAnnotation = {
  generator: HarmonyVoicingGenerator;
  strategy: HarmonyVoicingStrategy;
  chordTones: ChordToneFormula;
};

// The full voicing output: one or more harmony lines + computed melody range
// ceiling.
export type HarmonyVoicing = {
  lines: HarmonyLine[];
  harmonyPartCount: number;
  // One annotation per parsed chord, aligned by index with lines[*][i].
  annotations: HarmonyChordAnnotation[];
  // Highest MIDI note used by harmonies — melody should stay above this
  harmonyTop: MidiNote;
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
export const NOTE_NAMES: NoteName[] = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

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
