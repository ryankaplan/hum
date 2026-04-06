import { Derived, Observable, PersistedObservable } from "../observable";
import { generateHarmony } from "../music/harmony";
import { parseChordProgression } from "../music/parse";
import { progressionDurationSec } from "../music/playback";
import { noteNameToMidi } from "../music/types";
import type { Chord, HarmonyVoicing, Meter, PartIndex } from "../music/types";
import type { Mixer } from "../audio/mixer";
import type { CompositorHandle } from "../video/compositor";
import { buildWaveformPeaks } from "../ui/timeline";
import {
  TracksDocumentModel,
  TracksEditorModel,
  type TakeRecord,
  type TracksDocumentState,
  type TracksEditorSelection,
} from "./tracksModel";

type WaveformPeaks = number[];

export type {
  ApplyClipAutomationBrushInput,
  TrackClip,
  TrackLane,
  TakeRecord,
  TracksDocumentState,
  TracksEditorSelection,
  TracksEditorState,
  TracksMixState,
} from "./tracksModel";

export type ExportVideoFormat = "mp4" | "webm";

export type ExportState = {
  exporting: boolean;
  progress: number;
  exportedUrl: string | null;
  format: ExportVideoFormat | null;
  mimeType: string | null;
};

export type AppScreen = "setup" | "calibration" | "recording" | "review";

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
  waveformBucketsPerSec?: number;
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
  return Array.from({ length: totalParts }, () => ({
    status: "idle" as const,
  }));
}

function createEmptyExportState(): ExportState {
  return {
    exporting: false,
    progress: 0,
    exportedUrl: null,
    format: null,
    mimeType: null,
  };
}

class AppModel {
  private nextTakeId = 0;
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
  readonly latencyCorrectionSec = new Observable<number>(0);
  readonly isCalibrated = new Observable<boolean>(false);

  readonly partStates = new Observable<PartState[]>(
    createIdlePartStates(this.totalPartsInput.get()),
  );

  readonly arrangementInfo = new Observable<ArrangementInfo>(
    this.computeArrangementInfo(),
  );

  readonly tracksExport = new Observable<ExportState>(createEmptyExportState());

  // Mutable runtime systems remain exposed.
  mixer: Mixer | null = null;
  compositor: CompositorHandle | null = null;

  readonly tracksDocument = new TracksDocumentModel({
    totalParts: this.totalPartsInput.get(),
    getMixer: () => this.mixer,
  });

  readonly tracksEditor = new TracksEditorModel();

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
    const arrangement = this.arrangementInfo.get();

    const take: TakeRecord = {
      id: takeId,
      laneIndex,
      blob,
      url,
      trimOffsetSec,
    };

    const { replacedTake, clipId } = this.tracksDocument.stageKeptTake({
      laneIndex,
      take,
      sourceStartSec: Math.max(0, trimOffsetSec),
      durationSec: Math.max(0, arrangement.progressionDurationSec),
    });

    if (clipId != null) {
      this.tracksEditor.setSelection({
        laneIndex,
        clipId,
      });
    }

