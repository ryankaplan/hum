import { model } from "./model";

export type {
  AppScreen,
  ArrangementDocState,
  ArrangementInfo,
  ClipId,
  ExportPreferences,
  ExportState,
  HumDocument,
  KeepTakeInput,
  MediaAssetId,
  RecordingMonitorPreferences,
  RecordingId,
  RecordingRecord,
  RecordingRuntimeWaveform,
  RecordingSourceWindow,
  RuntimeRecordingMediaIngestInput,
  TotalPartCount,
  TrackClip,
  TrackId,
  TrackRecord,
  TracksDocumentState,
  TracksEditorSelection,
  TracksEditorState,
} from "./model";

export const appScreen = model.appScreen;
export const bootstrapped = model.bootstrapped;
export const hasRestoredDraft = model.hasRestoredDraft;
export const mediaStream = model.mediaStream;
export const audioContext = model.audioContext;
export const currentPartIndex = model.currentPartIndex;
export const permissionError = model.permissionError;
export const latencyCorrectionSec = model.latencyCorrectionSec;
export const isCalibrated = model.isCalibrated;

export const arrangementDocument = model.arrangementDocument;
export const arrangementInfo = model.derivedArrangementInfo;
export const parsedChords = model.parsedChords;
export const harmonyVoicingLegacy = model.harmonyVoicingLegacy;
export const effectiveHarmonyVoicing = model.effectiveHarmonyVoicing;
export const harmonyVoicingDynamic = model.harmonyVoicingDynamic;
export const selectedHarmonyVoicing = model.selectedHarmonyVoicing;
export const exportPreferences = model.exportPreferences;
export const recordingMonitorPreferences = model.recordingMonitorPreferences;

export const tracksDocument = model.tracksDocument.document;
export const tracksEditor = model.tracksEditor.editor;
export const tracksExport = model.tracksExport;

export function keepRecordedTake(
  input: Parameters<typeof model.keepRecordedTake>[0],
): void {
  model.keepRecordedTake(input);
}

export function redoPart(index: number): void {
  model.openRecordingForPart(index);
}

export function resetSession(): void {
  model.resetSession();
}
