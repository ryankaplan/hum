import type { Chord, NoteName, TriadQuality } from "./types";

// Parses a chord progression string like "A x2, F#m x2, D x2, E x2"
// into an array of Chord objects with beat counts.
// "x2" means 2 bars. Beats per chord = barCount * beatsPerBar.
export function parseChordProgression(
  input: string,
  beatsPerBar: number,
): Chord[] {
  const chords: Chord[] = [];
  const tokens = input.split(",");

  for (const token of tokens) {
    const trimmed = token.trim();
    if (trimmed === "") continue;

    const parsed = parseChordToken(trimmed, beatsPerBar);
    if (parsed != null) {
      chords.push(parsed);
    }
  }

  return chords;
}

function parseChordToken(token: string, beatsPerBar: number): Chord | null {
  // Match patterns like: "A", "F#m", "Bb x2", "C#m x3"
  const match = token.match(
    /^([A-G][#b]?)(m?)\s*(?:x(\d+))?$/i,
  );
  if (match == null) return null;

  const rootRaw = match[1]!;
  const isMinor = match[2] === "m";
  const bars = match[3] != null ? parseInt(match[3], 10) : 1;

  const root = normalizeRoot(rootRaw);
  if (root == null) return null;

  const quality: TriadQuality = isMinor ? "minor" : "major";
  const beats = bars * beatsPerBar;

  return { root, quality, beats };
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
