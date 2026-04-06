import { Observable } from "../observable";
import type { Mixer } from "../audio/mixer";
import {
  type ClipVolumeEnvelope,
  applyClipVolumeBrush,
  createDefaultClipVolumeEnvelope,
  splitClipVolumeEnvelopeAtTime,
} from "./clipAutomation";

export type TrackClip = {
  // Generated locally by the document model and used only as timeline clip identity.
  id: string;
  laneIndex: number;

  // Foreign key into `takesById` for the kept take backing this clip.
  takeId: string;

  // Clip start in the edited timeline.
  timelineStartSec: number;

  // Start offset into the underlying kept take media.
  sourceStartSec: number;

  durationSec: number;
  volumeEnvelope: ClipVolumeEnvelope;
};

export type TrackLane = {
  laneIndex: number;
  clips: TrackClip[];
};

export type TracksEditorSelection = {
  laneIndex: number | null;
  clipId: string | null;
};

export type TracksMixState = {
  volumes: number[];
  muted: boolean[];
  reverbWet: number;
};

export type TakeRecord = {
  // Stable ID for one kept take in a lane.
  id: string;
  laneIndex: number;

  // Original recorded media for the kept take. In this app the blob is the
  // recorded video file, and its audio track is later decoded for playback/editing.
  blob: Blob;

  // Object URL created from `blob` so the recorded video can be loaded into
  // <video> elements for preview, compositing, and review.
  url: string;

  // Seconds to skip from the beginning of the recorded media before the usable
  // take starts. This trims leading latency/silence so timeline playback aligns.
  trimOffsetSec: number;
};

export type ApplyClipVolumeBrushInput = {
  laneIndex: number;
  clipId: string;
  centerSec: number;
  deltaGainMultiplier: number;
  radiusSec: number;
};

export type TracksDocumentState = {
  takesById: Record<string, TakeRecord>;
  laneTakeIds: (string | null)[];
  lanes: TrackLane[];
  mix: TracksMixState;
};

export type TracksEditorState = {
  selection: TracksEditorSelection;
  playheadSec: number;
  snapToBeat: boolean;
};

type TracksDocumentModelOptions = {
  totalParts: number;
  getMixer: () => Mixer | null;
};

export function createEmptyTracksMixState(totalParts: number): TracksMixState {
  return {
    volumes: Array.from({ length: totalParts }, () => 1),
    muted: Array.from({ length: totalParts }, () => false),
    reverbWet: 0.15,
  };
}

export function createEmptyTracksDocument(
  totalParts: number,
): TracksDocumentState {
  return {
    takesById: {},
    laneTakeIds: Array.from({ length: totalParts }, () => null),
    lanes: Array.from({ length: totalParts }, (_, laneIndex) => ({
      laneIndex,
      clips: [],
    })),
    mix: createEmptyTracksMixState(totalParts),
  };
}

export function createEmptyTracksEditorState(): TracksEditorState {
  return {
    selection: { laneIndex: null, clipId: null },
    playheadSec: 0,
    snapToBeat: false,
  };
}

export class TracksDocumentModel {
  private nextClipId = 0;

  readonly document: Observable<TracksDocumentState>;

  constructor(private options: TracksDocumentModelOptions) {
    this.document = new Observable<TracksDocumentState>(
      createEmptyTracksDocument(options.totalParts),
    );
  }

  stageKeptTake(input: {
    laneIndex: number;
    take: TakeRecord;
    sourceStartSec: number;
    durationSec: number;
  }): { replacedTake: TakeRecord | null; clipId: string | null } {
    const { laneIndex, take, sourceStartSec, durationSec } = input;
    const clipId = this.makeClipId();
    let replacedTake: TakeRecord | null = null;

    this.setDocument((current) => {
      if (laneIndex < 0 || laneIndex >= current.lanes.length) return current;

      const previousTakeId = current.laneTakeIds[laneIndex];
      if (previousTakeId != null && previousTakeId !== take.id) {
        replacedTake = current.takesById[previousTakeId] ?? null;
      }

      const nextLaneTakeIds = [...current.laneTakeIds];
      nextLaneTakeIds[laneIndex] = take.id;

      const nextTakesById: Record<string, TakeRecord> = {
        ...current.takesById,
        [take.id]: take,
      };

      if (previousTakeId != null && previousTakeId !== take.id) {
        delete nextTakesById[previousTakeId];
      }

      const nextLanes = current.lanes.map((lane, index) =>
        index === laneIndex
          ? {
              laneIndex,
              clips: [
                {
                  id: clipId,
                  laneIndex,
                  takeId: take.id,
                  timelineStartSec: 0,
                  sourceStartSec: Math.max(0, sourceStartSec),
                  durationSec: Math.max(0, durationSec),
                  volumeEnvelope: createDefaultClipVolumeEnvelope(
                    Math.max(0, durationSec),
                  ),
                },
              ],
            }
          : lane,
      );

      return {
        ...current,
        takesById: nextTakesById,
        laneTakeIds: nextLaneTakeIds,
        lanes: nextLanes,
      };
    });

    return { replacedTake, clipId };
  }

