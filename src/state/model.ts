import { Derived, Observable } from "../observable";
import type { Chord, HarmonyVoicing, PartIndex } from "../music/types";
import type { Mixer } from "../audio/mixer";
import type { CompositorHandle } from "../video/compositor";
import { buildWaveformPeaks } from "../ui/timeline";
import {
  computeArrangementInfo,
  createDefaultArrangementDocState,
} from "./arrangementModel";
import { createShortUuid } from "./id";
import { findIncompletePartIndex } from "./recordingProgress";
import type {
  ArrangementDocState,
  ArrangementInfo as DerivedArrangementInfo,
  TotalPartCount,
} from "./arrangementModel";
import {
  TracksDocumentModel,
  TracksEditorModel,
  type ApplyClipVolumeBrushInput,
  type ClipId,
  type MediaAssetId,
  type RecordingId,
  type RecordingRecord,
  type TrackClip,
  type TrackId,
  type TrackRecord,
  type TracksDocumentState,
  type TracksEditorSelection,
  type TracksEditorState,
} from "./tracksModel";
import { DraftSessionController } from "./draftSessionController";

type WaveformPeaks = number[];

export type {
  ApplyClipVolumeBrushInput,
  ClipId,
  MediaAssetId,
  RecordingId,
  RecordingRecord,
  TrackClip,
  TrackId,
  TrackRecord,
  TracksDocumentState,
  TracksEditorSelection,
  TracksEditorState,
} from "./tracksModel";

export type {
  ArrangementChord,
  HarmonySpan,
  ArrangementDocState,
  ArrangementInfo,
  ArrangementMeasure,
  TotalPartCount,
} from "./arrangementModel";

export type ExportVideoFormat = "mp4" | "webm";

export type ExportPreferences = {
  preferredFormat: ExportVideoFormat | null;
};

export type RecordingMonitorPreferences = {
  guideToneVolume: number;
  beatVolume: number;
  priorHarmonyVolume: number;
};

export type HumDocument = {
  arrangement: ArrangementDocState;
  tracks: TracksDocumentState;
  exportPreferences: ExportPreferences;
  recordingMonitorPreferences: RecordingMonitorPreferences;
};

export type ExportState = {
  exporting: boolean;
  progress: number;
  exportedUrl: string | null;
  format: ExportVideoFormat | null;
  mimeType: string | null;
};

export type AppScreen = "setup" | "calibration" | "recording" | "review";

export type KeepTakeInput = {
  trackId: TrackId;
  blob: Blob;
  alignmentOffsetSec: number;
};

export type RuntimeRecordingMediaIngestInput = {
  recordingId: RecordingId;
  mediaAssetId: MediaAssetId;
  ctx: AudioContext;
  videoEl: HTMLVideoElement;
  waveformBuckets?: number;
  waveformBucketsPerSec?: number;
};

export type RecordingSourceWindow = {
  sourceStartSec: number;
  durationSec: number;
};

export type RecordingRuntimeWaveform = {
  peaks: WaveformPeaks;
  sourceWindow: RecordingSourceWindow;
} | null;

function createDefaultExportPreferences(): ExportPreferences {
  return {
    preferredFormat: null,
  };
}

