import type { Chord, MidiNote } from "../music/types";
import type { HarmonyLine } from "../music/types";
import {
  playCountIn,
  progressionDurationSec,
  startRecordingPlayback,
  stopAllPlayback,
} from "../music/playback";
import type { PlaybackSession } from "../music/playback";
import type { MonitorPlayer } from "../audio/monitorPlayer";

export type RecordingResult = {
  blob: Blob;
  url: string;
  // Offset between the raw recording source and the musical timeline. Positive
  // values mean the clip should skip into the source at timeline zero; negative
  // values mean the committed clip should start later on the timeline.
  alignmentOffsetSec: number;
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
  countInCueMidi?: MidiNote | null;
  beatsPerBar: number;
  tempo: number;
  latencyCorrectionSec?: number;
  monitorPlayer?: MonitorPlayer | null;
  callbacks?: RecordingCallbacks;
};

export type RecordingSession = {
  promise: Promise<RecordingResult>;
  stop: () => void;
};

export class RecordingCancelledError extends Error {
  constructor() {
    super("Recording cancelled");
    this.name = "RecordingCancelledError";
  }
}

export function isRecordingCancelledError(
  err: unknown,
): err is RecordingCancelledError {
  return err instanceof RecordingCancelledError;
}

// Records one take. Returns a promise that resolves with the recorded Blob
// after the count-in + full chord progression has played.
export async function recordTake(opts: RecordingOpts): Promise<RecordingResult> {
  return startRecordTake(opts).promise;
}

export function startRecordTake(opts: RecordingOpts): RecordingSession {
  const {
    ctx,
    stream,
    chords,
    harmonyLine,
    countInCueMidi,
    beatsPerBar,
    tempo,
    latencyCorrectionSec = 0,
    monitorPlayer,
    callbacks,
  } = opts;

  let cancelled = false;
  let mediaRecorder: MediaRecorder | null = null;
  let playback: PlaybackSession | null = null;
  let requestStop: (() => void) | null = null;
  const stopSignal = new Promise<void>((resolve) => {
    requestStop = resolve;
  });

  const stop = () => {
    if (cancelled) return;
    cancelled = true;
    stopAllPlayback();
    playback?.stop();
    playback = null;
    if (mediaRecorder != null && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    requestStop?.();
  };

  const promise = (async () => {
    monitorPlayer?.stop();

    // 1. Count-in
    const { promise: countInPromise, recordingStartTime } = playCountIn(
      ctx,
      beatsPerBar,
      tempo,
      countInCueMidi,
      callbacks?.onCountInBeat,
    );

    await Promise.race([countInPromise, stopSignal]);
    if (cancelled) {
      throw new RecordingCancelledError();
    }

    // 2. Set up MediaRecorder
    const mimeType = getSupportedMimeType();
    mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 2_500_000,
    });
    const recorder = mediaRecorder;

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    const recordingDone = new Promise<
      Omit<RecordingResult, "alignmentOffsetSec">
    >(
      (resolve) => {
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType });
          const url = URL.createObjectURL(blob);
          resolve({ blob, url });
        };
      },
    );

    // 3. Start recorder and compute trim offset.
    recorder.start(100);
    const recorderStartCtxTime = ctx.currentTime;
    callbacks?.onRecordingStart?.();
    const baseTrimOffsetSec = recordingStartTime - recorderStartCtxTime;
    const alignmentOffsetSec = baseTrimOffsetSec + latencyCorrectionSec;

    // 4. Start playback aligned with count-in.
    playback = startRecordingPlayback({
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

    // 5. Stop on duration or manual cancel.
    const durationMs = progressionDurationSec(chords, tempo) * 1000 + 600;
    await Promise.race([waitMs(durationMs), stopSignal]);

    playback.stop();
    playback = null;
    if (recorder.state !== "inactive") {
      recorder.stop();
    }

    const { blob, url } = await recordingDone;
    if (cancelled) {
      URL.revokeObjectURL(url);
      throw new RecordingCancelledError();
    }
    return { blob, url, alignmentOffsetSec };
  })().finally(() => {
    playback?.stop();
    playback = null;
    mediaRecorder = null;
  });

  return { promise, stop };
}

function getSupportedMimeType(): string {
  const candidates = [
    // Prefer seek-friendly encodes for timeline editing in FinalReview.
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return "video/webm";
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
