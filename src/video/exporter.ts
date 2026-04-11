// Records the composed canvas plus mixed audio into a downloadable video file.
// Rendering cadence is controlled by the caller so export can run on a stable,
// deterministic clock instead of mirroring the live preview loop.

import type { Mixer } from "../audio/mixer";

export type ExportFormat = "mp4" | "webm";

export type ExportOpts = {
  canvas: HTMLCanvasElement;
  audioContext: AudioContext;
  mixer: Mixer;
  preferredFormat?: ExportFormat | null;
  videoBitsPerSecond?: number;
  frameRate?: number;
};

export type ExportResult = {
  blob: Blob;
  mimeType: string;
  format: ExportFormat;
};

export type ExportSession = {
  requestFrame: () => void;
  finish: () => Promise<ExportResult>;
  abort: () => void;
};

type ExportProfile = {
  mimeType: string;
  format: ExportFormat;
};

type CanvasCaptureTrack = MediaStreamTrack & {
  requestFrame?: () => void;
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

const DEFAULT_EXPORT_FRAME_RATE = 30;
const DEFAULT_VIDEO_BITS_PER_SECOND = 4_000_000;

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

export function startVideoExport(opts: ExportOpts): ExportSession {
  const { canvas, audioContext, mixer } = opts;
  const profile = getPreferredExportProfile(opts.preferredFormat);
  const frameRate = Math.max(1, opts.frameRate ?? DEFAULT_EXPORT_FRAME_RATE);
  const {
    stream: canvasStream,
    videoTrack,
  } = createCanvasCaptureStream(canvas, frameRate);
  const dest = audioContext.createMediaStreamDestination();

  mixer.connectForExport(dest);

  if (videoTrack == null) {
    mixer.disconnectExport(dest);
    dest.disconnect();
    throw new Error("Canvas produced no video track");
  }

  const audioTrack = dest.stream.getAudioTracks()[0];
  const tracks: MediaStreamTrack[] = [videoTrack];
  if (audioTrack != null) {
    tracks.push(audioTrack);
  }

  const combinedStream = new MediaStream(tracks);
  const recorder = new MediaRecorder(combinedStream, {
    mimeType: profile.mimeType,
    videoBitsPerSecond:
      opts.videoBitsPerSecond ?? DEFAULT_VIDEO_BITS_PER_SECOND,
  });

  const chunks: Blob[] = [];
  let cleanedUp = false;

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const result = new Promise<ExportResult>((resolve, reject) => {
    recorder.onstop = () => {
      cleanup();
      resolve({
        blob: new Blob(chunks, { type: profile.mimeType }),
        mimeType: profile.mimeType,
        format: profile.format,
      });
    };
    recorder.onerror = () => {
      cleanup();
      reject(new Error("MediaRecorder export failed"));
    };
  });

  recorder.start(Math.max(100, Math.round(1000 / frameRate)));

  return {
    requestFrame() {
      videoTrack.requestFrame?.();
    },
    async finish() {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
      return result;
    },
    abort() {
      if (recorder.state !== "inactive") {
        recorder.stop();
      } else {
        cleanup();
      }
    },
  };

  function cleanup(): void {
    if (cleanedUp) return;
    cleanedUp = true;
    mixer.disconnectExport(dest);
    dest.disconnect();
    for (const track of combinedStream.getTracks()) {
      track.stop();
    }
  }
}

function createCanvasCaptureStream(
  canvas: HTMLCanvasElement,
  frameRate: number,
): {
  stream: MediaStream;
  videoTrack: CanvasCaptureTrack | undefined;
} {
  const manualStream = canvas.captureStream(0);
  const manualTrack = manualStream.getVideoTracks()[0] as CanvasCaptureTrack | undefined;

  if (manualTrack?.requestFrame != null) {
    return {
      stream: manualStream,
      videoTrack: manualTrack,
    };
  }

  for (const track of manualStream.getTracks()) {
    track.stop();
  }

  const fallbackStream = canvas.captureStream(frameRate);
  return {
    stream: fallbackStream,
    videoTrack: fallbackStream.getVideoTracks()[0] as CanvasCaptureTrack | undefined,
  };
}
