import {
  MP4,
  QTFF,
  WEBM,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type WrappedCanvas,
} from "mediabunny";
import {
  COMPOSITOR_CANVAS_HEIGHT,
  COMPOSITOR_CANVAS_WIDTH,
  drawCompositeGridFrame,
} from "./compositor";
import { renderReviewAudioBuffer } from "../audio/offlineRenderer";
import type { TrackClip } from "../state/model";

export type ExportFormat = "mp4" | "webm";

export type ExportOpts = {
  timelines: TrackClip[][];
  orderedTracks: Array<{ volume: number; muted: boolean }>;
  reverbWet: number;
  durationSec: number;
  preferredFormat?: ExportFormat | null;
  loadRecordingBlob: (recordingId: string) => Blob | null;
  loadRecordingAudioBuffer: (recordingId: string) => Promise<AudioBuffer>;
  onProgress?: (ratio: number, timelineSec: number) => void;
};

export type ExportResult = {
  blob: Blob;
  mimeType: string;
  format: ExportFormat;
};

type OfflineExportProfile = {
  format: ExportFormat;
  mimeType: string;
  videoCodec: "avc" | "vp9" | "vp8";
  audioCodec: "aac" | "opus";
};

type RecordingVideoResource = {
  input: Input;
  sink: CanvasSink;
};

type LaneClipRenderer = {
  startFrame: number;
  endFrameExclusive: number;
  segment: TrackClip;
  sink: CanvasSink;
  iterator: AsyncIterator<WrappedCanvas | null> | null;
};

type LaneRenderer = {
  clips: LaneClipRenderer[];
  currentClipIndex: number;
};

const EXPORT_FRAME_RATE = 30;
const EXPORT_VIDEO_BITRATE = QUALITY_HIGH;
const EXPORT_AUDIO_BITRATE = 192_000;
const RECORDING_INPUT_FORMATS = [MP4, QTFF, WEBM];

const OFFLINE_EXPORT_CANDIDATES: OfflineExportProfile[] = [
  {
    format: "mp4",
    mimeType: "video/mp4",
    videoCodec: "avc",
    audioCodec: "aac",
  },
  {
    format: "webm",
    mimeType: "video/webm",
    videoCodec: "vp9",
    audioCodec: "opus",
  },
  {
    format: "webm",
    mimeType: "video/webm",
    videoCodec: "vp8",
    audioCodec: "opus",
  },
];

export function getPreferredExportFormat(
  preferredFormat?: ExportFormat | null,
): ExportFormat {
  if (preferredFormat != null) return preferredFormat;
  if (
    typeof VideoEncoder !== "undefined" &&
    typeof AudioEncoder !== "undefined" &&
    typeof OfflineAudioContext !== "undefined"
  ) {
    return "mp4";
  }
  return "webm";
}

export async function exportVideo(opts: ExportOpts): Promise<ExportResult> {
  const renderCanvas = createExportCanvas();
  const videoResources = new Map<string, RecordingVideoResource>();

  try {
    opts.onProgress?.(0.02, 0);

    const renderedAudio = await renderReviewAudioBuffer({
      timelines: opts.timelines,
      orderedTracks: opts.orderedTracks,
      reverbWet: opts.reverbWet,
      durationSec: opts.durationSec,
      getBuffer: opts.loadRecordingAudioBuffer,
    });

    const profile = await selectOfflineExportProfile(
      opts.preferredFormat,
      renderedAudio.sampleRate,
      renderedAudio.numberOfChannels,
    );
    if (profile == null) {
      throw new Error("This browser cannot encode the exported video format.");
    }

    const laneRenderers = await createLaneRenderers({
      timelines: opts.timelines,
      frameRate: EXPORT_FRAME_RATE,
      durationSec: opts.durationSec,
      loadRecordingBlob: opts.loadRecordingBlob,
      videoResources,
    });

    const target = new BufferTarget();
    const output = new Output({
      format:
        profile.format === "mp4"
          ? new Mp4OutputFormat()
          : new WebMOutputFormat(),
      target,
    });

    const videoSource = new CanvasSource(renderCanvas, {
      codec: profile.videoCodec,
      bitrate: EXPORT_VIDEO_BITRATE,
      latencyMode: "quality",
    });
    const audioSource = new AudioBufferSource({
      codec: profile.audioCodec,
      bitrate: EXPORT_AUDIO_BITRATE,
    });

    output.addVideoTrack(videoSource, { frameRate: EXPORT_FRAME_RATE });
    output.addAudioTrack(audioSource);
    await output.start();

    const audioPromise = audioSource.add(renderedAudio);
    const frameCount = Math.max(1, Math.ceil(opts.durationSec * EXPORT_FRAME_RATE));
    const renderCtx = getCanvas2dContext(renderCanvas);

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      const timelineSec = frameIndex / EXPORT_FRAME_RATE;
      const frameDurationSec = Math.min(
        1 / EXPORT_FRAME_RATE,
        Math.max(0, opts.durationSec - timelineSec),
      );
      const sources = await Promise.all(
        laneRenderers.map((renderer) =>
          getLaneFrameSource(renderer, frameIndex),
        ),
      );

      drawCompositeGridFrame({
        ctx: renderCtx,
        sources,
        isSourceActive: (index) => sources[index] != null,
      });
      await videoSource.add(timelineSec, frameDurationSec);
      opts.onProgress?.((frameIndex + 1) / frameCount, Math.min(
        opts.durationSec,
        timelineSec + frameDurationSec,
      ));
    }

    await audioPromise;
    await output.finalize();

    const buffer = target.buffer;
    if (buffer == null) {
      throw new Error("Export output buffer was not created.");
    }

    return {
      blob: new Blob([buffer], { type: profile.mimeType }),
      mimeType: profile.mimeType,
      format: profile.format,
    };
  } finally {
    for (const resource of videoResources.values()) {
      resource.input.dispose();
    }
  }
}

