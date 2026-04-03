// Exports the 4-panel canvas + mixed audio as a single WebM file.
// Audio mixing (per-track gain, reverb) is owned by the Mixer; the exporter
// just connects the mixer's master output to a MediaStreamDestination for the
// duration of the recording pass.

import type { Mixer } from "../audio/mixer";

export type ExportOpts = {
  canvas: HTMLCanvasElement;
  audioContext: AudioContext;
  mixer: Mixer;
  durationMs: number;
  onProgress?: (ratio: number) => void;
};

export async function exportWebM(opts: ExportOpts): Promise<Blob> {
  const { canvas, audioContext, mixer, durationMs } = opts;

  const dest = audioContext.createMediaStreamDestination();
  mixer.connectForExport(dest);

  const canvasStream = canvas.captureStream(30);
  const videoTrack = canvasStream.getVideoTracks()[0];
  const audioTrack = dest.stream.getAudioTracks()[0];

  if (videoTrack == null) {
    mixer.disconnectExport(dest);
    throw new Error("Canvas produced no video track");
  }

  const tracks: MediaStreamTrack[] = [videoTrack];
  if (audioTrack != null) {
    tracks.push(audioTrack);
  }

  const combinedStream = new MediaStream(tracks);

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 4_000_000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType }));
    };
  });

  recorder.start(100);

  // Wait for the full duration + small buffer
  const startMs = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const elapsed = performance.now() - startMs;
      opts.onProgress?.(Math.min(elapsed / durationMs, 1));
      if (elapsed >= durationMs + 500) {
        resolve();
      } else {
        setTimeout(tick, 200);
      }
    };
    tick();
  });

  recorder.stop();

  mixer.disconnectExport(dest);
  dest.disconnect();
  for (const track of combinedStream.getTracks()) {
    track.stop();
  }

  return done;
}

function pickMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "video/webm";
}