    if (replacedTake != null) {
      URL.revokeObjectURL(replacedTake.url);
      this.removeTakeRuntimeMedia(replacedTake.id);
    }
  }

  async ingestTakeRuntimeMedia(
    input: RuntimeTakeMediaIngestInput,
  ): Promise<boolean> {
    const {
      takeId,
      laneIndex,
      blob,
      trimOffsetSec,
      ctx,
      videoEl,
      maxDurationSec,
      waveformBuckets,
      waveformBucketsPerSec = 72,
    } = input;

    this.videoElByTakeId.set(takeId, videoEl);

    const raw = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(raw);

    const current = this.tracksDocument.document.get();
    if (current.laneTakeIds[laneIndex] !== takeId) {
      return false;
    }

    const sourceStartSec = Math.min(
      Math.max(0, trimOffsetSec),
      decoded.duration,
    );
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
    const computedBuckets = waveformBuckets ?? Math.max(
      64,
      Math.min(4096, Math.round(durationSec * Math.max(16, waveformBucketsPerSec))),
    );
    this.waveformPeaksByTakeId.set(
      takeId,
      buildWaveformPeaks(decoded, sourceStartSec, durationSec, computedBuckets),
    );

    this.tracksDocument.initializeTrackFromTake(
      laneIndex,
      takeId,
      sourceStartSec,
      durationSec,
    );
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
    const takeId = this.tracksDocument.document.get().laneTakeIds[laneIndex];
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

  splitSelectedClipAtPlayhead(): void {
    const editor = this.tracksEditor.editor.get();
    const { laneIndex, clipId } = editor.selection;
    if (laneIndex == null || clipId == null) return;

    const result = this.tracksDocument.splitClipAtTime({
      laneIndex,
      clipId,
      splitTimeSec: editor.playheadSec,
    });

    if (result != null) {
      this.tracksEditor.setSelection({
        laneIndex,
        clipId: result.rightClipId,
      });
    }
  }

  deleteSelectedClip(): void {
    const editor = this.tracksEditor.editor.get();
    const { laneIndex, clipId } = editor.selection;
    if (laneIndex == null || clipId == null) return;

    const { deleted } = this.tracksDocument.deleteClip({ laneIndex, clipId });
    if (!deleted) return;

    const nextLane = this.tracksDocument.document.get().lanes[laneIndex];
    const nextClips = nextLane?.clips ?? [];
    const after = nextClips.find(
      (clip) => clip.timelineStartSec >= editor.playheadSec,
    );
    const nextSelectionClipId =
      after?.id ?? nextClips[nextClips.length - 1]?.id ?? null;

    if (nextSelectionClipId != null) {
      this.tracksEditor.setSelection({
        laneIndex,
        clipId: nextSelectionClipId,
      });
      return;
    }

    this.tracksEditor.clearSelection();
  }

  ensureValidEditorSelection(): void {
    const document = this.tracksDocument.document.get();
    const selection = this.tracksEditor.editor.get().selection;

    if (this.findClipBySelection(document, selection) != null) {
      return;
    }

    for (let lane = 0; lane < document.lanes.length; lane++) {
      const first = document.lanes[lane]?.clips[0] ?? null;
      if (first != null) {
        this.tracksEditor.setSelection({ laneIndex: lane, clipId: first.id });
        return;
      }
    }

    this.tracksEditor.clearSelection();
  }

  beginExport(): void {
    this.setTracksExport((current) => ({
      ...current,
      exporting: true,
      progress: 0,
      format: null,
      mimeType: null,
    }));
  }

  updateExportProgress(progress: number): void {
    const clamped = Math.min(1, Math.max(0, progress));
    this.setTracksExport((current) => ({
      ...current,
      progress: clamped,
    }));
  }

  completeExport(input: {
    url: string;
    format: ExportVideoFormat;
    mimeType: string;
  }): void {
    const { url, format, mimeType } = input;
    this.setTracksExport((current) => {
      const prevUrl = current.exportedUrl;
      if (prevUrl != null && prevUrl !== url) {
        URL.revokeObjectURL(prevUrl);
      }

      return {
        ...current,
        exporting: false,
        progress: 1,
        exportedUrl: url,
        format,
        mimeType,
      };
    });
  }

  failOrResetExport(): void {
    this.setTracksExport((current) => ({
      ...current,
      exporting: false,
      progress: 0,
      format: null,
      mimeType: null,
    }));
  }

  clearExportedUrl(): void {
    this.setTracksExport((current) => {
      const prevUrl = current.exportedUrl;
      if (prevUrl != null) {
        URL.revokeObjectURL(prevUrl);
      }

      return {
        ...current,
        exportedUrl: null,
        format: null,
        mimeType: null,
      };
    });
  }

  redoPart(index: number): void {
    this.updatePartState(index, { status: "idle" });
    this.currentPartIndex.set(index);
    this.appScreen.set("recording");

    const removedTake = this.tracksDocument.clearLane(index);
    const selection = this.tracksEditor.editor.get().selection;
    if (selection.laneIndex === index) {
      this.tracksEditor.clearSelection();
      this.tracksEditor.setPlayhead(0);
    }

    if (removedTake != null) {
      URL.revokeObjectURL(removedTake.url);
      this.removeTakeRuntimeMedia(removedTake.id);
    }
  }

  getKeptBlobs(): (Blob | null)[] {
    return this.partStates
      .get()
      .map((state) => (state.status === "kept" ? state.blob : null));
  }

  setCalibrationOffset(correctionSec: number): void {
    this.latencyCorrectionSec.set(correctionSec);
    this.isCalibrated.set(true);
  }

  clearCalibration(): void {
    this.latencyCorrectionSec.set(0);
    this.isCalibrated.set(false);
  }

  resetSession(): void {
    const totalParts = this.totalPartsInput.get();

    this.currentPartIndex.set(0);
    this.partStates.set(createIdlePartStates(totalParts));
    this.permissionError.set(null);
    this.clearCalibration();

    const removedTakes = this.tracksDocument.reset(totalParts);
    for (const take of removedTakes) {
      URL.revokeObjectURL(take.url);
    }

    this.clearRuntimeTakeMedia();
    this.tracksEditor.reset();
    this.resetExportState();

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
    this.partStates.set(
      this.resizePartStates(this.partStates.get(), totalParts),
    );

    const clampedPartIndex = Math.min(
      Math.max(0, this.currentPartIndex.get()),
      Math.max(0, totalParts - 1),
    );
    this.currentPartIndex.set(clampedPartIndex);

    const removedTakes = this.tracksDocument.resizeForPartCount(totalParts);

    for (const take of removedTakes) {
      URL.revokeObjectURL(take.url);
      this.removeTakeRuntimeMedia(take.id);
    }

    const selection = this.tracksEditor.editor.get().selection;
    if (selection.laneIndex != null && selection.laneIndex >= totalParts) {
      this.tracksEditor.clearSelection();
    }
  }

  private resizePartStates(
    current: PartState[],
    totalParts: number,
  ): PartState[] {
    const next = current.slice(0, totalParts);
    while (next.length < totalParts) {
      next.push({ status: "idle" });
    }
    return next;
  }

  private findClipBySelection(
    document: TracksDocumentState,
    selection: TracksEditorSelection,
  ) {
    if (selection.laneIndex == null || selection.clipId == null) {
      return null;
    }
    const lane = document.lanes[selection.laneIndex] ?? null;
    if (lane == null) return null;
    return lane.clips.find((clip) => clip.id === selection.clipId) ?? null;
  }

  private resetExportState(): void {
    const prevUrl = this.tracksExport.get().exportedUrl;
    if (prevUrl != null) {
      URL.revokeObjectURL(prevUrl);
    }
    this.tracksExport.set(createEmptyExportState());
  }

  private setTracksExport(
    updater: (current: ExportState) => ExportState,
  ): void {
    const current = this.tracksExport.get();
    const next = updater(current);
    if (next !== current) {
      this.tracksExport.set(next);
    }
  }

  private makeTakeId(): string {
    this.nextTakeId += 1;
    return `take-${this.nextTakeId}`;
  }
}

export function Model(): AppModel {
  return new AppModel();
}

export const model = Model();