  initializeTrackFromTake(
    laneIndex: number,
    takeId: string,
    sourceStartSec: number,
    durationSec: number,
  ): void {
    this.setDocument((current) => {
      if (laneIndex < 0 || laneIndex >= current.lanes.length) return current;

      const lane = current.lanes[laneIndex];
      if (lane == null) return current;

      const clip: TrackClip = {
        id: this.makeClipId(),
        laneIndex,
        takeId,
        timelineStartSec: 0,
        sourceStartSec,
        durationSec,
        volumeEnvelope: createDefaultClipVolumeEnvelope(durationSec),
      };

      const firstClip = lane.clips[0];
      const shouldReplaceWithDecodedClip =
        lane.clips.length === 1 &&
        firstClip != null &&
        firstClip.takeId === takeId &&
        firstClip.timelineStartSec === 0;

      const nextLane: TrackLane = shouldReplaceWithDecodedClip
        ? {
            laneIndex,
            clips: [
              {
                ...firstClip,
                sourceStartSec,
                durationSec,
                volumeEnvelope: createDefaultClipVolumeEnvelope(durationSec),
              },
            ],
          }
        : lane.clips.length === 0
          ? {
              laneIndex,
              clips: [clip],
            }
          : lane;

      if (nextLane === lane) return current;

      const nextLanes = [...current.lanes];
      nextLanes[laneIndex] = nextLane;

      return {
        ...current,
        lanes: nextLanes,
      };
    });
  }

  splitClipAtTime(input: {
    laneIndex: number;
    clipId: string;
    splitTimeSec: number;
  }): { leftClipId: string; rightClipId: string } | null {
    const { laneIndex, clipId, splitTimeSec } = input;
    let result: { leftClipId: string; rightClipId: string } | null = null;

    this.setDocument((current) => {
      const lane = current.lanes[laneIndex];
      if (lane == null) return current;

      const idx = lane.clips.findIndex((clip) => clip.id === clipId);
      if (idx < 0) return current;

      const clip = lane.clips[idx];
      if (clip == null) return current;

      const clipStart = clip.timelineStartSec;
      const clipEnd = clip.timelineStartSec + clip.durationSec;
      const EPSILON = 1e-6;
      if (
        !(splitTimeSec > clipStart + EPSILON && splitTimeSec < clipEnd - EPSILON)
      ) {
        return current;
      }

      const leftDuration = splitTimeSec - clipStart;
      const rightDuration = clipEnd - splitTimeSec;
      if (leftDuration <= EPSILON || rightDuration <= EPSILON) return current;
      const splitVolumeEnvelope = splitClipVolumeEnvelopeAtTime(
        clip.volumeEnvelope,
        leftDuration,
        clip.durationSec,
      );

      const left: TrackClip = {
        ...clip,
        id: this.makeClipId(),
        durationSec: leftDuration,
        volumeEnvelope: splitVolumeEnvelope.left,
      };

      const right: TrackClip = {
        ...clip,
        id: this.makeClipId(),
        timelineStartSec: splitTimeSec,
        sourceStartSec: clip.sourceStartSec + leftDuration,
        durationSec: rightDuration,
        volumeEnvelope: splitVolumeEnvelope.right,
      };

      const nextClips = [
        ...lane.clips.slice(0, idx),
        left,
        right,
        ...lane.clips.slice(idx + 1),
      ];

      const nextLanes = [...current.lanes];
      nextLanes[laneIndex] = {
        ...lane,
        clips: nextClips,
      };

      result = {
        leftClipId: left.id,
        rightClipId: right.id,
      };

      return {
        ...current,
        lanes: nextLanes,
      };
    });

    return result;
  }

