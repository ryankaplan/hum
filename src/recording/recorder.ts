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
  const countTotal = beatsPerBar;
  let countBeat = 0;

  const countInPromise = playCountIn(beatsPerBar, tempo);

  // Emit count-in beat events by polling
  const countInterval = setInterval(() => {
    callbacks?.onCountInBeat?.(countBeat, countTotal);
    countBeat++;
    if (countBeat >= countTotal) {
      clearInterval(countInterval);
    }
  }, (60 / tempo) * 1000);

  await countInPromise;
  clearInterval(countInterval);

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

  // 3. Start the MediaRecorder and immediately note the AudioContext time.
  //    startRecordingPlayback will schedule everything to begin at
  //    ctx.currentTime + 0.1, so we compute the difference to get the
  //    exact trim offset.
  const ctx = Tone.getContext().rawContext as AudioContext;
  mediaRecorder.start(100); // collect data every 100ms
  const recorderStartCtxTime = ctx.currentTime;
  callbacks?.onRecordingStart?.();

  // 4. Start playback (guide tones + click + monitoring).
  //    startRecordingPlayback computes startTime = ctx.currentTime + 0.1
  //    and passes it to both the MonitorPlayer and the Tone transport, so
  //    all audio begins at the same sample-accurate AudioContext time.
  const playback: PlaybackSession = startRecordingPlayback({
    chords,
    harmonyLine,
    beatsPerBar,
    tempo,
    monitorPlayer,
    onBeat: callbacks?.onBeat,
    onChordChange: callbacks?.onChordChange,
  });

  // The transport start time is ctx.currentTime + 0.1 (matching the value
  // computed inside startRecordingPlayback). We re-derive it here using the
  // same formula rather than plumbing it back out.
  const transportStartCtxTime = recorderStartCtxTime + 0.1;
  const trimOffsetSec = transportStartCtxTime - recorderStartCtxTime;

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
