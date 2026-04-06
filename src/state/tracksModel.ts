import { Observable } from "../observable";
import type { Mixer } from "../audio/mixer";
import {
  type ClipAutomation,
  type ClipAutomationLane,
  type AutomationParam,
  VOLUME_AUTOMATION_PARAM,
  applyAutomationBrush,
  createDefaultClipAutomation,
  getVolumeAutomationLane,
  splitClipAutomationAtTime,
  withUpdatedVolumeLane,
} from "./clipAutomation";

// Implementation idea: what if we gave lanes ids, and used laneId instead of laneIndex?

export type TrackClip = {
  // NEEDS COMMENT: how is this assigned?
  id: string;
  laneIndex: number;

  // NEEDS COMMENT: is this the id of... a blob? idk
  // how do i find it?
  takeId: string;

  // NEEDS COMMENT: How exactly should I read this offset?
  // how is it different than sourceStartSec?
  timelineStartSec: number;
  sourceStartSec: number;

  durationSec: number;
  automation: ClipAutomation;
};

export type TrackLane = {
  laneIndex: number;
  clips: TrackClip[];
};

export type TrackEditorSelection = {
  laneIndex: number | null;
  segmentId: string | null;
};

// NEEDS COMMENT: Comment what this is; I think it's a single take
// that the user did. What's blob? url? Name these audio / video as
// appropriate. What's trimOffsetSec?
export type TakeRecord = {
  id: string;
  laneIndex: number;
  blob: Blob;
  url: string;
  trimOffsetSec: number;
};

export type ExportVideoFormat = "mp4" | "webm";

export type ApplyClipAutomationBrushInput = {
  laneIndex: number;
  clipId: string;
  param: AutomationParam;
  centerSec: number;
  deltaValue: number;
  radiusSec: number;
};

export type TracksState = {
  takesById: Record<string, TakeRecord>;
  laneTakeIds: (string | null)[];
  lanes: TrackLane[];

  // Idea: This seems like UI state. Make sure to split out user data model state
  // vs UI state.
  editor: {
    selection: TrackEditorSelection;
    playheadSec: number;
    snapToBeat: boolean;
  };
  mix: {
    volumes: number[];
    muted: boolean[];
    reverbWet: number;
  };

  // This seems like not TracksState, it's something separate called ExportState.
  // Should live separately.
  export: {
    exporting: boolean;
    progress: number;
    exportedUrl: string | null;
    format: ExportVideoFormat | null;
    mimeType: string | null;
  };
};

type TracksModelOptions = {
  totalParts: number;
  getMixer: () => Mixer | null;
};

export function createEmptyTracks(totalParts: number): TracksState {
  return {
    takesById: {},
    laneTakeIds: Array.from({ length: totalParts }, () => null),
    lanes: Array.from({ length: totalParts }, (_, laneIndex) => ({
      laneIndex,
      clips: [],
    })),
    editor: {
      selection: { laneIndex: null, segmentId: null },
      playheadSec: 0,
      snapToBeat: false,
    },
    mix: {
      volumes: Array.from({ length: totalParts }, () => 1),
      muted: Array.from({ length: totalParts }, () => false),
      reverbWet: 0.15,
    },
    export: {
      exporting: false,
      progress: 0,
      exportedUrl: null,
      format: null,
      mimeType: null,
    },
  };
}

export class TracksModel {
  private nextClipId = 0;

  readonly tracks: Observable<TracksState>;

  constructor(private options: TracksModelOptions) {
    this.tracks = new Observable<TracksState>(
      createEmptyTracks(options.totalParts),
    );
  }

  stageKeptTake(input: {
    laneIndex: number;
    take: TakeRecord;
    sourceStartSec: number;
    durationSec: number;
  }): TakeRecord | null {
    const { laneIndex, take, sourceStartSec, durationSec } = input;
    const clipId = this.makeClipId();
    let replacedTake: TakeRecord | null = null;

    this.setTracks((current) => {
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
                  automation: createDefaultClipAutomation(
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
        editor: {
          ...current.editor,
          selection: {
            laneIndex,
            segmentId: clipId,
          },
        },
      };
    });

    return replacedTake;
  }

  initializeTrackFromTake(
    laneIndex: number,
    takeId: string,
    sourceStartSec: number,
    durationSec: number,
  ): void {
    this.setTracks((current) => {
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
        automation: createDefaultClipAutomation(durationSec),
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
                automation: createDefaultClipAutomation(durationSec),
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

      const hasSelection = current.editor.selection.segmentId != null;

      return {
        ...current,
        lanes: nextLanes,
        editor: hasSelection
          ? current.editor
          : {
              ...current.editor,
              selection: {
                laneIndex,
                segmentId: nextLane.clips[0]?.id ?? null,
              },
            },
      };
    });
  }

