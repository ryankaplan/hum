// Exports the 4-panel canvas + mixed audio as a single WebM file.

export type ExportOpts = {
  canvas: HTMLCanvasElement;
  audioContext: AudioContext;
  audioSources: MediaElementAudioSourceNode[];
  durationMs: number;
  onProgress?: (ratio: number) => void;
};

export async function exportWebM(opts: ExportOpts): Promise<Blob> {
  const { canvas, audioContext, audioSources, durationMs } = opts;

  // Mix all audio sources to a MediaStreamDestination
  const dest = audioContext.createMediaStreamDestination();
  for (const src of audioSources) {
    const gain = audioContext.createGain();
    gain.gain.value = 0.9;
    src.connect(gain);
    gain.connect(dest);
  }

  // Combine canvas video track + mixed audio track
  const canvasStream = canvas.captureStream(30);
  const videoTrack = canvasStream.getVideoTracks()[0];
  const audioTrack = dest.stream.getAudioTracks()[0];

  if (videoTrack == null) {
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

  // Cleanup
  for (const src of audioSources) {
    src.disconnect();
  }
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
