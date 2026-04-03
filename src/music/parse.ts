import type { Chord, NoteName, TriadQuality } from "./types";

// Parses a chord progression string like "A A F#m F#m D D E E"
// Each token is one bar (beatsPerBar beats). Separate by spaces and/or commas.
export function parseChordProgression(
  input: string,
  beatsPerBar: number,
): Chord[] {
  const chords: Chord[] = [];
  const tokens = input.trim().split(/[\s,]+/);

  for (const token of tokens) {
    if (token === "") continue;
    const parsed = parseChordToken(token, beatsPerBar);
    if (parsed != null) {
      chords.push(parsed);
    }
  }

  return chords;
}

function parseChordToken(token: string, beatsPerBar: number): Chord | null {
  // Match chord name only: "A", "F#m", "Bb", "C#m"
  const match = token.match(/^([A-G][#b]?)(m?)$/i);
  if (match == null) return null;

  const root = normalizeRoot(match[1]!);
  if (root == null) return null;

  const quality: TriadQuality = match[2] === "m" ? "minor" : "major";

  return { root, quality, beats: beatsPerBar };
}

// Valid note names after normalizing flats to sharps
const FLAT_TO_SHARP: Record<string, NoteName> = {
  Bb: "A#",
  Db: "C#",
  Eb: "D#",
  Gb: "F#",
  Ab: "G#",
};

const VALID_ROOTS = new Set<string>([
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
]);

function normalizeRoot(raw: string): NoteName | null {
  const capitalized = raw.charAt(0).toUpperCase() + raw.slice(1);
  if (FLAT_TO_SHARP[capitalized] != null) {
    return FLAT_TO_SHARP[capitalized]!;
  }
  if (VALID_ROOTS.has(capitalized)) {
    return capitalized as NoteName;
  }
  return null;
}

// Returns the semitone offset from C for a given root name
export function rootSemitone(root: NoteName): number {
  const semitones: Record<NoteName, number> = {
    C: 0,
    "C#": 1,
    D: 2,
    "D#": 3,
    E: 4,
    F: 5,
    "F#": 6,
    G: 7,
    "G#": 8,
    A: 9,
    "A#": 10,
    B: 11,
  };
  return semitones[root];
}

// Returns the 3 semitone intervals [root, third, fifth] relative to C0
// for a given chord in a specific octave
export function triadSemitones(
  root: NoteName,
  quality: TriadQuality,
): [number, number, number] {
  const r = rootSemitone(root);
  const third = quality === "major" ? r + 4 : r + 3;
  const fifth = r + 7;
  return [r, third, fifth];
}

export function totalBeats(chords: Chord[]): number {
  let sum = 0;
  for (const chord of chords) {
    sum += chord.beats;
  }
  return sum;
}