  moveClip(laneIndex: number, clipId: string, desiredStartSec: number): void {
    this.setDocument((current) => {
      const lane = current.lanes[laneIndex];
      if (lane == null) return current;

      const idx = lane.clips.findIndex((clip) => clip.id === clipId);
      if (idx < 0) return current;

      const clip = lane.clips[idx];
      if (clip == null) return current;

      const prev = idx > 0 ? lane.clips[idx - 1] : null;
      const next = idx < lane.clips.length - 1 ? lane.clips[idx + 1] : null;

      const minStart =
        prev != null ? prev.timelineStartSec + prev.durationSec : 0;
      const maxStart =
        next != null
          ? Math.max(minStart, next.timelineStartSec - clip.durationSec)
          : Number.POSITIVE_INFINITY;

      const clamped = Math.min(Math.max(desiredStartSec, minStart), maxStart);
      if (Math.abs(clamped - clip.timelineStartSec) < 1e-6) return current;

      const nextClips = [...lane.clips];
      nextClips[idx] = {
        ...clip,
        timelineStartSec: clamped,
      };

      const nextLanes = [...current.lanes];
      nextLanes[laneIndex] = {
        ...lane,
        clips: nextClips,
      };

      return {
        ...current,
        lanes: nextLanes,
      };
    });
  }

  deleteClip(input: { laneIndex: number; clipId: string }): { deleted: boolean } {
    const { laneIndex, clipId } = input;
    let deleted = false;

    this.setDocument((current) => {
      const lane = current.lanes[laneIndex];
      if (lane == null) return current;

      const nextClips = lane.clips.filter((clip) => clip.id !== clipId);
      if (nextClips.length === lane.clips.length) return current;

      const nextLanes = [...current.lanes];
      nextLanes[laneIndex] = {
        ...lane,
        clips: nextClips,
      };
      deleted = true;

      return {
        ...current,
        lanes: nextLanes,
      };
    });

    return { deleted };
  }

  applyClipVolumeBrush(input: ApplyClipVolumeBrushInput): void {
    if (Math.abs(input.deltaGainMultiplier) <= 1e-6 || input.radiusSec <= 0) {
      return;
    }

    this.setDocument((current) => {
      const lane = current.lanes[input.laneIndex];
      if (lane == null) return current;

      const clipIndex = lane.clips.findIndex((clip) => clip.id === input.clipId);
      if (clipIndex < 0) return current;
      const clip = lane.clips[clipIndex];
      if (clip == null || clip.durationSec <= 0) return current;

      const currentEnvelope = clip.volumeEnvelope;
      const nextEnvelope = applyClipVolumeBrush({
        envelope: currentEnvelope,
        durationSec: clip.durationSec,
        centerSec: input.centerSec,
        deltaGainMultiplier: input.deltaGainMultiplier,
        radiusSec: input.radiusSec,
      });

      if (isSameVolumeEnvelope(currentEnvelope, nextEnvelope)) {
        return current;
      }

      const nextClip: TrackClip = {
        ...clip,
        volumeEnvelope: nextEnvelope,
      };

      const nextClips = [...lane.clips];
      nextClips[clipIndex] = nextClip;

      const nextLanes = [...current.lanes];
      nextLanes[input.laneIndex] = {
        ...lane,
        clips: nextClips,
      };

      return {
        ...current,
        lanes: nextLanes,
      };
    });
  }

  setTrackVolume(laneIndex: number, volume: number): void {
    if (laneIndex < 0 || laneIndex >= this.document.get().mix.volumes.length) {
      return;
    }

    this.setDocument((current) => {
      const nextVolumes = [...current.mix.volumes];
      nextVolumes[laneIndex] = volume;
      return {
        ...current,
        mix: {
          ...current.mix,
          volumes: nextVolumes,
        },
      };
    });

    this.options.getMixer()?.setTrackVolume(laneIndex, volume);
  }

  setTrackMuted(laneIndex: number, muted: boolean): void {
    if (laneIndex < 0 || laneIndex >= this.document.get().mix.muted.length) {
      return;
    }

    this.setDocument((current) => {
      const nextMuted = [...current.mix.muted];
      nextMuted[laneIndex] = muted;
      return {
        ...current,
        mix: {
          ...current.mix,
          muted: nextMuted,
        },
      };
    });

    this.options.getMixer()?.setTrackMuted(laneIndex, muted);
  }

  setReverbWet(wet: number): void {
    this.setDocument((current) => ({
      ...current,
      mix: {
        ...current.mix,
        reverbWet: wet,
      },
    }));

    this.options.getMixer()?.setReverbWet(wet);
  }