  splitSelectedClipAtPlayhead(): void {
    this.setTracks((current) => {
      const { selection, playheadSec } = current.editor;
      if (selection.laneIndex == null || selection.segmentId == null)
        return current;

      const laneIndex = selection.laneIndex;
      const lane = current.lanes[laneIndex];
      if (lane == null) return current;

      const idx = lane.clips.findIndex(
        (clip) => clip.id === selection.segmentId,
      );
      if (idx < 0) return current;

      const clip = lane.clips[idx];
      if (clip == null) return current;

      const clipStart = clip.timelineStartSec;
      const clipEnd = clip.timelineStartSec + clip.durationSec;
      const EPSILON = 1e-6;
      if (
        !(playheadSec > clipStart + EPSILON && playheadSec < clipEnd - EPSILON)
      ) {
        return current;
      }

      const leftDuration = playheadSec - clipStart;
      const rightDuration = clipEnd - playheadSec;
      if (leftDuration <= EPSILON || rightDuration <= EPSILON) return current;
      const splitAutomation = splitClipAutomationAtTime(
        clip.automation,
        leftDuration,
        clip.durationSec,
      );

      const left: TrackClip = {
        ...clip,
        id: this.makeClipId(),
        durationSec: leftDuration,
        automation: splitAutomation.left,
      };

      const right: TrackClip = {
        ...clip,
        id: this.makeClipId(),
        timelineStartSec: playheadSec,
        sourceStartSec: clip.sourceStartSec + leftDuration,
        durationSec: rightDuration,
        automation: splitAutomation.right,
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

      return {
        ...current,
        lanes: nextLanes,
        editor: {
          ...current.editor,
          selection: {
            laneIndex,
            segmentId: right.id,
          },
        },
      };
    });
  }

  moveClip(laneIndex: number, clipId: string, desiredStartSec: number): void {
    this.setTracks((current) => {
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

  deleteSelectedClip(): void {
    this.setTracks((current) => {
      const { selection, playheadSec } = current.editor;
      if (selection.laneIndex == null || selection.segmentId == null)
        return current;

      const laneIndex = selection.laneIndex;
      const lane = current.lanes[laneIndex];
      if (lane == null) return current;

      const nextClips = lane.clips.filter(
        (clip) => clip.id !== selection.segmentId,
      );
      if (nextClips.length === lane.clips.length) return current;

      const nextLanes = [...current.lanes];
      nextLanes[laneIndex] = {
        ...lane,
        clips: nextClips,
      };

      const after = nextClips.find(
        (clip) => clip.timelineStartSec >= playheadSec,
      );
      const nextSelectionId =
        after?.id ?? nextClips[nextClips.length - 1]?.id ?? null;

      return {
        ...current,
        lanes: nextLanes,
        editor: {
          ...current.editor,
          selection:
            nextSelectionId != null
              ? { laneIndex, segmentId: nextSelectionId }
              : { laneIndex: null, segmentId: null },
        },
      };
    });
  }

  setPlayhead(sec: number): void {
    this.setTracks((current) => ({
      ...current,
      editor: {
        ...current.editor,
        playheadSec: Math.max(0, sec),
      },
    }));
  }

  setSelection(selection: TrackEditorSelection): void {
    this.setTracks((current) => ({
      ...current,
      editor: {
        ...current.editor,
        selection,
      },
    }));
  }

  setSnapToBeat(enabled: boolean): void {
    this.setTracks((current) => ({
      ...current,
      editor: {
        ...current.editor,
        snapToBeat: enabled,
      },
    }));
  }

  setTrackVolume(laneIndex: number, volume: number): void {
    if (laneIndex < 0 || laneIndex >= this.tracks.get().mix.volumes.length) {
      return;
    }

    this.setTracks((current) => {
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
    if (laneIndex < 0 || laneIndex >= this.tracks.get().mix.muted.length) {
      return;
    }

    this.setTracks((current) => {
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
    this.setTracks((current) => ({
      ...current,
      mix: {
        ...current.mix,
        reverbWet: wet,
      },
    }));

    this.options.getMixer()?.setReverbWet(wet);
  }

  applyClipAutomationBrush(input: ApplyClipAutomationBrushInput): void {
    if (input.param !== VOLUME_AUTOMATION_PARAM) return;
    if (Math.abs(input.deltaValue) <= 1e-6 || input.radiusSec <= 0) return;

    this.setTracks((current) => {
      const lane = current.lanes[input.laneIndex];
      if (lane == null) return current;

      const clipIndex = lane.clips.findIndex(
        (clip) => clip.id === input.clipId,
      );
      if (clipIndex < 0) return current;
      const clip = lane.clips[clipIndex];
      if (clip == null || clip.durationSec <= 0) return current;

      const currentLane = getVolumeAutomationLane(
        clip.automation,
        clip.durationSec,
      );
      const nextLane = applyAutomationBrush({
        lane: currentLane,
        durationSec: clip.durationSec,
        centerSec: input.centerSec,
        deltaValue: input.deltaValue,
        radiusSec: input.radiusSec,
      });

      if (isSameVolumeLane(currentLane, nextLane)) {
        return current;
      }

      const nextClip: TrackClip = {
        ...clip,
        automation: withUpdatedVolumeLane(
          clip.automation,
          nextLane,
          clip.durationSec,
        ),
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

  beginExport(): void {
    this.setTracks((current) => ({
      ...current,
      export: {
        ...current.export,
        exporting: true,
        progress: 0,
        format: null,
        mimeType: null,
      },
      editor: {
        ...current.editor,
        playheadSec: 0,
      },
    }));
  }

  updateExportProgress(progress: number): void {
    const clamped = Math.min(1, Math.max(0, progress));
    this.setTracks((current) => ({
      ...current,
      export: {
        ...current.export,
        progress: clamped,
      },
    }));
  }

  completeExport(input: {
    url: string;
    format: ExportVideoFormat;
    mimeType: string;
  }): void {
    const { url, format, mimeType } = input;
    this.setTracks((current) => {
      const prevUrl = current.export.exportedUrl;
      if (prevUrl != null && prevUrl !== url) {
        URL.revokeObjectURL(prevUrl);
      }

      return {
        ...current,
        export: {
          ...current.export,
          exporting: false,
          progress: 1,
          exportedUrl: url,
          format,
          mimeType,
        },
      };
    });
  }

  failOrResetExport(): void {
    this.setTracks((current) => ({
      ...current,
      export: {
        ...current.export,
        exporting: false,
        progress: 0,
        format: null,
        mimeType: null,
      },
    }));
  }

  clearExportedUrl(): void {
    this.setTracks((current) => {
      const prevUrl = current.export.exportedUrl;
      if (prevUrl != null) {
        URL.revokeObjectURL(prevUrl);
      }

      return {
        ...current,
        export: {
          ...current.export,
          exportedUrl: null,
          format: null,
          mimeType: null,
        },
      };
    });
  }

  clearLane(laneIndex: number): TakeRecord | null {
    let removedTake: TakeRecord | null = null;

    this.setTracks((current) => {
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
        editor: {
          ...current.editor,
          selection: { laneIndex: null, segmentId: null },
          playheadSec: 0,
        },
      };
    });

    return removedTake;
  }

  resizeForPartCount(totalParts: number): TakeRecord[] {
    const removedTakes: TakeRecord[] = [];

    this.setTracks((current) => {
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

      const laneHasSelection =
        current.editor.selection.laneIndex != null &&
        current.editor.selection.laneIndex < totalParts;

      return {
        ...current,
        takesById: nextTakesById,
        laneTakeIds: currentLaneTakeIds,
        lanes: currentLanes,
        editor: {
          ...current.editor,
          selection: laneHasSelection
            ? current.editor.selection
            : { laneIndex: null, segmentId: null },
        },
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
    const removedTakes = Object.values(this.tracks.get().takesById);

    this.setTracks((current) => {
      const prevUrl = current.export.exportedUrl;
      if (prevUrl != null) {
        URL.revokeObjectURL(prevUrl);
      }
      return createEmptyTracks(totalParts);
    });

    return removedTakes;
  }

  private setTracks(updater: (current: TracksState) => TracksState): void {
    const current = this.tracks.get();
    const next = updater(current);
    if (next !== current) {
      this.tracks.set(next);
    }
  }

  private makeClipId(): string {
    this.nextClipId += 1;
    return `clip-${this.nextClipId}`;
  }
}

function isSameVolumeLane(
  a: ClipAutomationLane,
  b: ClipAutomationLane,
): boolean {
  if (a.points.length !== b.points.length) return false;
  for (let i = 0; i < a.points.length; i++) {
    const left = a.points[i];
    const right = b.points[i];
    if (left == null || right == null) return false;
    if (Math.abs(left.timeSec - right.timeSec) > 1e-6) return false;
    if (Math.abs(left.value - right.value) > 1e-6) return false;
  }
  return true;
}
