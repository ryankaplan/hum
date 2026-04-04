import { Derived, Observable, PersistedObservable } from "../observable";
import { generateHarmony } from "../music/harmony";
import { parseChordProgression } from "../music/parse";
import { progressionDurationSec } from "../music/playback";
import { noteNameToMidi } from "../music/types";
import type { Chord, HarmonyVoicing, Meter, PartIndex } from "../music/types";
import type { Mixer } from "../audio/mixer";
import type { CompositorHandle } from "../video/compositor";
import { buildWaveformPeaks } from "../ui/timeline";

type WaveformPeaks = number[];

export type AppScreen = "setup" | "recording" | "review";

export type PartState =
  | { status: "idle" }
  | { status: "recording" }
  | { status: "review"; blob: Blob; url: string }
  | { status: "kept"; blob: Blob; url: string; trimOffsetSec: number };

export type TotalPartCount = 2 | 4;

export type ArrangementInput = {
  chordsInput: string;
  tempo: number;
  meter: Meter;
  vocalRangeLow: string;
  vocalRangeHigh: string;
  totalParts: TotalPartCount;
};

export type ArrangementInfo = {
  input: ArrangementInput;
  parsedChords: Chord[];
  harmonyVoicing: HarmonyVoicing | null;
  beatSec: number;
  progressionDurationSec: number;
  isValid: boolean;
};

export type TrackClip = {
  id: string;
  laneIndex: number;
  takeId: string;
  timelineStartSec: number;
  sourceStartSec: number;
  durationSec: number;
};

export type TrackLane = {
  laneIndex: number;
  clips: TrackClip[];
};

export type TrackEditorSelection = {
  laneIndex: number | null;
  segmentId: string | null;
};

export type TakeRecord = {
  id: string;
  laneIndex: number;
  blob: Blob;
  url: string;
  trimOffsetSec: number;
};

export type TracksState = {
  takesById: Record<string, TakeRecord>;
  laneTakeIds: (string | null)[];
  lanes: TrackLane[];
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
  export: {
    exporting: boolean;
    progress: number;
    exportedUrl: string | null;
  };
};

export type KeepTakeInput = {
  laneIndex: number;
  blob: Blob;
  url: string;
  trimOffsetSec: number;
};

export type RuntimeTakeMediaIngestInput = {
  takeId: string;
  laneIndex: number;
  blob: Blob;
  trimOffsetSec: number;
  ctx: AudioContext;
  videoEl: HTMLVideoElement;
  maxDurationSec: number;
  waveformBuckets?: number;
};

export type TakeSourceWindow = {
  sourceStartSec: number;
  durationSec: number;
};

export type LaneRuntimeWaveform = {
  takeId: string;
  peaks: WaveformPeaks;
  sourceWindow: TakeSourceWindow;
} | null;

function parseTotalPartCount(raw: unknown): TotalPartCount {
  return raw === 2 ? 2 : 4;
}

function createIdlePartStates(totalParts: number): PartState[] {
  return Array.from({ length: totalParts }, () => ({ status: "idle" as const }));
}

function createEmptyTracks(totalParts: number): TracksState {
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
    },
  };
}

class AppModel {
  private nextTakeId = 0;
  private nextClipId = 0;
  private audioBuffersByTakeId = new Map<string, AudioBuffer>();
  private waveformPeaksByTakeId = new Map<string, WaveformPeaks>();
  private videoElByTakeId = new Map<string, HTMLVideoElement>();
  private takeSourceWindowByTakeId = new Map<string, TakeSourceWindow>();

  readonly chordsInput = new PersistedObservable<string>(
    "hum.chords",
    "A A F#m F#m D D E E",
  );

  readonly tempoInput = new PersistedObservable<number>("hum.tempo", 80);

  readonly meterInput = new PersistedObservable<Meter>("hum.meter", [4, 4]);

  readonly vocalRangeLow = new PersistedObservable<string>(
    "hum.vocalRangeLow",
    "C3",
  );

  readonly vocalRangeHigh = new PersistedObservable<string>(
    "hum.vocalRangeHigh",
    "C5",
  );

  readonly totalPartsInput = new PersistedObservable<TotalPartCount>(
    "hum.totalParts",
    4,
    { schema: parseTotalPartCount },
  );

  readonly appScreen = new Observable<AppScreen>("setup");
  readonly mediaStream = new Observable<MediaStream | null>(null);
  readonly audioContext = new Observable<AudioContext | null>(null);
  readonly currentPartIndex = new Observable<PartIndex>(0);
  readonly permissionError = new Observable<string | null>(null);

  readonly partStates = new Observable<PartState[]>(
    createIdlePartStates(this.totalPartsInput.get()),
  );