  clearLane(laneIndex: number): TakeRecord | null {
    let removedTake: TakeRecord | null = null;

    this.setDocument((current) => {
      if (laneIndex < 0 || laneIndex >= current.lanes.length) return current;

      const takeId = current.laneTakeIds[laneIndex];
      if (takeId != null) {
        removedTake = current.takesById[takeId] ?? null;
      }

      const nextLaneTakeIds = [...current.laneTakeIds];
      nextLaneTakeIds[laneIndex] = null;

      const nextTakesById = { ...current.takesById };
      if (takeId != null) {
        delete nextTakesById[takeId];
      }

      const nextLanes = current.lanes.map((lane, index) =>
        index === laneIndex
          ? {
              laneIndex,
              clips: [],
            }
          : lane,
      );

      return {
        ...current,
        laneTakeIds: nextLaneTakeIds,
        takesById: nextTakesById,
        lanes: nextLanes,
      };
    });

    return removedTake;
  }

  resizeForPartCount(totalParts: number): TakeRecord[] {
    const removedTakes: TakeRecord[] = [];

    this.setDocument((current) => {
      const currentLaneTakeIds = current.laneTakeIds.slice(0, totalParts);
      const currentLanes = current.lanes.slice(0, totalParts);
      const currentVolumes = current.mix.volumes.slice(0, totalParts);
      const currentMuted = current.mix.muted.slice(0, totalParts);

      for (let i = currentLaneTakeIds.length; i < totalParts; i++) {
        currentLaneTakeIds.push(null);
      }

      for (let i = currentLanes.length; i < totalParts; i++) {
        currentLanes.push({ laneIndex: i, clips: [] });
      }

      for (let i = currentVolumes.length; i < totalParts; i++) {
        currentVolumes.push(1);
      }

      for (let i = currentMuted.length; i < totalParts; i++) {
        currentMuted.push(false);
      }

      const preservedTakeIds = new Set(
        currentLaneTakeIds.filter((takeId): takeId is string => takeId != null),
      );

      const nextTakesById: Record<string, TakeRecord> = {};
      for (const [takeId, take] of Object.entries(current.takesById)) {
        if (preservedTakeIds.has(takeId)) {
          nextTakesById[takeId] = take;
        } else {
          removedTakes.push(take);
        }
      }

      return {
        ...current,
        takesById: nextTakesById,
        laneTakeIds: currentLaneTakeIds,
        lanes: currentLanes,
        mix: {
          ...current.mix,
          volumes: currentVolumes,
          muted: currentMuted,
        },
      };
    });

    return removedTakes;
  }

  reset(totalParts: number): TakeRecord[] {
    const removedTakes = Object.values(this.document.get().takesById);
    this.document.set(createEmptyTracksDocument(totalParts));
    return removedTakes;
  }

  private setDocument(
    updater: (current: TracksDocumentState) => TracksDocumentState,
  ): void {
    const current = this.document.get();
    const next = updater(current);
    if (next !== current) {
      this.document.set(next);
    }
  }

  private makeClipId(): string {
    this.nextClipId += 1;
    return `clip-${this.nextClipId}`;
  }
}

export class TracksEditorModel {
  readonly editor = new Observable<TracksEditorState>(
    createEmptyTracksEditorState(),
  );

  setPlayhead(sec: number): void {
    this.setEditor((current) => ({
      ...current,
      playheadSec: Math.max(0, sec),
    }));
  }

  setSelection(selection: TracksEditorSelection): void {
    this.setEditor((current) => ({
      ...current,
      selection,
    }));
  }

  setSnapToBeat(enabled: boolean): void {
    this.setEditor((current) => ({
      ...current,
      snapToBeat: enabled,
    }));
  }

  clearSelection(): void {
    this.setSelection({ laneIndex: null, clipId: null });
  }

  reset(): void {
    this.editor.set(createEmptyTracksEditorState());
  }

  private setEditor(updater: (current: TracksEditorState) => TracksEditorState) {
    const current = this.editor.get();
    const next = updater(current);
    if (next !== current) {
      this.editor.set(next);
    }
  }
}

function isSameVolumeEnvelope(
  a: ClipVolumeEnvelope,
  b: ClipVolumeEnvelope,
): boolean {
  if (a.points.length !== b.points.length) return false;
  for (let i = 0; i < a.points.length; i++) {
    const left = a.points[i];
    const right = b.points[i];
    if (left == null || right == null) return false;
    if (Math.abs(left.timeSec - right.timeSec) > 1e-6) return false;
    if (
      Math.abs(left.gainMultiplier - right.gainMultiplier) > 1e-6
    ) {
      return false;
    }
  }
  return true;
}
