import type { ClipVolumeEnvelope } from "../state/clipAutomation";
import { evaluateClipVolumeAtTime } from "../state/clipAutomation";
import type { TrackClip } from "../state/model";

export type PlannedAudioClip = {
  laneIndex: number;
  buffer: AudioBuffer;
  startOffsetSec: number;
  sourceOffsetSec: number;
  durationSec: number;
  segmentDurationSec: number;
  segmentStartSec: number;
  volumeEnvelope: ClipVolumeEnvelope;
};

type BuildPlannedAudioClipsInput = {
  timelines: TrackClip[][];
  startTimelineSec: number;
  endTimelineSec: number;
  getBuffer: (recordingId: string) => AudioBuffer | null;
};

export function buildPlannedAudioClips(
  input: BuildPlannedAudioClipsInput,
): PlannedAudioClip[] {
  const { timelines, startTimelineSec, endTimelineSec, getBuffer } = input;
  const clips: PlannedAudioClip[] = [];

  for (let laneIndex = 0; laneIndex < timelines.length; laneIndex++) {
    const track = timelines[laneIndex] ?? [];

    for (const segment of track) {
      const buffer = getBuffer(segment.recordingId);
      if (buffer == null) continue;

      const segStart = segment.timelineStartSec;
      const segEnd = segment.timelineStartSec + segment.durationSec;
      if (segEnd <= startTimelineSec || segStart >= endTimelineSec) continue;

      const playFrom = Math.max(startTimelineSec, segStart);
      const playTo = Math.min(endTimelineSec, segEnd);
      const playDuration = playTo - playFrom;
      if (playDuration <= 0) continue;

      const sourceOffsetSec = segment.sourceStartSec + (playFrom - segStart);
      if (sourceOffsetSec >= buffer.duration) continue;

      const durationSec = Math.min(
        playDuration,
        buffer.duration - sourceOffsetSec,
      );
      if (durationSec <= 0) continue;

      clips.push({
        laneIndex,
        buffer,
        startOffsetSec: playFrom - startTimelineSec,
        sourceOffsetSec,
        durationSec,
        segmentDurationSec: segment.durationSec,
        segmentStartSec: Math.max(0, playFrom - segStart),
        volumeEnvelope: segment.volumeEnvelope,
      });
    }
  }

  return clips;
}

export type ScheduleClipVolumeGainInput = {
  gain: AudioParam;
  volumeEnvelope: ClipVolumeEnvelope;
  segmentDurationSec: number;
  segmentStartSec: number;
  playDurationSec: number;
  startAtSec: number;
};

export function scheduleClipVolumeGain({
  gain,
  volumeEnvelope,
  segmentDurationSec,
  segmentStartSec,
  playDurationSec,
  startAtSec,
}: ScheduleClipVolumeGainInput): void {
  if (playDurationSec <= 0) return;

  const localStartSec = clamp(segmentStartSec, 0, segmentDurationSec);
  const localEndSec = clamp(
    segmentStartSec + playDurationSec,
    0,
    segmentDurationSec,
  );

  const startGain = evaluateClipVolumeAtTime(
    volumeEnvelope,
    localStartSec,
    segmentDurationSec,
  );
  gain.setValueAtTime(startGain, startAtSec);

  for (const point of volumeEnvelope.points) {
    if (point.timeSec <= localStartSec || point.timeSec >= localEndSec) {
      continue;
    }
    gain.linearRampToValueAtTime(
      point.gainMultiplier,
      startAtSec + (point.timeSec - localStartSec),
    );
  }

  const endGain = evaluateClipVolumeAtTime(
    volumeEnvelope,
    localEndSec,
    segmentDurationSec,
  );
  gain.linearRampToValueAtTime(endGain, startAtSec + playDurationSec);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