  readonly arrangementInfo = new Observable<ArrangementInfo>(
    this.computeArrangementInfo(),
  );

  readonly tracks = new Observable<TracksState>(
    createEmptyTracks(this.totalPartsInput.get()),
  );

  // Mutable runtime systems are intentionally exposed so screens can compose
  // playback/export behavior while keeping simple runtime storage encapsulated.
  mixer: Mixer | null = null;
  compositor: CompositorHandle | null = null;

  readonly parsedChords = new Derived<Chord[]>(
    () => this.arrangementInfo.get().parsedChords,
    [this.arrangementInfo],
    { checkForEqualityOnNotify: false },
  );

  readonly harmonyVoicing = new Derived<HarmonyVoicing | null>(
    () => this.arrangementInfo.get().harmonyVoicing,
    [this.arrangementInfo],
    { checkForEqualityOnNotify: false },
  );

  constructor() {
    this.chordsInput.register(this.recomputeArrangement);
    this.tempoInput.register(this.recomputeArrangement);
    this.meterInput.register(this.recomputeArrangement);
    this.vocalRangeLow.register(this.recomputeArrangement);
    this.vocalRangeHigh.register(this.recomputeArrangement);

    this.totalPartsInput.register(() => {
      this.recomputeArrangement();
      this.resizePartCount(this.totalPartsInput.get());
    });
  }

  setArrangementInput(patch: Partial<ArrangementInput>): void {
    if (patch.chordsInput != null) {
      this.chordsInput.set(patch.chordsInput);
    }
    if (patch.tempo != null) {
      this.tempoInput.set(patch.tempo);
    }
    if (patch.meter != null) {
      this.meterInput.set(patch.meter);
    }
    if (patch.vocalRangeLow != null) {
      this.vocalRangeLow.set(patch.vocalRangeLow);
    }
    if (patch.vocalRangeHigh != null) {
      this.vocalRangeHigh.set(patch.vocalRangeHigh);
    }
    if (patch.totalParts != null) {
      this.totalPartsInput.set(patch.totalParts);
    }
  }

  recomputeArrangement = (): void => {
    this.arrangementInfo.set(this.computeArrangementInfo());
  };

  updatePartState(index: number, state: PartState): void {
    const current = this.partStates.get();
    if (index < 0 || index >= current.length) return;

    const next = [...current];
    next[index] = state;
    this.partStates.set(next);
  }

  keepRecordedTake(input: KeepTakeInput): void {
    const { laneIndex, blob, url, trimOffsetSec } = input;

    this.updatePartState(laneIndex, {
      status: "kept",
      blob,
      url,
      trimOffsetSec,
    });

    const takeId = this.makeTakeId();
    const clipId = this.makeClipId();
    const arrangement = this.arrangementInfo.get();

    this.setTracks((current) => {
      if (laneIndex < 0 || laneIndex >= current.lanes.length) return current;

      const nextLanes = current.lanes.map((lane, index) =>
        index === laneIndex
          ? {
              laneIndex,
              clips: [
                {
                  id: clipId,
                  laneIndex,
                  takeId,
                  timelineStartSec: 0,
                  sourceStartSec: Math.max(0, trimOffsetSec),
                  durationSec: Math.max(0, arrangement.progressionDurationSec),
                },
              ],
            }
          : lane,
      );

      const nextLaneTakeIds = [...current.laneTakeIds];
      const previousTakeId = nextLaneTakeIds[laneIndex];
      nextLaneTakeIds[laneIndex] = takeId;

      const nextTakesById: Record<string, TakeRecord> = {
        ...current.takesById,
        [takeId]: {
          id: takeId,
          laneIndex,
          blob,
          url,
          trimOffsetSec,
        },
      };

      if (previousTakeId != null && previousTakeId !== takeId) {
        const previousTake = nextTakesById[previousTakeId];
        if (previousTake != null) {
          URL.revokeObjectURL(previousTake.url);
        }
        delete nextTakesById[previousTakeId];
        this.removeTakeRuntimeMedia(previousTakeId);
      }

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
      if (selection.laneIndex == null || selection.segmentId == null) return current;

      const laneIndex = selection.laneIndex;
      const lane = current.lanes[laneIndex];
      if (lane == null) return current;

      const idx = lane.clips.findIndex((clip) => clip.id === selection.segmentId);
      if (idx < 0) return current;

      const clip = lane.clips[idx];
      if (clip == null) return current;

      const clipStart = clip.timelineStartSec;
      const clipEnd = clip.timelineStartSec + clip.durationSec;
      const EPSILON = 1e-6;
      if (!(playheadSec > clipStart + EPSILON && playheadSec < clipEnd - EPSILON)) {
        return current;
      }

      const leftDuration = playheadSec - clipStart;
      const rightDuration = clipEnd - playheadSec;
      if (leftDuration <= EPSILON || rightDuration <= EPSILON) return current;

      const left: TrackClip = {
        ...clip,
        id: this.makeClipId(),
        durationSec: leftDuration,
      };

      const right: TrackClip = {
        ...clip,
        id: this.makeClipId(),
        timelineStartSec: playheadSec,
        sourceStartSec: clip.sourceStartSec + leftDuration,
        durationSec: rightDuration,
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

      const minStart = prev != null ? prev.timelineStartSec + prev.durationSec : 0;
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
      if (selection.laneIndex == null || selection.segmentId == null) return current;

      const laneIndex = selection.laneIndex;
      const lane = current.lanes[laneIndex];
      if (lane == null) return current;

      const nextClips = lane.clips.filter((clip) => clip.id !== selection.segmentId);
      if (nextClips.length === lane.clips.length) return current;

      const nextLanes = [...current.lanes];
      nextLanes[laneIndex] = {
        ...lane,
        clips: nextClips,
      };

      const after = nextClips.find((clip) => clip.timelineStartSec >= playheadSec);
      const nextSelectionId = after?.id ?? nextClips[nextClips.length - 1]?.id ?? null;

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

    this.mixer?.setTrackVolume(laneIndex, volume);
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

    this.mixer?.setTrackMuted(laneIndex, muted);
  }

  setReverbWet(wet: number): void {
    this.setTracks((current) => ({
      ...current,
      mix: {
        ...current.mix,
        reverbWet: wet,
      },
    }));
    this.mixer?.setReverbWet(wet);
  }

  beginExport(): void {
    this.setTracks((current) => ({
      ...current,
      export: {
        ...current.export,
        exporting: true,
        progress: 0,
      },
    }));
    this.setPlayhead(0);
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

  completeExport(url: string): void {
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
        },
      };
    });
  }

