import type { Chord } from "../music/types";
import type { HarmonyLine } from "../music/types";
import {
  playCountIn,
  progressionDurationSec,
  startRecordingPlayback,
} from "../music/playback";
import type { PlaybackSession } from "../music/playback";

export type RecordingResult = {
  blob: Blob;
  url: string;
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
  monitorElements?: HTMLAudioElement[];
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
    monitorElements,
    callbacks,
  } = opts;

  // 1. Count-in
  const countTotal = beatsPerBar;
  let countBeat = 0;

  // Override onBeat during count-in to emit count-in beats
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

  // 2. Start MediaRecorder
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

  const recordingDone = new Promise<RecordingResult>((resolve) => {
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      resolve({ blob, url });
    };
  });

  mediaRecorder.start(100); // collect data every 100ms
  callbacks?.onRecordingStart?.();

  // 3. Start playback (guide tones + click + monitoring)
  const playback: PlaybackSession = startRecordingPlayback({
    chords,
    harmonyLine,
    beatsPerBar,
    tempo,
    monitorElements,
    onBeat: callbacks?.onBeat,
    onChordChange: callbacks?.onChordChange,
  });

  // 4. Auto-stop after the full progression + a small buffer
  const durationMs =
    progressionDurationSec(chords, tempo) * 1000 + 600;

  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));

  playback.stop();
  mediaRecorder.stop();

  return recordingDone;
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
