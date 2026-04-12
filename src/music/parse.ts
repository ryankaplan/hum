import type { Chord, ChordQuality, NoteName } from "./types";
import { NOTE_NAMES } from "./types";

// Parses a chord progression string like "A A F#m F#m D D E E"
// Each token is one bar (beatsPerBar beats). Separate by spaces and/or commas.
// Group syntax: "[A E]" means both chords share one bar evenly.
export function parseChordProgression(
  input: string,
  beatsPerBar: number,
): Chord[] {
  const chords: Chord[] = [];
  const tokens = tokenizeProgression(input);

  for (const token of tokens) {
    if (token === "") continue;
    if (token.startsWith("[") && token.endsWith("]")) {
      const grouped = parseGroupedBarToken(token, beatsPerBar);
      for (const chord of grouped) {
        chords.push(chord);
      }
      continue;
    }
    const parsed = parseChordText(token, beatsPerBar);
    if (parsed != null) {
      chords.push(parsed);
    }
  }

  return chords;
}

function parseGroupedBarToken(token: string, beatsPerBar: number): Chord[] {
  const inner = token.slice(1, -1).trim();
  if (inner === "") return [];
  const parts = inner.split(/[\s,]+/).filter((part) => part.length > 0);
  if (parts.length === 0) return [];
  const beatsPerChord = beatsPerBar / parts.length;
  if (!Number.isFinite(beatsPerChord) || beatsPerChord <= 0) return [];

  const grouped: Chord[] = [];
  for (const part of parts) {
    const parsed = parseChordText(part, beatsPerChord);
    // If any chord in the grouped bar is invalid, discard the whole group.
    if (parsed == null) return [];
    grouped.push(parsed);
  }
  return grouped;
}