  async ingestTakeRuntimeMedia(input: RuntimeTakeMediaIngestInput): Promise<boolean> {
    const {
      takeId,
      laneIndex,
      blob,
      trimOffsetSec,
      ctx,
      videoEl,
      maxDurationSec,
      waveformBuckets = 400,
    } = input;

    this.videoElByTakeId.set(takeId, videoEl);

    const raw = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(raw);

    const current = this.tracks.get();
    if (current.laneTakeIds[laneIndex] !== takeId) {
      return false;
    }

    const sourceStartSec = Math.min(Math.max(0, trimOffsetSec), decoded.duration);
    const rawDuration = Math.max(0, decoded.duration - sourceStartSec);
    const durationSec = Math.max(
      0,
      Math.min(rawDuration, Math.max(0, maxDurationSec)),
    );

    this.audioBuffersByTakeId.set(takeId, decoded);
    this.takeSourceWindowByTakeId.set(takeId, {
      sourceStartSec,
      durationSec,
    });
    this.waveformPeaksByTakeId.set(
      takeId,
      buildWaveformPeaks(decoded, sourceStartSec, durationSec, waveformBuckets),
    );

    this.initializeTrackFromTake(laneIndex, takeId, sourceStartSec, durationSec);
    return true;
  }

  getTakeAudioBuffer(takeId: string): AudioBuffer | null {
    return this.audioBuffersByTakeId.get(takeId) ?? null;
  }

  getTakeWaveform(takeId: string): WaveformPeaks | null {
    return this.waveformPeaksByTakeId.get(takeId) ?? null;
  }

  getTakeSourceWindow(takeId: string): TakeSourceWindow | null {
    return this.takeSourceWindowByTakeId.get(takeId) ?? null;
  }

  getTakeVideoElement(takeId: string): HTMLVideoElement | null {
    return this.videoElByTakeId.get(takeId) ?? null;
  }

  getLaneRuntimeWaveform(laneIndex: number): LaneRuntimeWaveform {
    const takeId = this.tracks.get().laneTakeIds[laneIndex];
    if (takeId == null) return null;

    const peaks = this.getTakeWaveform(takeId);
    const sourceWindow = this.getTakeSourceWindow(takeId);
    if (peaks == null || sourceWindow == null) return null;

    return {
      takeId,
      peaks,
      sourceWindow,
    };
  }

  clearRuntimeTakeMedia(): void {
    this.audioBuffersByTakeId.clear();
    this.waveformPeaksByTakeId.clear();
    this.videoElByTakeId.clear();
    this.takeSourceWindowByTakeId.clear();
  }

