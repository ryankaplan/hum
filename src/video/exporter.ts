// Exports the 4-panel canvas + mixed audio as a single video file.
// Audio mixing (per-track gain, reverb) is owned by the Mixer; the exporter
// just connects the mixer's master output to a MediaStreamDestination for the
// duration of the recording pass.

import type { Mixer } from "../audio/mixer";

export type ExportFormat = "mp4" | "webm";

export type ExportOpts = {
  canvas: HTMLCanvasElement;
  audioContext: AudioContext;
  mixer: Mixer;
  durationMs: number;
  onProgress?: (ratio: number) => void;
};

export type ExportResult = {
  blob: Blob;
  mimeType: string;
  format: ExportFormat;
};

type ExportProfile = {
  mimeType: string;
  format: ExportFormat;
};

const EXPORT_MIME_CANDIDATES: ExportProfile[] = [
  { mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", format: "mp4" },
  { mimeType: "video/mp4;codecs=avc1,mp4a", format: "mp4" },
  { mimeType: "video/mp4", format: "mp4" },
  { mimeType: "video/webm;codecs=vp9,opus", format: "webm" },
  { mimeType: "video/webm;codecs=vp8,opus", format: "webm" },
  { mimeType: "video/webm", format: "webm" },
];

const FALLBACK_EXPORT_PROFILE: ExportProfile = {
  mimeType: "video/webm",
  format: "webm",
};

export function getPreferredExportProfile(
  preferredFormat?: ExportFormat | null,
): ExportProfile {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof MediaRecorder.isTypeSupported !== "function"
  ) {
    return FALLBACK_EXPORT_PROFILE;
  }
  const candidates =
    preferredFormat == null
      ? EXPORT_MIME_CANDIDATES
      : [
          ...EXPORT_MIME_CANDIDATES.filter(
            (candidate) => candidate.format === preferredFormat,
          ),
          ...EXPORT_MIME_CANDIDATES.filter(
            (candidate) => candidate.format !== preferredFormat,
          ),
        ];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate.mimeType)) {
      return candidate;
    }
  }
  return FALLBACK_EXPORT_PROFILE;
}

export function getPreferredExportFormat(
  preferredFormat?: ExportFormat | null,
): ExportFormat {
  return getPreferredExportProfile(preferredFormat).format;
}

export async function exportVideo(opts: ExportOpts): Promise<ExportResult> {
  const { canvas, audioContext, mixer, durationMs } = opts;
  const profile = getPreferredExportProfile();
  const { mimeType, format } = profile;

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
  try {
    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: 4_000_000,
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const done = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        resolve(new Blob(chunks, { type: mimeType }));
      };
      recorder.onerror = () => {
        reject(new Error("MediaRecorder export failed"));
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

    if (recorder.state !== "inactive") {
      recorder.stop();
    }

    const blob = await done;
    return { blob, mimeType, format };
  } finally {
    mixer.disconnectExport(dest);
    dest.disconnect();
    for (const track of combinedStream.getTracks()) {
      track.stop();
    }
  }
}