function createDefaultRecordingMonitorPreferences(): RecordingMonitorPreferences {
  return {
    guideToneVolume: 1,
    beatVolume: 1,
    priorHarmonyVolume: 1,
  };
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

type ResolvedClipTiming = {
  timelineStartSec: number;
  sourceStartSec: number;
  durationSec: number;
};

function resolveCommittedClipTiming(
  alignmentOffsetSec: number,
  baseDurationSec: number,
): ResolvedClipTiming {
  const safeAlignmentOffsetSec = Number.isFinite(alignmentOffsetSec)
    ? alignmentOffsetSec
    : 0;
  const safeBaseDurationSec = Math.max(0, baseDurationSec);
  const timelineStartSec = Math.max(0, -safeAlignmentOffsetSec);
  const sourceStartSec = Math.max(0, safeAlignmentOffsetSec);
  const durationSec = Math.max(0, safeBaseDurationSec - timelineStartSec);

  return {
    timelineStartSec,
    sourceStartSec,
    durationSec,
  };
}

class AppModel {
  private mediaBlobsByAssetId = new Map<MediaAssetId, Blob>();
  private objectUrlsByAssetId = new Map<MediaAssetId, string>();
  private audioBuffersByRecordingId = new Map<RecordingId, AudioBuffer>();
  private waveformPeaksByRecordingId = new Map<RecordingId, WaveformPeaks>();
  private videoElByRecordingId = new Map<RecordingId, HTMLVideoElement>();
  private recordingSourceWindowByRecordingId = new Map<
    RecordingId,
    RecordingSourceWindow
  >();
  private readonly draftSession = new DraftSessionController({
    getSnapshot: () => ({
      document: this.getHumDocument(),
    }),
    applyRestoredDraft: (input) => {
      this.arrangementDocument.set(input.document.arrangement);
      this.tracksDocument.replaceDocument(input.document.tracks);
      this.exportPreferences.set(input.document.exportPreferences);
      this.recordingMonitorPreferences.set(
        input.document.recordingMonitorPreferences,
      );
      this.returnToReviewAfterRecording.set(false);
      this.hasRestoredDraft.set(true);
      for (const mediaAsset of input.mediaAssets) {
        this.registerMediaAsset(mediaAsset.mediaAssetId, mediaAsset.blob);
      }
      this.applyRestoredSessionState(input.document);
    },
    onBootstrapped: () => {
      this.bootstrapped.set(true);
    },
    onHasDraftChange: (hasDraft) => {
      this.hasRestoredDraft.set(hasDraft);
    },
  });

  readonly arrangementDocument = new Observable<ArrangementDocState>(
    createDefaultArrangementDocState(),
  );

  readonly exportPreferences = new Observable<ExportPreferences>(
    createDefaultExportPreferences(),
  );
  readonly recordingMonitorPreferences =
    new Observable<RecordingMonitorPreferences>(
      createDefaultRecordingMonitorPreferences(),
    );
  readonly bootstrapped = new Observable<boolean>(false);
  readonly hasRestoredDraft = new Observable<boolean>(false);

  readonly appScreen = new Observable<AppScreen>("setup");
  readonly mediaStream = new Observable<MediaStream | null>(null);
  readonly audioContext = new Observable<AudioContext | null>(null);
  readonly currentPartIndex = new Observable<PartIndex>(0);
  readonly returnToReviewAfterRecording = new Observable<boolean>(false);
  readonly permissionError = new Observable<string | null>(null);
  readonly latencyCorrectionSec = new Observable<number>(0);
  readonly isCalibrated = new Observable<boolean>(false);
  readonly selectedMicId = new Observable<string | null>(null);

  readonly derivedArrangementInfo = new Derived<DerivedArrangementInfo>(
    () => computeArrangementInfo(this.arrangementDocument.get()),
    [this.arrangementDocument],
    { checkForEqualityOnNotify: false },
  );

  readonly tracksExport = new Observable<ExportState>(createEmptyExportState());

  mixer: Mixer | null = null;
  compositor: CompositorHandle | null = null;

  readonly tracksDocument = new TracksDocumentModel({
    totalParts: this.arrangementDocument.get().totalParts,
    getMixer: () => this.mixer,
  });

  readonly tracksEditor = new TracksEditorModel();

  readonly parsedChords = new Derived<Chord[]>(
    () => this.derivedArrangementInfo.get().parsedChords,
    [this.derivedArrangementInfo],
    { checkForEqualityOnNotify: false },
  );

  readonly harmonyVoicingLegacy = new Derived<HarmonyVoicing | null>(
    () => this.derivedArrangementInfo.get().harmonyVoicingLegacy,
    [this.derivedArrangementInfo],
    { checkForEqualityOnNotify: false },
  );

  readonly effectiveHarmonyVoicing = new Derived<HarmonyVoicing | null>(
    () => this.derivedArrangementInfo.get().effectiveHarmonyVoicing,
    [this.derivedArrangementInfo],
    { checkForEqualityOnNotify: false },
  );

  readonly harmonyVoicingDynamic = new Derived<HarmonyVoicing | null>(
    () => this.derivedArrangementInfo.get().harmonyVoicingDynamic,
    [this.derivedArrangementInfo],
    { checkForEqualityOnNotify: false },
  );

  readonly selectedHarmonyVoicing = new Derived<HarmonyVoicing | null>(
    () => this.derivedArrangementInfo.get().selectedHarmonyVoicing,
    [this.derivedArrangementInfo],
    { checkForEqualityOnNotify: false },
  );

  constructor() {
    this.arrangementDocument.onAfterChange((prev, next) => {
      if (prev.totalParts !== next.totalParts) {
        this.resizePartCount(next.totalParts);
      }
    });

    this.arrangementDocument.onAfterChange(() => {
      this.draftSession.handleStateChanged();
    });
    this.exportPreferences.onAfterChange(() => {
      this.draftSession.handleStateChanged();
    });
    this.recordingMonitorPreferences.onAfterChange(() => {
      this.draftSession.handleStateChanged();
    });
    this.tracksDocument.document.onAfterChange(() => {
      this.draftSession.handleStateChanged();
    });
    if (typeof window !== "undefined" && "AudioContext" in window) {
      this.audioContext.set(new AudioContext());
    }

    void this.restoreDraftOnBoot();
  }

  setArrangementInput(patch: Partial<ArrangementDocState>): void {
    const next = {
      ...this.arrangementDocument.get(),
      ...patch,
    };
    const nextInfo = computeArrangementInfo(next);
    if (next.customArrangement != null && !nextInfo.hasCustomHarmony) {
      next.customArrangement = null;
    }
    this.arrangementDocument.set(next);
  }

  setExportPreferences(patch: Partial<ExportPreferences>): void {
    this.exportPreferences.set({
      ...this.exportPreferences.get(),
      ...patch,
    });
  }

  setRecordingMonitorPreferences(
    patch: Partial<RecordingMonitorPreferences>,
  ): void {
    this.recordingMonitorPreferences.set({
      ...this.recordingMonitorPreferences.get(),
      ...patch,
    });
  }

  getHumDocument(): HumDocument {
    return {
      arrangement: this.arrangementDocument.get(),
      tracks: this.tracksDocument.document.get(),
      exportPreferences: this.exportPreferences.get(),
      recordingMonitorPreferences: this.recordingMonitorPreferences.get(),
    };
  }

  getTrackIdForPartIndex(index: number): TrackId | null {
    return this.tracksDocument.getTrackIdAtIndex(index);
  }

  getNextIncompletePartIndex(startIndex = 0): PartIndex | null {
    return findIncompletePartIndex(this.tracksDocument.document.get(), startIndex);
  }

  keepRecordedTake(input: KeepTakeInput): void {
    const { trackId, blob, alignmentOffsetSec } = input;
    const recordingId = this.makeRecordingId();
    const mediaAssetId = this.makeMediaAssetId();

    this.registerMediaAsset(mediaAssetId, blob);
    void this.draftSession.persistMediaAsset(mediaAssetId, blob);

    const recording: RecordingRecord = {
      id: recordingId,
      trackId,
      mediaAssetId,
    };

    const arrangement = this.derivedArrangementInfo.get();
    const clipTiming = resolveCommittedClipTiming(
      alignmentOffsetSec,
      arrangement.progressionDurationSec,
    );
    const { removedRecordings, clipId } = this.tracksDocument.stageCommittedRecording({
      trackId,
      recording,
      timelineStartSec: clipTiming.timelineStartSec,
      sourceStartSec: clipTiming.sourceStartSec,
      durationSec: clipTiming.durationSec,
    });

    if (clipId != null) {
      this.tracksEditor.setSelection({
        trackId,
        clipId,
      });
    }

    if (this.returnToReviewAfterRecording.get()) {
      this.returnToReviewAfterRecording.set(false);
    }

    for (const removed of removedRecordings) {
      this.releaseRecording(removed);
    }
  }

  async ingestRecordingRuntimeMedia(
    input: RuntimeRecordingMediaIngestInput,
  ): Promise<boolean> {
    const {
      recordingId,
      mediaAssetId,
      ctx,
      videoEl,
      waveformBuckets,
      waveformBucketsPerSec = 72,
    } = input;

    const blob = this.mediaBlobsByAssetId.get(mediaAssetId) ?? null;
    if (blob == null) return false;

    this.videoElByRecordingId.set(recordingId, videoEl);

    const raw = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(raw);

    const recording = this.tracksDocument.getRecording(recordingId);
    if (recording == null || recording.mediaAssetId !== mediaAssetId) return false;
    const durationSec = Math.max(0, decoded.duration);

    this.audioBuffersByRecordingId.set(recordingId, decoded);
    this.recordingSourceWindowByRecordingId.set(recordingId, {
      sourceStartSec: 0,
      durationSec,
    });

    const computedBuckets =
      waveformBuckets ??
      Math.max(
        64,
        Math.min(
          4096,
          Math.round(durationSec * Math.max(16, waveformBucketsPerSec)),
        ),
      );
    this.waveformPeaksByRecordingId.set(
      recordingId,
      buildWaveformPeaks(decoded, 0, durationSec, computedBuckets),
    );

    return true;
  }

  getRecordingBlob(recordingId: RecordingId): Blob | null {
    const recording = this.tracksDocument.getRecording(recordingId);
    if (recording == null) return null;
    return this.mediaBlobsByAssetId.get(recording.mediaAssetId) ?? null;
  }

  getRecordingUrl(recordingId: RecordingId): string | null {
    const recording = this.tracksDocument.getRecording(recordingId);
    if (recording == null) return null;
    return this.objectUrlsByAssetId.get(recording.mediaAssetId) ?? null;
  }

  getRecordingAudioBuffer(recordingId: RecordingId): AudioBuffer | null {
    return this.audioBuffersByRecordingId.get(recordingId) ?? null;
  }

  getRecordingWaveform(recordingId: RecordingId): WaveformPeaks | null {
    return this.waveformPeaksByRecordingId.get(recordingId) ?? null;
  }

  getRecordingSourceWindow(recordingId: RecordingId): RecordingSourceWindow | null {
    return this.recordingSourceWindowByRecordingId.get(recordingId) ?? null;
  }

  getRecordingVideoElement(recordingId: RecordingId): HTMLVideoElement | null {
    return this.videoElByRecordingId.get(recordingId) ?? null;
  }

  getRecordingRuntimeWaveform(
    recordingId: RecordingId,
  ): RecordingRuntimeWaveform {
    const peaks = this.getRecordingWaveform(recordingId);
    const sourceWindow = this.getRecordingSourceWindow(recordingId);
    if (peaks == null || sourceWindow == null) return null;

    return {
      peaks,
      sourceWindow,
    };
  }

  clearDecodedRuntimeMedia(): void {
    this.audioBuffersByRecordingId.clear();
    this.waveformPeaksByRecordingId.clear();
    this.videoElByRecordingId.clear();
    this.recordingSourceWindowByRecordingId.clear();
  }

  splitSelectedClipAtPlayhead(): void {
    const editor = this.tracksEditor.editor.get();
    const { trackId, clipId } = editor.selection;
    if (trackId == null || clipId == null) return;

    const result = this.tracksDocument.splitClipAtTime({
      trackId,
      clipId,
      splitTimeSec: editor.playheadSec,
    });

    if (result != null) {
      this.tracksEditor.setSelection({
        trackId,
        clipId: result.rightClipId,
      });
    }
  }

  deleteSelectedClip(): void {
    const editor = this.tracksEditor.editor.get();
    const { trackId, clipId } = editor.selection;
    if (trackId == null || clipId == null) return;

    const { deleted, removedRecordings } = this.tracksDocument.deleteClip({
      trackId,
      clipId,
    });
    if (!deleted) return;

    for (const removed of removedRecordings) {
      this.releaseRecording(removed);
    }

    const nextClips = this.tracksDocument.getOrderedClipsForTrack(trackId);
    const after = nextClips.find(
      (clip) => clip.timelineStartSec >= editor.playheadSec,
    );
    const nextSelectionClipId =
      after?.id ?? nextClips[nextClips.length - 1]?.id ?? null;

    if (nextSelectionClipId != null) {
      this.tracksEditor.setSelection({
        trackId,
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

    for (const trackId of document.trackOrder) {
      const firstClip = this.tracksDocument.getOrderedClipsForTrack(trackId)[0] ?? null;
      if (firstClip != null) {
        this.tracksEditor.setSelection({ trackId, clipId: firstClip.id });
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

  openRecordingForPart(index: number): void {
    const trackId = this.tracksDocument.getTrackIdAtIndex(index);
    if (trackId == null) return;

    this.returnToReviewAfterRecording.set(true);
    this.currentPartIndex.set(index);
    this.appScreen.set("recording");
  }

  cancelRecordingForPart(): void {
    if (!this.returnToReviewAfterRecording.get()) return;
    this.returnToReviewAfterRecording.set(false);
    this.appScreen.set("review");
  }

  setCalibrationOffset(correctionSec: number): void {
    this.latencyCorrectionSec.set(correctionSec);
    this.isCalibrated.set(true);
  }

  clearCalibration(): void {
    this.latencyCorrectionSec.set(0);
    this.isCalibrated.set(false);
  }

  setSelectedMicId(deviceId: string | null): void {
    this.selectedMicId.set(deviceId == null || deviceId === "" ? null : deviceId);
  }

  resetSession(): void {
    this.draftSession.clearDraftAfter(() => {
      const totalParts = this.arrangementDocument.get().totalParts;

      this.currentPartIndex.set(0);
      this.returnToReviewAfterRecording.set(false);
      this.permissionError.set(null);
      this.clearCalibration();
      this.appScreen.set("setup");

      const removedRecordings = this.tracksDocument.reset(totalParts);
      for (const removed of removedRecordings) {
        this.releaseRecording(removed);
      }

      this.clearDecodedRuntimeMedia();
      this.tracksEditor.reset();
      this.resetExportState();

      this.mixer?.dispose();
      this.mixer = null;

      this.compositor?.stop();
      this.compositor = null;
    });
  }

  async ensureAudioContext(): Promise<AudioContext | null> {
    if (typeof window === "undefined" || !("AudioContext" in window)) {
      return null;
    }

    let ctx = this.audioContext.get();
    if (ctx == null) {
      ctx = new AudioContext();
      this.audioContext.set(ctx);
    }
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    return ctx;
  }

  private registerMediaAsset(mediaAssetId: MediaAssetId, blob: Blob): void {
    const previousUrl = this.objectUrlsByAssetId.get(mediaAssetId);
    if (previousUrl != null) {
      URL.revokeObjectURL(previousUrl);
    }

    this.mediaBlobsByAssetId.set(mediaAssetId, blob);
    this.objectUrlsByAssetId.set(mediaAssetId, URL.createObjectURL(blob));
  }

  private releaseRecording(recording: RecordingRecord): void {
    this.removeRecordingRuntimeMedia(recording.id);

    const stillReferenced = Object.values(
      this.tracksDocument.document.get().recordingsById,
    ).some((candidate) => candidate.mediaAssetId === recording.mediaAssetId);

    if (!stillReferenced) {
      const url = this.objectUrlsByAssetId.get(recording.mediaAssetId);
      if (url != null) {
        URL.revokeObjectURL(url);
      }
      this.objectUrlsByAssetId.delete(recording.mediaAssetId);
      this.mediaBlobsByAssetId.delete(recording.mediaAssetId);
      void this.draftSession.deleteMediaAsset(recording.mediaAssetId);
    }
  }

  private removeRecordingRuntimeMedia(recordingId: RecordingId): void {
    this.audioBuffersByRecordingId.delete(recordingId);
    this.waveformPeaksByRecordingId.delete(recordingId);
    this.videoElByRecordingId.delete(recordingId);
    this.recordingSourceWindowByRecordingId.delete(recordingId);
  }

  private resizePartCount(totalParts: number): void {
    const clampedPartIndex = Math.min(
      Math.max(0, this.currentPartIndex.get()),
      Math.max(0, totalParts - 1),
    );
    this.currentPartIndex.set(clampedPartIndex);

    const removedRecordings = this.tracksDocument.resizeForPartCount(totalParts);
    for (const removed of removedRecordings) {
      this.releaseRecording(removed);
    }

    const selection = this.tracksEditor.editor.get().selection;
    if (
      selection.trackId != null &&
      this.tracksDocument.getTrack(selection.trackId) == null
    ) {
      this.tracksEditor.clearSelection();
    }
  }

  private findClipBySelection(
    document: TracksDocumentState,
    selection: TracksEditorSelection,
  ): TrackClip | null {
    if (selection.trackId == null || selection.clipId == null) {
      return null;
    }
    const clip = document.clipsById[selection.clipId] ?? null;
    if (clip == null || clip.trackId !== selection.trackId) {
      return null;
    }
    return clip;
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

  private makeRecordingId(): RecordingId {
    return `recording-${createShortUuid()}`;
  }

  private makeMediaAssetId(): MediaAssetId {
    return `media-asset-${createShortUuid()}`;
  }

  private async restoreDraftOnBoot(): Promise<void> {
    const restored = await this.draftSession.restoreOnBoot();
    if (restored == null) return;
  }

  private applyRestoredSessionState(document: HumDocument): void {
    const nextPartIndex = findIncompletePartIndex(document.tracks) ?? 0;
    this.currentPartIndex.set(nextPartIndex);
    this.appScreen.set(hasAnyTake(document) ? "review" : "setup");
  }
}

function hasAnyTake(document: HumDocument): boolean {
  return Object.keys(document.tracks.recordingsById).length > 0;
}

export function Model(): AppModel {
  return new AppModel();
}

export const model = Model();
