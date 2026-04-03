import { triadSemitones } from "./parse";
import type {
  Chord,
  HarmonyLine,
  HarmonyVoicing,
  MidiNote,
  VocalRange,
} from "./types";

// Generates 3 harmony voice lines from a chord progression and vocal range.
// The bottom 2/3 of the range is used for harmony; melody lives in the top 1/3.
export function generateHarmony(
  chords: Chord[],
  range: VocalRange,
): HarmonyVoicing {
  if (chords.length === 0) {
    return {
      lines: [[], [], []],
      harmonyTop: range.low,
    };
  }

  const rangeSpan = range.high - range.low;
  // Bottom 2/3 for harmony
  const harmonyTop = range.low + Math.round((rangeSpan * 2) / 3);
  const harmonyRange: VocalRange = { low: range.low, high: harmonyTop };

  const lines: [HarmonyLine, HarmonyLine, HarmonyLine] = [[], [], []];
  let prevVoices: [MidiNote, MidiNote, MidiNote] | null = null;

  for (const chord of chords) {
    const voices = voiceChord(chord, harmonyRange, prevVoices);
    lines[0].push(voices[0]);
    lines[1].push(voices[1]);
    lines[2].push(voices[2]);
    prevVoices = voices;
  }

  return { lines, harmonyTop };
}

// Voice a single chord within the harmony range, using the previous voices
// for smooth voice leading.
function voiceChord(
  chord: Chord,
  range: VocalRange,
  prev: [MidiNote, MidiNote, MidiNote] | null,
): [MidiNote, MidiNote, MidiNote] {
  const tones = getAllTriadTones(chord, range);

  if (prev == null) {
    return initialVoicing(tones, range);
  }

  return smoothVoicing(tones, prev, range);
}

// Get all MIDI notes that are triad tones within the given range
function getAllTriadTones(chord: Chord, range: VocalRange): MidiNote[] {
  const [r, t, f] = triadSemitones(chord.root, chord.quality);
  const result: MidiNote[] = [];

  // Check every MIDI note in range
  for (let midi = range.low; midi <= range.high; midi++) {
    const semitone = ((midi % 12) + 12) % 12;
    if (semitone === r % 12 || semitone === t % 12 || semitone === f % 12) {
      result.push(midi);
    }
  }

  return result;
}

// Pick the initial voicing: lowest available tone for low, spread upward
function initialVoicing(
  tones: MidiNote[],
  range: VocalRange,
): [MidiNote, MidiNote, MidiNote] {
  if (tones.length === 0) {
    // Fallback: use the range boundaries
    const span = range.high - range.low;
    return [range.low, range.low + Math.floor(span / 3), range.low + Math.floor((span * 2) / 3)];
  }

  // Divide the harmony range into 3 bands and pick the best tone in each
  const span = range.high - range.low;
  const bandSize = span / 3;

  const lowBandTop = range.low + bandSize;
  const midBandTop = range.low + bandSize * 2;

  const low = bestToneInBand(tones, range.low, lowBandTop);
  const mid = bestToneInBand(tones, lowBandTop, midBandTop);
  const high = bestToneInBand(tones, midBandTop, range.high);

  return enforceOrdering([low, mid, high], tones, range);
}

function bestToneInBand(
  tones: MidiNote[],
  bandLow: number,
  bandHigh: number,
): MidiNote {
  // First try to find a tone within the band
  const inBand = tones.filter((t) => t >= bandLow && t <= bandHigh);
  if (inBand.length > 0) {
    // Pick the one closest to the middle of the band
    const mid = (bandLow + bandHigh) / 2;
    return inBand.reduce((best, t) =>
      Math.abs(t - mid) < Math.abs(best - mid) ? t : best,
    );
  }

  // Fall back to the nearest tone outside the band
  const center = (bandLow + bandHigh) / 2;
  return tones.reduce((best, t) =>
    Math.abs(t - center) < Math.abs(best - center) ? t : best,
  );
}

// Voice leading: move each voice to the nearest chord tone, preserving
// common tones and avoiding voice crossing.
function smoothVoicing(
  tones: MidiNote[],
  prev: [MidiNote, MidiNote, MidiNote],
  range: VocalRange,
): [MidiNote, MidiNote, MidiNote] {
  if (tones.length === 0) {
    return prev;
  }

  // Try to keep common tones, move others to nearest chord tone
  const voices: [MidiNote, MidiNote, MidiNote] = [0, 0, 0];

  for (let i = 0; i < 3; i++) {
    const prevNote = prev[i]!;
    // Check if prev note is a chord tone (same pitch class)
    const prevClass = ((prevNote % 12) + 12) % 12;
    const isCommonTone = tones.some(
      (t) => ((t % 12) + 12) % 12 === prevClass,
    );

    if (isCommonTone) {
      // Keep the same note
      voices[i] = prevNote;
    } else {
      // Move to nearest chord tone in range
      voices[i] = nearestTone(tones, prevNote);
    }
  }

  return enforceOrdering(voices, tones, range);
}

function nearestTone(tones: MidiNote[], target: MidiNote): MidiNote {
  return tones.reduce((best, t) =>
    Math.abs(t - target) < Math.abs(best - target) ? t : best,
  );
}

// Ensure low < mid < high, reassigning chord tones as needed
function enforceOrdering(
  voices: [MidiNote, MidiNote, MidiNote],
  tones: MidiNote[],
  range: VocalRange,
): [MidiNote, MidiNote, MidiNote] {
  let [low, mid, high] = voices;

  if (low == null || mid == null || high == null || tones.length === 0) {
    return voices;
  }

  // Sort the 3 voices
  const sorted = [low, mid, high].sort((a, b) => a - b) as [
    MidiNote,
    MidiNote,
    MidiNote,
  ];

  [low, mid, high] = sorted;

  // Ensure they're not all the same — if so, spread them out
  if (low === mid || mid === high) {
    // Try to find 3 distinct tones
    const distinct = deduplicateVoices(sorted, tones, range);
    return distinct;
  }

  return [low, mid, high];
}

// Try to assign 3 distinct pitch classes to the 3 voices
function deduplicateVoices(
  voices: [MidiNote, MidiNote, MidiNote],
  tones: MidiNote[],
  range: VocalRange,
): [MidiNote, MidiNote, MidiNote] {
  if (tones.length < 2) return voices;

  // Get all unique pitch classes available in tones
  const classes = new Set(tones.map((t) => ((t % 12) + 12) % 12));

  if (classes.size < 2) return voices;

  // Greedily assign: for each voice target, pick the nearest tone with a
  // different pitch class than already assigned, sorted low to high
  const span = range.high - range.low;
  const targets = [
    range.low + Math.floor(span / 6),
    range.low + Math.floor(span / 2),
    range.low + Math.floor((span * 5) / 6),
  ];

  const usedClasses = new Set<number>();
  const result: MidiNote[] = [];

  for (const target of targets) {
    // Prefer tones with unused pitch class
    const unused = tones.filter(
      (t) => !usedClasses.has(((t % 12) + 12) % 12),
    );
    const pool = unused.length > 0 ? unused : tones;
    const chosen = pool.reduce((best, t) =>
      Math.abs(t - target) < Math.abs(best - target) ? t : best,
    );
    result.push(chosen);
    usedClasses.add(((chosen % 12) + 12) % 12);
  }

  const sorted = result.sort((a, b) => a - b);
  return [sorted[0]!, sorted[1]!, sorted[2]!];
}
