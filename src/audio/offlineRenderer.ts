import {
  buildPlannedAudioClips,
  scheduleClipVolumeGain,
} from "./reviewAudioPlan";
import { createReviewMixerGraph } from "./mixer";
import type { TrackClip } from "../state/model";

export type OfflineTrackMixState = {
  volume: number;
  muted: boolean;
};

type RenderReviewAudioInput = {
  timelines: TrackClip[][];
  orderedTracks: OfflineTrackMixState[];
  reverbWet: number;
  durationSec: number;
  getBuffer: (recordingId: string) => Promise<AudioBuffer>;
};

const DEFAULT_SAMPLE_RATE = 48_000;

export async function renderReviewAudioBuffer(
  input: RenderReviewAudioInput,
): Promise<AudioBuffer> {
  const { timelines, orderedTracks, reverbWet, durationSec, getBuffer } = input;
  const sampleRate =
    (await resolveRenderSampleRate(timelines, getBuffer)) ?? DEFAULT_SAMPLE_RATE;
  const frameCount = Math.max(1, Math.ceil(durationSec * sampleRate));
  const ctx = new OfflineAudioContext(2, frameCount, sampleRate);
  const mixer = createReviewMixerGraph(ctx, timelines.length);

  try {
    for (let laneIndex = 0; laneIndex < orderedTracks.length; laneIndex++) {
      const track = orderedTracks[laneIndex];
      mixer.setTrackVolume(laneIndex, track?.volume ?? 1);
      mixer.setTrackMuted(laneIndex, track?.muted ?? false);
    }
    mixer.setReverbWet(reverbWet);

    const bufferCache = new Map<string, AudioBuffer>();
    const clips = await buildPlannedAudioClipsAsync(
      timelines,
      durationSec,
      async (recordingId) => {
        const cached = bufferCache.get(recordingId);
        if (cached != null) return cached;
        const next = await getBuffer(recordingId);
        bufferCache.set(recordingId, next);
        return next;
      },
    );

    for (const clip of clips) {
      const source = ctx.createBufferSource();
      const clipGain = ctx.createGain();
      source.buffer = clip.buffer;
      scheduleClipVolumeGain({
        gain: clipGain.gain,
        volumeEnvelope: clip.volumeEnvelope,
        segmentDurationSec: clip.segmentDurationSec,
        segmentStartSec: clip.segmentStartSec,
        playDurationSec: clip.durationSec,
        startAtSec: clip.startOffsetSec,
      });
      source.connect(clipGain);
      mixer.connectSource(clip.laneIndex, clipGain);
      source.start(clip.startOffsetSec, clip.sourceOffsetSec, clip.durationSec);
    }

    return await ctx.startRendering();
  } finally {
    mixer.dispose();
  }
}

async function resolveRenderSampleRate(
  timelines: TrackClip[][],
  getBuffer: (recordingId: string) => Promise<AudioBuffer>,
): Promise<number | null> {
  for (const track of timelines) {
    for (const clip of track) {
      const buffer = await getBuffer(clip.recordingId);
      if (Number.isFinite(buffer.sampleRate) && buffer.sampleRate > 0) {
        return buffer.sampleRate;
      }
    }
  }

  return null;
}

async function buildPlannedAudioClipsAsync(
  timelines: TrackClip[][],
  endTimelineSec: number,
  getBuffer: (recordingId: string) => Promise<AudioBuffer>,
) {
  const buffers = new Map<string, AudioBuffer>();

  for (const track of timelines) {
    for (const clip of track) {
      if (buffers.has(clip.recordingId)) continue;
      buffers.set(clip.recordingId, await getBuffer(clip.recordingId));
    }
  }

  return buildPlannedAudioClips({
    timelines,
    startTimelineSec: 0,
    endTimelineSec,
    getBuffer: (recordingId) => buffers.get(recordingId) ?? null,
  });
}
