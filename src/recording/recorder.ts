import type { Chord } from "../music/types";
import type { HarmonyLine } from "../music/types";
import {
  playCountIn,
  progressionDurationSec,
  startRecordingPlayback,
} from "../music/playback";
import type { PlaybackSession } from "../music/playback";
import type { MonitorPlayer } from "../audio/monitorPlayer";

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
  ctx: AudioContext;
  stream: MediaStream;
  chords: Chord[];
  // null for melody (no guide tones during recording)
  harmonyLine: HarmonyLine | null;
  beatsPerBar: number;
  tempo: number;
  latencyCorrectionSec?: number;
  monitorPlayer?: MonitorPlayer | null;
  callbacks?: RecordingCallbacks;
};

// Records one take. Returns a promise that resolves with the recorded Blob
// after the count-in + full chord progression has played.
export async function recordTake(opts: RecordingOpts): Promise<RecordingResult> {
  const {
    ctx,
    stream,
    chords,
    harmonyLine,
    beatsPerBar,
    tempo,
    latencyCorrectionSec = 0,
    monitorPlayer,
    callbacks,
  } = opts;

  // 1. Count-in
  // playCountIn schedules all clicks on the AudioContext clock and returns
  // recordingStartTime — the exact beat-grid-aligned time where beat 1 falls.
  // The promise resolves ~half a beat before that time, giving us ample lead
  // time to start the MediaRecorder without any setTimeout-based handoff.
  const { promise: countInPromise, recordingStartTime } = playCountIn(
    ctx,
    beatsPerBar,
    tempo,
    callbacks?.onCountInBeat,
  );

  await countInPromise;

  // 2. Set up MediaRecorder
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
  //    trimOffsetSec is the gap between when we started recording and when
  //    beat 1 of the recording falls (recordingStartTime). This is exact
  //    because both values come from the same AudioContext clock.
  mediaRecorder.start(100);
  const recorderStartCtxTime = ctx.currentTime;
  callbacks?.onRecordingStart?.();
  const baseTrimOffsetSec = recordingStartTime - recorderStartCtxTime;
  const trimOffsetSec = baseTrimOffsetSec + latencyCorrectionSec;

  // 4. Start playback passing the count-in's grid-aligned recordingStartTime.
  //    This means the recording transport is continuous with the count-in —
  //    no transport teardown/restart gap that would cause half-beat drift.
  const playback: PlaybackSession = startRecordingPlayback({
    ctx,
    chords,
    harmonyLine,
    beatsPerBar,
    tempo,
    startTime: recordingStartTime,
    monitorPlayer,
    onBeat: callbacks?.onBeat,
    onChordChange: callbacks?.onChordChange,
  });

  // 5. Auto-stop after the full progression + a small buffer
  const durationMs = progressionDurationSec(chords, tempo) * 1000 + 600;

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
