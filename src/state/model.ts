import { Derived, Observable, PersistedObservable } from "../observable";
import type { Chord, HarmonyVoicing, PartIndex } from "../music/types";
import type { Mixer } from "../audio/mixer";
import type { CompositorHandle } from "../video/compositor";
import { buildWaveformPeaks } from "../ui/timeline";
import {
  computeArrangementInfo,
  createDefaultArrangementDocState,
  parseArrangementDocState,
} from "./arrangementModel";
import { createShortUuid } from "./id";
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
  ArrangementDocState,
  ArrangementInfo,
  TotalPartCount,
} from "./arrangementModel";

export type ExportVideoFormat = "mp4" | "webm";

export type ExportPreferences = {
  preferredFormat: ExportVideoFormat | null;
};

export type HumDocument = {
  arrangement: ArrangementDocState;
  tracks: TracksDocumentState;
  exportPreferences: ExportPreferences;
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
  trimOffsetSec: number;
};

export type RuntimeRecordingMediaIngestInput = {
  recordingId: RecordingId;
  trackId: TrackId;
  mediaAssetId: MediaAssetId;
  trimOffsetSec: number;
  ctx: AudioContext;
  videoEl: HTMLVideoElement;
  maxDurationSec: number;
  waveformBuckets?: number;
  waveformBucketsPerSec?: number;
};

export type RecordingSourceWindow = {
  sourceStartSec: number;
  durationSec: number;
};

export type TrackRuntimeWaveform = {
  recordingId: RecordingId;
  peaks: WaveformPeaks;
  sourceWindow: RecordingSourceWindow;
} | null;

function createDefaultExportPreferences(): ExportPreferences {
  return {
    preferredFormat: null,
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

  readonly arrangementDocument = new PersistedObservable<ArrangementDocState>(
    "hum.arrangementDoc",
    createDefaultArrangementDocState(),
    { schema: parseArrangementDocState },
  );

  readonly exportPreferences = new Observable<ExportPreferences>(
    createDefaultExportPreferences(),
  );

  readonly appScreen = new Observable<AppScreen>("setup");
  readonly mediaStream = new Observable<MediaStream | null>(null);
  readonly audioContext = new Observable<AudioContext | null>(null);
  readonly currentPartIndex = new Observable<PartIndex>(0);
  readonly permissionError = new Observable<string | null>(null);
  readonly latencyCorrectionSec = new Observable<number>(0);
  readonly isCalibrated = new Observable<boolean>(false);

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

  readonly harmonyVoicing = new Derived<HarmonyVoicing | null>(
    () => this.derivedArrangementInfo.get().harmonyVoicing,
    [this.derivedArrangementInfo],
    { checkForEqualityOnNotify: false },
  );

  constructor() {
    this.arrangementDocument.onAfterChange((prev, next) => {
      if (prev.totalParts !== next.totalParts) {
        this.resizePartCount(next.totalParts);
      }
    });
  }

  setArrangementInput(patch: Partial<ArrangementDocState>): void {
    this.arrangementDocument.set({
      ...this.arrangementDocument.get(),
      ...patch,
    });
  }

  setExportPreferences(patch: Partial<ExportPreferences>): void {
    this.exportPreferences.set({
      ...this.exportPreferences.get(),
      ...patch,
    });
  }

  getHumDocument(): HumDocument {
    return {
      arrangement: this.arrangementDocument.get(),
      tracks: this.tracksDocument.document.get(),
      exportPreferences: this.exportPreferences.get(),
    };
  }

  getTrackIdForPartIndex(index: number): TrackId | null {
    return this.tracksDocument.getTrackIdAtIndex(index);
  }

  keepRecordedTake(input: KeepTakeInput): void {
    const { trackId, blob, trimOffsetSec } = input;
    const recordingId = this.makeRecordingId();
    const mediaAssetId = this.makeMediaAssetId();

    this.registerMediaAsset(mediaAssetId, blob);

    const recording: RecordingRecord = {
      id: recordingId,
      trackId,
      mediaAssetId,
      trimOffsetSec,
    };

    const arrangement = this.derivedArrangementInfo.get();
    const { removedRecordings, clipId } = this.tracksDocument.stageCommittedRecording({
      trackId,
      recording,
      sourceStartSec: Math.max(0, trimOffsetSec),
      durationSec: Math.max(0, arrangement.progressionDurationSec),
    });

    if (clipId != null) {
      this.tracksEditor.setSelection({
        trackId,
        clipId,
      });
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
      trackId,
      mediaAssetId,
      trimOffsetSec,
      ctx,
      videoEl,
      maxDurationSec,
      waveformBuckets,
      waveformBucketsPerSec = 72,
    } = input;

    const blob = this.mediaBlobsByAssetId.get(mediaAssetId) ?? null;
    if (blob == null) return false;

    this.videoElByRecordingId.set(recordingId, videoEl);

    const raw = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(raw);

    const recording = this.tracksDocument.getRecording(recordingId);
    if (recording == null || recording.trackId !== trackId) {
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

    this.audioBuffersByRecordingId.set(recordingId, decoded);
    this.recordingSourceWindowByRecordingId.set(recordingId, {
      sourceStartSec,
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
      buildWaveformPeaks(decoded, sourceStartSec, durationSec, computedBuckets),
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

  getTrackRuntimeWaveform(trackId: TrackId): TrackRuntimeWaveform {
    const recordingId = this.tracksDocument.getPrimaryRecordingIdForTrack(trackId);
    if (recordingId == null) return null;

    const peaks = this.getRecordingWaveform(recordingId);
    const sourceWindow = this.getRecordingSourceWindow(recordingId);
    if (peaks == null || sourceWindow == null) return null;

    return {
      recordingId,
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

  redoPart(index: number): void {
    const trackId = this.tracksDocument.getTrackIdAtIndex(index);
    if (trackId == null) return;

    this.currentPartIndex.set(index);
    this.appScreen.set("recording");

    const removedRecordings = this.tracksDocument.clearTrack(trackId);
    const selection = this.tracksEditor.editor.get().selection;
    if (selection.trackId === trackId) {
      this.tracksEditor.clearSelection();
      this.tracksEditor.setPlayhead(0);
    }

    for (const removed of removedRecordings) {
      this.releaseRecording(removed);
    }
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
    const totalParts = this.arrangementDocument.get().totalParts;

    this.currentPartIndex.set(0);
    this.permissionError.set(null);
    this.clearCalibration();

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
}

export function Model(): AppModel {
  return new AppModel();
}

export const model = Model();