  removeTakeRuntimeMedia(takeId: string): void {
    this.audioBuffersByTakeId.delete(takeId);
    this.waveformPeaksByTakeId.delete(takeId);
    this.videoElByTakeId.delete(takeId);
    this.takeSourceWindowByTakeId.delete(takeId);
  }

  redoPart(index: number): void {
    this.updatePartState(index, { status: "idle" });
    this.currentPartIndex.set(index);
    this.appScreen.set("recording");

    this.setTracks((current) => {
      if (index < 0 || index >= current.lanes.length) return current;

      const takeId = current.laneTakeIds[index];
      if (takeId != null) {
        const take = current.takesById[takeId];
        if (take != null) {
          URL.revokeObjectURL(take.url);
        }
        this.removeTakeRuntimeMedia(takeId);
      }

      const nextLaneTakeIds = [...current.laneTakeIds];
      nextLaneTakeIds[index] = null;

      const nextTakesById = { ...current.takesById };
      if (takeId != null) {
        delete nextTakesById[takeId];
      }

      const nextLanes = current.lanes.map((lane, laneIndex) =>
        laneIndex === index
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
  }

  getKeptBlobs(): (Blob | null)[] {
    return this.partStates.get().map((state) =>
      state.status === "kept" ? state.blob : null,
    );
  }

  resetSession(): void {
    this.currentPartIndex.set(0);
    this.partStates.set(createIdlePartStates(this.totalPartsInput.get()));
    this.permissionError.set(null);

    const currentTracks = this.tracks.get();
    for (const takeId of Object.keys(currentTracks.takesById)) {
      const take = currentTracks.takesById[takeId];
      if (take != null) {
        URL.revokeObjectURL(take.url);
      }
    }

    this.clearExportedUrl();
    this.tracks.set(createEmptyTracks(this.totalPartsInput.get()));
    this.clearRuntimeTakeMedia();

    this.mixer?.dispose();
    this.mixer = null;

    this.compositor?.stop();
    this.compositor = null;
  }

  private computeArrangementInfo(): ArrangementInfo {
    const input: ArrangementInput = {
      chordsInput: this.chordsInput.get(),
      tempo: this.tempoInput.get(),
      meter: this.meterInput.get(),
      vocalRangeLow: this.vocalRangeLow.get(),
      vocalRangeHigh: this.vocalRangeHigh.get(),
      totalParts: this.totalPartsInput.get(),
    };

    const parsed = parseChordProgression(input.chordsInput, input.meter[0]);

    let voicing: HarmonyVoicing | null = null;
    try {
      const low = noteNameToMidi(input.vocalRangeLow);
      const high = noteNameToMidi(input.vocalRangeHigh);
      if (high > low && parsed.length > 0) {
        const harmonyPartCount = Math.max(1, input.totalParts - 1);
        voicing = generateHarmony(parsed, { low, high }, harmonyPartCount);
      }
    } catch {
      voicing = null;
    }

    const beatSec = input.tempo > 0 ? 60 / input.tempo : 0;

    return {
      input,
      parsedChords: parsed,
      harmonyVoicing: voicing,
      beatSec,
      progressionDurationSec:
        parsed.length > 0 && input.tempo > 0
          ? progressionDurationSec(parsed, input.tempo)
          : 0,
      isValid: parsed.length > 0 && voicing != null,
    };
  }

  private resizePartCount(totalParts: number): void {
    this.partStates.set(this.resizePartStates(this.partStates.get(), totalParts));

    const clampedPartIndex = Math.min(
      Math.max(0, this.currentPartIndex.get()),
      Math.max(0, totalParts - 1),
    );
    this.currentPartIndex.set(clampedPartIndex);

    this.setTracks((current) => this.resizeTracksForPartCount(current, totalParts));
  }

  private resizePartStates(current: PartState[], totalParts: number): PartState[] {
    const next = current.slice(0, totalParts);
    while (next.length < totalParts) {
      next.push({ status: "idle" });
    }
    return next;
  }

  private resizeTracksForPartCount(current: TracksState, totalParts: number): TracksState {
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
        URL.revokeObjectURL(take.url);
        this.removeTakeRuntimeMedia(takeId);
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
  }

  private setTracks(updater: (current: TracksState) => TracksState): void {
    const current = this.tracks.get();
    const next = updater(current);
    if (next !== current) {
      this.tracks.set(next);
    }
  }

  private makeTakeId(): string {
    this.nextTakeId += 1;
    return `take-${this.nextTakeId}`;
  }

  private makeClipId(): string {
    this.nextClipId += 1;
    return `clip-${this.nextClipId}`;
  }
}

export function Model(): AppModel {
  return new AppModel();
}

export const model = Model();