async function selectOfflineExportProfile(
  preferredFormat: ExportFormat | null | undefined,
  sampleRate: number,
  numberOfChannels: number,
): Promise<OfflineExportProfile | null> {
  const candidates =
    preferredFormat == null
      ? OFFLINE_EXPORT_CANDIDATES
      : [
          ...OFFLINE_EXPORT_CANDIDATES.filter(
            (candidate) => candidate.format === preferredFormat,
          ),
          ...OFFLINE_EXPORT_CANDIDATES.filter(
            (candidate) => candidate.format !== preferredFormat,
          ),
        ];

  for (const candidate of candidates) {
    const [videoSupported, audioSupported] = await Promise.all([
      canEncodeVideo(candidate.videoCodec, {
        width: COMPOSITOR_CANVAS_WIDTH,
        height: COMPOSITOR_CANVAS_HEIGHT,
        bitrate: EXPORT_VIDEO_BITRATE,
      }),
      canEncodeAudio(candidate.audioCodec, {
        sampleRate,
        numberOfChannels,
        bitrate: EXPORT_AUDIO_BITRATE,
      }),
    ]);
    if (videoSupported && audioSupported) {
      return candidate;
    }
  }

  return null;
}

async function createLaneRenderers(input: {
  timelines: TrackClip[][];
  frameRate: number;
  durationSec: number;
  loadRecordingBlob: (recordingId: string) => Blob | null;
  videoResources: Map<string, RecordingVideoResource>;
}): Promise<LaneRenderer[]> {
  const { timelines, frameRate, durationSec, loadRecordingBlob, videoResources } =
    input;
  const laneRenderers: LaneRenderer[] = [];
  const frameCount = Math.max(1, Math.ceil(durationSec * frameRate));

  for (const track of timelines) {
    const clips: LaneClipRenderer[] = [];

    for (const segment of track) {
      const startFrame = Math.max(
        0,
        Math.ceil(segment.timelineStartSec * frameRate),
      );
      const endFrameExclusive = Math.min(
        frameCount,
        Math.ceil((segment.timelineStartSec + segment.durationSec) * frameRate),
      );
      if (endFrameExclusive <= startFrame) continue;

      const resource = await getRecordingVideoResource(
        segment.recordingId,
        loadRecordingBlob,
        videoResources,
      );
      clips.push({
        startFrame,
        endFrameExclusive,
        segment,
        sink: resource.sink,
        iterator: null,
      });
    }

    laneRenderers.push({
      clips,
      currentClipIndex: 0,
    });
  }

  return laneRenderers;
}

async function getRecordingVideoResource(
  recordingId: string,
  loadRecordingBlob: (recordingId: string) => Blob | null,
  cache: Map<string, RecordingVideoResource>,
): Promise<RecordingVideoResource> {
  const cached = cache.get(recordingId);
  if (cached != null) return cached;

  const blob = loadRecordingBlob(recordingId);
  if (blob == null) {
    throw new Error(`Missing video media for recording ${recordingId}.`);
  }

  const input = new Input({
    source: new BlobSource(blob),
    formats: RECORDING_INPUT_FORMATS,
  });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (videoTrack == null) {
    input.dispose();
    throw new Error(`Recording ${recordingId} has no decodable video track.`);
  }
  if (!(await videoTrack.canDecode())) {
    input.dispose();
    throw new Error(`Recording ${recordingId} cannot be decoded in this browser.`);
  }

  const resource = {
    input,
    sink: new CanvasSink(videoTrack),
  };
  cache.set(recordingId, resource);
  return resource;
}

function clipSourceTimes(
  segment: TrackClip,
  startFrame: number,
  endFrameExclusive: number,
  frameRate: number,
): Iterable<number> {
  return {
    *[Symbol.iterator]() {
      for (let frameIndex = startFrame; frameIndex < endFrameExclusive; frameIndex++) {
        const timelineSec = frameIndex / frameRate;
        yield segment.sourceStartSec + timelineSec - segment.timelineStartSec;
      }
    },
  };
}

async function getLaneFrameSource(
  renderer: LaneRenderer,
  frameIndex: number,
): Promise<CanvasImageSource | null> {
  while (renderer.currentClipIndex < renderer.clips.length) {
    const clip = renderer.clips[renderer.currentClipIndex];
    if (clip == null) return null;
    if (frameIndex >= clip.endFrameExclusive) {
      renderer.currentClipIndex += 1;
      continue;
    }
    if (frameIndex < clip.startFrame) {
      return null;
    }

    if (clip.iterator == null) {
      clip.iterator = clip.sink
        .canvasesAtTimestamps(
          clipSourceTimes(
            clip.segment,
            clip.startFrame,
            clip.endFrameExclusive,
            EXPORT_FRAME_RATE,
          ),
        )
        [Symbol.asyncIterator]();
    }

    const next = await clip.iterator.next();
    return next.value?.canvas ?? null;
  }

  return null;
}

function createExportCanvas(): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(
      COMPOSITOR_CANVAS_WIDTH,
      COMPOSITOR_CANVAS_HEIGHT,
    );
  }

  const canvas = document.createElement("canvas");
  canvas.width = COMPOSITOR_CANVAS_WIDTH;
  canvas.height = COMPOSITOR_CANVAS_HEIGHT;
  return canvas;
}

function getCanvas2dContext(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (ctx == null) {
    throw new Error("Could not create export canvas context.");
  }
  return ctx;
}