export function parseChordText(token: string, beats: number): Chord | null {
  const match = token.match(
    /^([A-G][#b]?)(maj7|M7|add9|m7b9|-7b9|7b9|\(b9\)|m9|-9|9sus2|9sus4|9|sus2|sus4|m7|-7|m6|-6|6|dim|o|m|-|7)?(?:\/([A-G][#b]?))?$/,
  );
  if (match == null) return null;

  const root = normalizeRoot(match[1]!);
  if (root == null) return null;

  const suffix = match[2] ?? "";
  const quality = parseChordQualitySuffix(suffix);
  if (quality == null) return null;

  const bass = match[3] != null ? normalizeRoot(match[3]) : null;
  if (match[3] != null && bass == null) return null;
  if (bass != null && !chordContainsPitchClass(root, quality, rootSemitone(bass))) {
    return null;
  }

  return { root, quality, bass, beats };
}

function parseChordQualitySuffix(raw: string): ChordQuality | null {
  switch (raw) {
    case "":
      return "major";
    case "m":
    case "-":
      return "minor";
    case "add9":
      return "add9";
    case "dim":
    case "o":
      return "diminished";
    case "6":
      return "major6";
    case "m6":
    case "-6":
      return "minor6";
    case "7":
      return "dominant7";
    case "9":
      return "dominant9";
    case "m7":
    case "-7":
      return "minor7";
    case "m9":
    case "-9":
      return "minor9";
    case "7b9":
    case "(b9)":
      return "dominant7Flat9";
    case "m7b9":
    case "-7b9":
      return "minor7Flat9";
    case "maj7":
    case "M7":
      return "major7";
    case "sus2":
      return "sus2";
    case "sus4":
      return "sus4";
    case "9sus2":
      return "dominant9Sus2";
    case "9sus4":
      return "dominant9Sus4";
    default:
      return null;
  }
}

function tokenizeProgression(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inGroup = false;

  for (const char of input) {
    if (inGroup) {
      current += char;
      if (char === "]") {
        const trimmed = current.trim();
        if (trimmed !== "") tokens.push(trimmed);
        current = "";
        inGroup = false;
      }
      continue;
    }

    if (char === "[") {
      const trimmed = current.trim();
      if (trimmed !== "") tokens.push(trimmed);
      current = "[";
      inGroup = true;
      continue;
    }

    if (/\s|,/.test(char)) {
      const trimmed = current.trim();
      if (trimmed !== "") tokens.push(trimmed);
      current = "";
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail !== "") tokens.push(tail);
  return tokens;
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

// Returns the 3 semitone intervals used for voicing and display.
// Extended chords use a practical 3-note reduction that preserves the
// defining color tone.
export function chordSemitones(
  root: NoteName,
  quality: ChordQuality,
): [number, number, number] {
  const r = rootSemitone(root);
  switch (quality) {
    case "major":
      return [r, r + 4, r + 7];
    case "minor":
      return [r, r + 3, r + 7];
    case "add9":
      return [r, r + 4, r + 14];
    case "diminished":
      return [r, r + 3, r + 6];
    case "major6":
      return [r, r + 4, r + 9];
    case "minor6":
      return [r, r + 3, r + 9];
    case "dominant7":
      return [r, r + 4, r + 10];
    case "minor7":
      return [r, r + 3, r + 10];
    case "major7":
      return [r, r + 4, r + 11];
    case "dominant9":
      return [r, r + 4, r + 14];
    case "minor9":
      return [r, r + 3, r + 14];
    case "dominant7Flat9":
      return [r, r + 4, r + 13];
    case "minor7Flat9":
      return [r, r + 3, r + 13];
    case "sus2":
      return [r, r + 2, r + 7];
    case "sus4":
      return [r, r + 5, r + 7];
    case "dominant9Sus2":
      return [r, r + 2, r + 14];
    case "dominant9Sus4":
      return [r, r + 5, r + 14];
  }
}

/** Root-position chord spellings as pitch-class note names, e.g. `"C E G"`. */
export function chordPitchClassNames(chord: Chord): string {
  const [r, t, f] = chordSemitones(chord.root, chord.quality);
  const a = NOTE_NAMES[((r % 12) + 12) % 12]!;
  const b = NOTE_NAMES[((t % 12) + 12) % 12]!;
  const c = NOTE_NAMES[((f % 12) + 12) % 12]!;
  return `${a} ${b} ${c}`;
}

export function formatChordSymbol(chord: Chord): string {
  const suffix = chordQualitySuffix(chord.quality);
  const bass = chord.bass == null ? "" : `/${chord.bass}`;
  return `${chord.root}${suffix}${bass}`;
}

export function totalBeats(chords: Chord[]): number {
  let sum = 0;
  for (const chord of chords) {
    sum += chord.beats;
  }
  return sum;
}

function chordContainsPitchClass(
  root: NoteName,
  quality: ChordQuality,
  pitch: number,
): boolean {
  const normalizedPitch = ((pitch % 12) + 12) % 12;
  return fullChordSemitones(root, quality).some(
    (tone) => ((tone % 12) + 12) % 12 === normalizedPitch,
  );
}

export function fullChordSemitones(
  root: NoteName,
  quality: ChordQuality,
): number[] {
  const r = rootSemitone(root);
  switch (quality) {
    case "major":
      return [r, r + 4, r + 7];
    case "minor":
      return [r, r + 3, r + 7];
    case "add9":
      return [r, r + 4, r + 7, r + 14];
    case "diminished":
      return [r, r + 3, r + 6];
    case "major6":
      return [r, r + 4, r + 7, r + 9];
    case "minor6":
      return [r, r + 3, r + 7, r + 9];
    case "dominant7":
      return [r, r + 4, r + 7, r + 10];
    case "minor7":
      return [r, r + 3, r + 7, r + 10];
    case "major7":
      return [r, r + 4, r + 7, r + 11];
    case "dominant9":
      return [r, r + 4, r + 7, r + 10, r + 14];
    case "minor9":
      return [r, r + 3, r + 7, r + 10, r + 14];
    case "dominant7Flat9":
      return [r, r + 4, r + 7, r + 10, r + 13];
    case "minor7Flat9":
      return [r, r + 3, r + 7, r + 10, r + 13];
    case "sus2":
      return [r, r + 2, r + 7];
    case "sus4":
      return [r, r + 5, r + 7];
    case "dominant9Sus2":
      return [r, r + 2, r + 7, r + 10, r + 14];
    case "dominant9Sus4":
      return [r, r + 5, r + 7, r + 10, r + 14];
  }
}

function chordQualitySuffix(quality: ChordQuality): string {
  switch (quality) {
    case "major":
      return "";
    case "minor":
      return "m";
    case "add9":
      return "add9";
    case "diminished":
      return "dim";
    case "major6":
      return "6";
    case "minor6":
      return "m6";
    case "dominant7":
      return "7";
    case "minor7":
      return "m7";
    case "major7":
      return "maj7";
    case "dominant9":
      return "9";
    case "minor9":
      return "m9";
    case "dominant7Flat9":
      return "(b9)";
    case "minor7Flat9":
      return "m7b9";
    case "sus2":
      return "sus2";
    case "sus4":
      return "sus4";
    case "dominant9Sus2":
      return "9sus2";
    case "dominant9Sus4":
      return "9sus4";
  }
}
