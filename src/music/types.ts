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

export type TriadQuality = "major" | "minor";

export type Chord = {
  root: NoteName;
  quality: TriadQuality;
  // How many beats this chord lasts (e.g. "A x2" in 4/4 = 8 beats)
  beats: number;
};

// A single MIDI note number (60 = middle C)
export type MidiNote = number;

// The note a single voice sings for each chord in the progression.
// One entry per chord, same length as the Chord[] array.
export type HarmonyLine = MidiNote[];

export type VocalRange = {
  low: MidiNote;
  high: MidiNote;
};

// The full voicing output: three harmony lines + computed melody range ceiling
export type HarmonyVoicing = {
  lines: [HarmonyLine, HarmonyLine, HarmonyLine];
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

// Which part is being recorded: 0-2 = harmony low/mid/high, 3 = melody
export type PartIndex = 0 | 1 | 2 | 3;

export const PART_LABELS: Record<PartIndex, string> = {
  0: "Harmony Low",
  1: "Harmony Mid",
  2: "Harmony High",
  3: "Melody",
};

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
