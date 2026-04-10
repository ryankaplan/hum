import {
  arrangementTicksToBeats,
  type ArrangementVoice,
} from "./arrangementScore";
import { getHarmonyLineNote, type Chord, type HarmonyLine, type MidiNote } from "./types";
import { totalBeats } from "./parse";
import type { MonitorPlayer } from "../audio/monitorPlayer";
import {
  playClick,
  playCountInCueTone,
  playGuideTone,
  stopAllSynths,
} from "../audio/synths";
import { AUDIO_SCHEDULE_LEAD_SEC } from "../transport/core";

function midiToFrequency(midi: MidiNote): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Polls ctx.currentTime at ~60 fps and fires onBeat for each beat time that
// has been passed. Returns a stop function to cancel the interval.
function createBeatTracker(
  ctx: AudioContext,
  beatTimes: number[],
  onBeat: (index: number) => void,
): { stop: () => void } {
  let lastFired = -1;
  const id = setInterval(() => {
    const now = ctx.currentTime;
    for (let i = lastFired + 1; i < beatTimes.length; i++) {
      const t = beatTimes[i];
      if (t != null && now >= t) {
        lastFired = i;
        onBeat(i);
      } else {
        break;
      }
    }
  }, 16);
  return { stop: () => clearInterval(id) };
}

// Module-level set of all active beat-tracker stop functions so that
// stopAllPlayback() can clear them without needing a session reference.
const activeTrackers = new Set<{ stop: () => void }>();

export type PlaybackSession = {
  // The AudioContext time at which beat 1 of the session starts.
  startTime: number;
  stop: () => void;
};

// ─── Count-in ────────────────────────────────────────────────────────────────

export type CountInResult = {
  // The AudioContext time at which beat 1 of the musical grid is scheduled.
  // Derived from a single ctx.currentTime read plus the count-in duration, so
  // it stays grid-continuous with the count-in clicks.
  gridStartTime: number;
  // The moment the user will hear beat 1, accounting for device output
  // latency. This is used for clip alignment, not for playback scheduling.
  alignmentStartTime: number;
  // Resolves when the count-in is complete and the caller should begin
  // setting up the MediaRecorder. Resolves ~half a beat before the musical
  // downbeat so playback can start on time even on slower devices.
  promise: Promise<void>;
};

// Schedule count-in clicks and return a CountInResult.
// onBeat fires via polling so the visual indicator stays in sync with the audio.
export function playCountIn(
  ctx: AudioContext,
  beatsPerBar: number,
  tempo: number,
  countInCueMidi?: MidiNote | null,
  onBeat?: (beat: number, totalBeats: number) => void,
  beatLevel = 1,
  cueLevel = 1,
  beatDestination?: AudioNode | null,
  cueDestination?: AudioNode | null,
): CountInResult {
  const secPerBeat = 60 / tempo;
  const startTime = ctx.currentTime + AUDIO_SCHEDULE_LEAD_SEC;
  const gridStartTime = startTime + beatsPerBar * secPerBeat;
  // Shift alignmentStartTime forward by the device's output latency so that
  // trimOffsetSec captures the full gap between MediaRecorder.start() and when
  // the user actually *hears* beat 1. On wired audio this is ~10ms; on
  // Bluetooth (e.g. AirPods) it can be 150–300ms. Without this, the recorded
  // audio is trimmed too early and the take lands behind the beat.
  const outputLatency = Number.isFinite(ctx.outputLatency)
    ? ctx.outputLatency
    : 0;
  const alignmentStartTime = gridStartTime + outputLatency;

  // Schedule all count-in clicks on the AudioContext clock
  for (let i = 0; i < beatsPerBar; i++) {
    playClick(
      ctx,
      startTime + i * secPerBeat,
      i === 0,
      beatLevel,
      beatDestination ?? ctx.destination,
    );
  }

  if (countInCueMidi != null) {
    playCountInCueTone(
      ctx,
      midiToFrequency(countInCueMidi),
      startTime,
      gridStartTime,
      cueLevel,
      cueDestination ?? ctx.destination,
    );
  }

  // Beat callbacks via polling
  if (onBeat != null) {
    const beatTimes = Array.from({ length: beatsPerBar }, (_, i) => startTime + i * secPerBeat);
    const tracker = createBeatTracker(ctx, beatTimes, (i) => onBeat(i, beatsPerBar));
    activeTrackers.add(tracker);
    // Auto-remove after count-in is fully over
    setTimeout(() => {
      tracker.stop();
      activeTrackers.delete(tracker);
    }, (gridStartTime - ctx.currentTime + 0.3) * 1000);
  }

  // Resolve half a beat before gridStartTime — enough lead time for the
  // caller to create a MediaRecorder and call start() before the beat lands.
  const resolveDelayMs =
    (gridStartTime - 0.5 * secPerBeat - ctx.currentTime) * 1000;
  const promise = new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, resolveDelayMs));
  });

  return { gridStartTime, alignmentStartTime, promise };
}

