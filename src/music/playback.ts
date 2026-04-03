import * as Tone from "tone";
import type { Chord, HarmonyLine, MidiNote } from "./types";
import { midiToNoteName } from "./types";
import { totalBeats } from "./parse";

// A single Tone.js synth for guide tones
let guideSynth: Tone.PolySynth | null = null;
// A separate synth for the metronome click
let clickSynth: Tone.MembraneSynth | null = null;

function getGuideSynth(): Tone.PolySynth {
  if (guideSynth == null) {
    guideSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.02, decay: 0.1, sustain: 0.8, release: 0.3 },
      volume: -6,
    }).toDestination();
  }
  return guideSynth;
}

function getClickSynth(): Tone.MembraneSynth {
  if (clickSynth == null) {
    clickSynth = new Tone.MembraneSynth({
      pitchDecay: 0.03,
      octaves: 3,
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
      volume: -3,
    }).toDestination();
  }
  return clickSynth;
}

export type PlaybackSession = {
  stop: () => void;
};

// Play just a click track (count-in).
// Returns a promise that resolves when the count-in is complete.
export async function playCountIn(
  beatsPerBar: number,
  tempo: number,
): Promise<void> {
  Tone.getTransport().stop();
  Tone.getTransport().cancel();
  Tone.getTransport().bpm.value = tempo;

  const synth = getClickSynth();

  return new Promise<void>((resolve) => {
    let beatsFired = 0;

    for (let beat = 0; beat < beatsPerBar; beat++) {
      const time = `${beat}i`;
      Tone.getTransport().schedule((t) => {
        synth.triggerAttackRelease(beat === 0 ? "C2" : "C1", "16n", t);
        beatsFired++;
        if (beatsFired >= beatsPerBar) {
          // Resolve slightly after the last click fires
          setTimeout(resolve, (60 / tempo) * 1000 * 1.05);
        }
      }, `+${(beat * 60) / tempo}`);
    }

    Tone.getTransport().start();
  });
}

export type RecordingPlaybackOpts = {
  chords: Chord[];
  harmonyLine: HarmonyLine | null; // null for melody (no guide tones)
  beatsPerBar: number;
  tempo: number;
  // Audio elements for previously kept takes to play as monitoring
  monitorElements?: HTMLAudioElement[];
  onBeat?: (beatIndex: number) => void;
  onChordChange?: (chordIndex: number) => void;
};

// Schedules click track + optional guide tones for the full progression.
// Call stop() to tear everything down.
export function startRecordingPlayback(
  opts: RecordingPlaybackOpts,
): PlaybackSession {
  Tone.getTransport().stop();
  Tone.getTransport().cancel();
  Tone.getTransport().bpm.value = opts.tempo;

  const click = getClickSynth();
  const guide = opts.harmonyLine != null ? getGuideSynth() : null;

  const totalB = totalBeats(opts.chords);
  const secPerBeat = 60 / opts.tempo;

  // Schedule click on every beat
  for (let beat = 0; beat < totalB; beat++) {
    const offsetSec = beat * secPerBeat;
    Tone.getTransport().schedule((t) => {
      click.triggerAttackRelease(
        beat % opts.beatsPerBar === 0 ? "C2" : "C1",
        "16n",
        t,
      );
      opts.onBeat?.(beat);
    }, `+${offsetSec}`);
  }

  // Schedule guide tones: one sustained note per chord
  if (guide != null && opts.harmonyLine != null) {
    let beatOffset = 0;
    for (let i = 0; i < opts.chords.length; i++) {
      const chord = opts.chords[i]!;
      const midi: MidiNote | undefined = opts.harmonyLine[i];
      if (midi == null) {
        beatOffset += chord.beats;
        continue;
      }
      const noteName = midiToNoteName(midi);
      const startSec = beatOffset * secPerBeat;
      const durationSec = chord.beats * secPerBeat * 0.95; // slight gap
      const localI = i;
      Tone.getTransport().schedule((t) => {
        guide.triggerAttackRelease(noteName, durationSec, t);
        opts.onChordChange?.(localI);
      }, `+${startSec}`);
      beatOffset += chord.beats;
    }
  }

  // Start monitoring audio elements
  if (opts.monitorElements != null) {
    for (const el of opts.monitorElements) {
      el.currentTime = 0;
      el.volume = 0.5;
      el.play().catch(() => {});
    }
  }

  Tone.getTransport().start();

  return {
    stop() {
      Tone.getTransport().stop();
      Tone.getTransport().cancel();
      if (guide != null) {
        guide.releaseAll();
      }
      if (opts.monitorElements != null) {
        for (const el of opts.monitorElements) {
          el.pause();
          el.currentTime = 0;
        }
      }
    },
  };
}

// Total duration in seconds of one full pass of the progression
export function progressionDurationSec(
  chords: Chord[],
  tempo: number,
): number {
  return (totalBeats(chords) * 60) / tempo;
}

export function stopAllPlayback(): void {
  Tone.getTransport().stop();
  Tone.getTransport().cancel();
  guideSynth?.releaseAll();
}

// Play a single note immediately — used when the user taps a note chip.
export function playNotePreview(midi: MidiNote, durationSec = 1.2): void {
  const synth = getGuideSynth();
  synth.triggerAttackRelease(midiToNoteName(midi), durationSec);
}

// Play all 3 harmony lines simultaneously over the chord progression.
// Used by the setup screen "Preview Harmony" button.
export function playHarmonyPreview(
  chords: Chord[],
  harmonyLines: [HarmonyLine, HarmonyLine, HarmonyLine],
  beatsPerBar: number,
  tempo: number,
): PlaybackSession {
  Tone.getTransport().stop();
  Tone.getTransport().cancel();
  Tone.getTransport().bpm.value = tempo;

  const click = getClickSynth();
  const guide = getGuideSynth();
  const totalB = totalBeats(chords);
  const secPerBeat = 60 / tempo;

  // Click track
  for (let beat = 0; beat < totalB; beat++) {
    const offsetSec = beat * secPerBeat;
    Tone.getTransport().schedule((t) => {
      click.triggerAttackRelease(
        beat % beatsPerBar === 0 ? "C2" : "C1",
        "16n",
        t,
      );
    }, `+${offsetSec}`);
  }

  // All 3 harmony lines
  for (const line of harmonyLines) {
    let beatOffset = 0;
    for (let i = 0; i < chords.length; i++) {
      const chord = chords[i]!;
      const midi: MidiNote | undefined = line[i];
      if (midi != null) {
        const noteName = midiToNoteName(midi);
        const startSec = beatOffset * secPerBeat;
        const durationSec = chord.beats * secPerBeat * 0.95;
        Tone.getTransport().schedule((t) => {
          guide.triggerAttackRelease(noteName, durationSec, t);
        }, `+${startSec}`);
      }
      beatOffset += chord.beats;
    }
  }

  Tone.getTransport().start();

  return {
    stop() {
      Tone.getTransport().stop();
      Tone.getTransport().cancel();
      guide.releaseAll();
    },
  };
}
