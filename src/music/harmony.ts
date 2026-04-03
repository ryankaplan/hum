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
//
// Strategy: soprano-led drop-2 voicings.
//   1. The top harmony voice (soprano) is placed near the top of the harmony
//      range and moves to the nearest chord tone on each chord change.
//   2. A closed-position voicing is built downward from the soprano (two more
//      chord tones within one octave below, stacked in thirds).
//   3. Drop-2 is applied: the second-highest voice drops an octave, opening
//      the voicing into the characteristic spread sound used in jazz/choral
//      a cappella arrangements.
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
  const harmonyTop = range.low + Math.round((rangeSpan * 2) / 3);
  const harmonyRange: VocalRange = { low: range.low, high: harmonyTop };

  const lines: [HarmonyLine, HarmonyLine, HarmonyLine] = [[], [], []];
  let prevSoprano: MidiNote | null = null;

  for (const chord of chords) {
    const voices = voiceChord(chord, harmonyRange, prevSoprano);
    lines[0].push(voices[0]);
    lines[1].push(voices[1]);
    lines[2].push(voices[2]);
    prevSoprano = voices[2];
  }

  return { lines, harmonyTop };
}

function voiceChord(
  chord: Chord,
  range: VocalRange,
  prevSoprano: MidiNote | null,
): [MidiNote, MidiNote, MidiNote] {
  const classes = triadClasses(chord);

  // Soprano targets the previous soprano for smooth voice leading, or the top
  // of the harmony range on the first chord.
  const sopranoTarget = prevSoprano ?? range.high;
  const soprano = nearestChordTone(classes, sopranoTarget, range.low, range.high);

  // Build closed voicing from soprano downward, then apply drop-2.
  const closed = buildClosedVoicing(soprano, classes);
  const dropped = applyDrop2(closed);

  if (dropped[0] >= range.low) {
    return dropped;
  }

  // Drop-2 pushed the lowest voice below the range. Try the soprano an octave
  // higher — this raises the whole stack and may keep everything in range.
  const sopranoUp = soprano + 12;
  if (sopranoUp <= range.high) {
    const closedUp = buildClosedVoicing(sopranoUp, classes);
    const droppedUp = applyDrop2(closedUp);
    if (droppedUp[0] >= range.low) {
      return droppedUp;
    }
  }

  // Fallback: use the closed voicing without drop-2 (still sounds fine, just
  // tighter spacing).
  return closed;
}

// Returns the 3 pitch classes (0–11) for a chord's triad.
function triadClasses(chord: Chord): Set<number> {
  const [r, t, f] = triadSemitones(chord.root, chord.quality);
  return new Set([r % 12, t % 12, f % 12]);
}

// Finds the chord tone nearest to `target` within [low, high], searching
// outward from target so that ties prefer the upward direction (keeps the
// soprano from drifting low).
function nearestChordTone(
  classes: Set<number>,
  target: MidiNote,
  low: MidiNote,
  high: MidiNote,
): MidiNote {
  for (let delta = 0; delta <= high - low; delta++) {
    if (target + delta <= high) {
      if (classes.has(((target + delta) % 12 + 12) % 12)) {
        return target + delta;
      }
    }
    if (delta > 0 && target - delta >= low) {
      if (classes.has((((target - delta) % 12) + 12) % 12)) {
        return target - delta;
      }
    }
  }
  return Math.max(low, Math.min(high, target));
}

// Builds a closed-position voicing [low, mid, high] starting from soprano
// and filling in the two nearest chord tones below it (each a distinct pitch
// class), within a maximum of 12 semitones below the previous voice.
function buildClosedVoicing(
  soprano: MidiNote,
  classes: Set<number>,
): [MidiNote, MidiNote, MidiNote] {
  const usedClasses = new Set([((soprano % 12) + 12) % 12]);
  const voices: MidiNote[] = [soprano];
  let below = soprano;

  for (let slot = 0; slot < 2; slot++) {
    for (let delta = 1; delta <= 12; delta++) {
      const candidate = below - delta;
      const cls = ((candidate % 12) + 12) % 12;
      if (classes.has(cls) && !usedClasses.has(cls)) {
        voices.push(candidate);
        usedClasses.add(cls);
        below = candidate;
        break;
      }
    }
  }

  voices.sort((a, b) => a - b);
  return [voices[0]!, voices[1]!, voices[2]!];
}

// Drop-2: drops the second-highest voice (index 1 in the sorted triple) down
// an octave, opening up the closed voicing.
function applyDrop2(
  voices: [MidiNote, MidiNote, MidiNote],
): [MidiNote, MidiNote, MidiNote] {
  const result = [voices[0], voices[1] - 12, voices[2]];
  result.sort((a, b) => a - b);
  return [result[0]!, result[1]!, result[2]!];
}