// ─── Recording playback ───────────────────────────────────────────────────────

export type RecordingPlaybackOpts = {
  ctx: AudioContext;
  chords: Chord[];
  harmonyLine: HarmonyLine | null; // null = melody (no guide tones)
  arrangementVoice?: ArrangementVoice | null;
  backingHarmonyLines?: HarmonyLine[];
  backingArrangementVoices?: ArrangementVoice[];
  beatsPerBar: number;
  tempo: number;
  // Pass the count-in's gridStartTime for a grid-continuous timeline.
  // If omitted, defaults to ctx.currentTime + AUDIO_SCHEDULE_LEAD_SEC.
  startTime?: number;
  monitorPlayer?: MonitorPlayer | null;
  beatLevel?: number;
  guideToneLevel?: number;
  beatDestination?: AudioNode | null;
  guideToneDestination?: AudioNode | null;
  onBeat?: (beatIndex: number) => void;
  onChordChange?: (chordIndex: number) => void;
};

// Schedules click track + optional guide tones for the full progression.
// All audio and monitor playback starts at the same AudioContext time.
export function startRecordingPlayback(
  opts: RecordingPlaybackOpts,
): PlaybackSession {
  const { ctx } = opts;
  const beatLevel = Math.max(0, Math.min(1, opts.beatLevel ?? 1));
  const guideToneLevel = Math.max(0, Math.min(1, opts.guideToneLevel ?? 1));
  const beatDestination = opts.beatDestination ?? ctx.destination;
  const guideToneDestination = opts.guideToneDestination ?? ctx.destination;
  const secPerBeat = 60 / opts.tempo;
  const startTime =
    opts.startTime ?? ctx.currentTime + AUDIO_SCHEDULE_LEAD_SEC;
  const totalB = totalBeats(opts.chords);

  // Schedule clicks
  const beatTimes: number[] = [];
  for (let beat = 0; beat < totalB; beat++) {
    const beatTime = startTime + beat * secPerBeat;
    beatTimes.push(beatTime);
    playClick(
      ctx,
      beatTime,
      beat % opts.beatsPerBar === 0,
      beatLevel,
      beatDestination,
    );
  }

  // Schedule guide tones
  const guideStops: Array<() => void> = [];
  if (opts.arrangementVoice != null) {
    scheduleArrangementVoice(
      guideStops,
      ctx,
      opts.arrangementVoice,
      secPerBeat,
      startTime,
      guideToneLevel,
      guideToneDestination,
    );
  } else if (opts.harmonyLine != null) {
    let beatOffset = 0;
    for (let i = 0; i < opts.chords.length; i++) {
      const chord = opts.chords[i]!;
      const midi = getHarmonyLineNote(opts.harmonyLine, i);
      if (midi != null) {
        const noteStartTime = startTime + beatOffset * secPerBeat;
        const durationSec = chord.beats * secPerBeat * 0.95;
        guideStops.push(
          playGuideTone(
            ctx,
            midiToFrequency(midi),
            noteStartTime,
            durationSec,
            guideToneLevel,
            guideToneDestination,
          ),
        );
      }
      beatOffset += chord.beats;
    }
  }

  if (opts.backingArrangementVoices != null) {
    for (const voice of opts.backingArrangementVoices) {
      scheduleArrangementVoice(
        guideStops,
        ctx,
        voice,
        secPerBeat,
        startTime,
        guideToneLevel,
        guideToneDestination,
      );
    }
  } else if (opts.backingHarmonyLines != null) {
    for (const line of opts.backingHarmonyLines) {
      let beatOffset = 0;
      for (let i = 0; i < opts.chords.length; i++) {
        const chord = opts.chords[i]!;
        const midi = getHarmonyLineNote(line, i);
        if (midi != null) {
          const noteStartTime = startTime + beatOffset * secPerBeat;
          const durationSec = chord.beats * secPerBeat * 0.95;
          guideStops.push(
            playGuideTone(
              ctx,
              midiToFrequency(midi),
              noteStartTime,
              durationSec,
              guideToneLevel,
              guideToneDestination,
            ),
          );
        }
        beatOffset += chord.beats;
      }
    }
  }

  // Beat tracker for UI callbacks
  let beatTracker: { stop: () => void } | null = null;
  if (opts.onBeat != null || opts.onChordChange != null) {
    const trackers: Array<{ stop: () => void }> = [];

    if (opts.onBeat != null) {
      const t = createBeatTracker(ctx, beatTimes, opts.onBeat);
      trackers.push(t);
      activeTrackers.add(t);
    }

    if (opts.onChordChange != null) {
      // Fire onChordChange at the first beat of each chord
      const chordChangeTimes: number[] = [];
      let beatOffset = 0;
      for (let i = 0; i < opts.chords.length; i++) {
        chordChangeTimes.push(startTime + beatOffset * secPerBeat);
        beatOffset += opts.chords[i]!.beats;
      }
      const cb = opts.onChordChange;
      const t = createBeatTracker(ctx, chordChangeTimes, (i) => cb(i));
      trackers.push(t);
      activeTrackers.add(t);
    }

    beatTracker = {
      stop() {
        for (const t of trackers) {
          t.stop();
          activeTrackers.delete(t);
        }
      },
    };
  }

  opts.monitorPlayer?.start(startTime);

  return {
    startTime,
    stop() {
      beatTracker?.stop();
      for (const stop of guideStops) {
        stop();
      }
      opts.monitorPlayer?.stop();
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Total duration in seconds of one full pass of the progression.
export function progressionDurationSec(
  chords: Chord[],
  tempo: number,
): number {
  return (totalBeats(chords) * 60) / tempo;
}

// Stop all active synth nodes and beat trackers.
export function stopAllPlayback(): void {
  stopAllSynths();
  for (const tracker of activeTrackers) {
    tracker.stop();
  }
  activeTrackers.clear();
}

// Play a single note immediately — used when the user taps a note chip.
export function playNotePreview(ctx: AudioContext, midi: MidiNote, durationSec = 1.2): void {
  playGuideTone(
    ctx,
    midiToFrequency(midi),
    ctx.currentTime + 0.01,
    durationSec,
  );
}

// ─── Harmony preview ─────────────────────────────────────────────────────────

// Play all available harmony lines simultaneously over the chord progression.
// Used by the setup screen "Preview Harmony" button.
export function playHarmonyPreview(
  ctx: AudioContext,
  chords: Chord[],
  beatsPerBar: number,
  tempo: number,
  options: {
    harmonyLines?: HarmonyLine[];
    arrangementVoices?: ArrangementVoice[];
  },
): PlaybackSession {
  const secPerBeat = 60 / tempo;
  const startTime = ctx.currentTime + AUDIO_SCHEDULE_LEAD_SEC;
  const totalB = totalBeats(chords);

  // Click track
  for (let beat = 0; beat < totalB; beat++) {
    playClick(ctx, startTime + beat * secPerBeat, beat % beatsPerBar === 0);
  }

  // All harmony lines
  const guideStops: Array<() => void> = [];
  if (options.arrangementVoices != null) {
    for (const voice of options.arrangementVoices) {
      scheduleArrangementVoice(
        guideStops,
        ctx,
        voice,
        secPerBeat,
        startTime,
        1,
        ctx.destination,
      );
    }
  } else {
    for (const line of options.harmonyLines ?? []) {
      let beatOffset = 0;
      for (let i = 0; i < chords.length; i++) {
        const chord = chords[i]!;
        const midi = getHarmonyLineNote(line, i);
        if (midi != null) {
          const noteStartTime = startTime + beatOffset * secPerBeat;
          const durationSec = chord.beats * secPerBeat * 0.95;
          guideStops.push(playGuideTone(ctx, midiToFrequency(midi), noteStartTime, durationSec));
        }
        beatOffset += chord.beats;
      }
    }
  }

  return {
    startTime,
    stop() {
      for (const stop of guideStops) {
        stop();
      }
    },
  };
}

function scheduleArrangementVoice(
  guideStops: Array<() => void>,
  ctx: AudioContext,
  voice: ArrangementVoice,
  secPerBeat: number,
  startTime: number,
  level: number,
  destination: AudioNode,
): void {
  for (const event of voice.events) {
    if (event.midi == null) continue;
    const noteStartTime =
      startTime + arrangementTicksToBeats(event.startTick) * secPerBeat;
    const durationSec =
      arrangementTicksToBeats(event.durationTicks) * secPerBeat * 0.95;
    guideStops.push(
      playGuideTone(
        ctx,
        midiToFrequency(event.midi),
        noteStartTime,
        durationSec,
        level,
        destination,
      ),
    );
  }
}
