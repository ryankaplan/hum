import { model } from "./model";

export type {
  AppScreen,
  ArrangementInfo,
  LaneRuntimeWaveform,
  KeepTakeInput,
  PartState,
  RuntimeTakeMediaIngestInput,
  TakeSourceWindow,
  TotalPartCount,
  TrackClip,
  TrackEditorSelection,
  TrackLane,
  TracksState,
} from "./model";

export const appScreen = model.appScreen;
export const mediaStream = model.mediaStream;
export const audioContext = model.audioContext;
export const currentPartIndex = model.currentPartIndex;
export const permissionError = model.permissionError;

export const chordsInput = model.chordsInput;
export const tempoInput = model.tempoInput;
export const meterInput = model.meterInput;
export const vocalRangeLow = model.vocalRangeLow;
export const vocalRangeHigh = model.vocalRangeHigh;
export const totalPartsInput = model.totalPartsInput;

export const arrangementInfo = model.arrangementInfo;
export const parsedChords = model.parsedChords;
export const harmonyVoicing = model.harmonyVoicing;

export const partStates = model.partStates;
export const tracks = model.tracks;

export function updatePartState(index: number, state: Parameters<typeof model.updatePartState>[1]): void {
  model.updatePartState(index, state);
}

export function keepRecordedTake(input: Parameters<typeof model.keepRecordedTake>[0]): void {
  model.keepRecordedTake(input);
}

export function redoPart(index: number): void {
  model.redoPart(index);
}

export function getKeptBlobs(): (Blob | null)[] {
  return model.getKeptBlobs();
}

export function resetSession(): void {
  model.resetSession();
}
