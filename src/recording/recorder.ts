import type { Chord } from "../music/types";
import type { HarmonyLine } from "../music/types";
import {
  playCountIn,
  progressionDurationSec,
  startRecordingPlayback,
} from "../music/playback";
import type { PlaybackSession } from "../music/playback";
import type { MonitorPlayer } from "../audio/monitorPlayer";
import * as Tone from "tone";

export type RecordingResult = {
  blob: Blob;
  url: string;
  // Seconds of leading silence before beat-1 of the recording. Callers use
  // this as the `trimOffsetSec` for the track so that subsequent takes can
  // align to it via AudioBufferSourceNode.start(when, trimOffsetSec).
  trimOffsetSec: number;
};

export type RecordingCallbacks = {
  onCountInBeat?: (beat: number, totalBeats: number) => void;
  onRecordingStart?: () => void;
  onBeat?: (beat: number) => void;
  onChordChange?: (chordIndex: number) => void;
};

export type RecordingOpts = {
  stream: MediaStream;
  chords: Chord[];
  // null for melody (no guide tones during recording)
  harmonyLine: HarmonyLine | null;
  beatsPerBar: number;
  tempo: number;
  monitorPlayer?: MonitorPlayer | null;
  callbacks?: RecordingCallbacks;
};

// Records one take. Returns a promise that resolves with the recorded Blob
// after the count-in + full chord progression has played.
export async function recordTake(opts: RecordingOpts): Promise<RecordingResult> {
  const {
    stream,
    chords,
    harmonyLine,
    beatsPerBar,
    tempo,
    monitorPlayer,
    callbacks,
  } = opts;

  // 1. Count-in
  // Pass onCountInBeat directly into playCountIn so it fires from the Tone.js
  // scheduler at the same moment each click is scheduled. This keeps the visual
  // beat indicator in sync with the audio instead of using a drifting setInterval.
  await playCountIn(beatsPerBar, tempo, callbacks?.onCountInBeat);

  // 2. Set up MediaRecorder (but don't start it yet)
  const mimeType = getSupportedMimeType();
  const mediaRecorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 2_500_000,
  });

  const chunks: Blob[] = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  const recordingDone = new Promise<Omit<RecordingResult, "trimOffsetSec">>((resolve) => {
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      resolve({ blob, url });
    };
  });

  // 3. Start the MediaRecorder and note the AudioContext time at that instant.
  const ctx = Tone.getContext().rawContext as AudioContext;
  mediaRecorder.start(100); // collect data every 100ms
  const recorderStartCtxTime = ctx.currentTime;
  callbacks?.onRecordingStart?.();

  // 4. Start playback (guide tones + click + monitoring).
  //    startRecordingPlayback reads ctx.currentTime internally and computes
  //    startTime = ctx.currentTime + 0.1 at that point. Because JS execution
  //    has advanced since recorderStartCtxTime was captured, the real offset
  //    is slightly more than 0.1 s. We use the actual startTime returned by
  //    startRecordingPlayback so the trim offset is exact.
  const playback: PlaybackSession = startRecordingPlayback({
    chords,
    harmonyLine,
    beatsPerBar,
    tempo,
    monitorPlayer,
    onBeat: callbacks?.onBeat,
    onChordChange: callbacks?.onChordChange,
  });

  const trimOffsetSec = playback.startTime - recorderStartCtxTime;

  // 5. Auto-stop after the full progression + a small buffer
  const durationMs =
    progressionDurationSec(chords, tempo) * 1000 + 600;

  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));

  playback.stop();
  mediaRecorder.stop();

  const { blob, url } = await recordingDone;
  return { blob, url, trimOffsetSec };
}

function getSupportedMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return "video/webm";
}
