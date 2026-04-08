import type { PartIndex } from "../music/types";
import type { ClipVolumeEnvelope } from "./clipAutomation";
import type {
  AppScreen,
  ArrangementDocState,
  ExportPreferences,
  HumDocument,
  TracksDocumentState,
} from "./model";
import {
  SAVED_HUM_DOCUMENT_ID,
  SAVED_HUM_DOCUMENT_SCHEMA_VERSION,
  type SavedArrangementDocument,
  type SavedAppScreen,
  type SavedClip,
  type SavedClipVolumeEnvelope,
  type SavedExportPreferences,
  type SavedHumDocument,
  type SavedRecording,
  type SavedTrack,
  type SavedTracksDocument,
} from "./savedDocumentSchema";

export type DraftSnapshot = {
  document: HumDocument;
  currentPartIndex: number;
  appScreen: AppScreen;
  latencyCorrectionSec: number;
  isCalibrated: boolean;
  selectedMicId: string | null;
};

export type DeserializedDraftSnapshot = {
  document: HumDocument;
  currentPartIndex: PartIndex;
  appScreen: AppScreen;
  latencyCorrectionSec: number;
  isCalibrated: boolean;
  selectedMicId: string | null;
};

export function serializeHumDocument(input: DraftSnapshot): SavedHumDocument {
  return {
    schemaVersion: SAVED_HUM_DOCUMENT_SCHEMA_VERSION,
    id: SAVED_HUM_DOCUMENT_ID,
    arrangement: serializeArrangementDocument(input.document.arrangement),
    tracks: serializeTracksDocument(input.document.tracks),
    exportPreferences: serializeExportPreferences(
      input.document.exportPreferences,
    ),
    currentPartIndex: Math.max(0, Math.floor(input.currentPartIndex)),
    appScreen: serializeAppScreen(input.appScreen),
    latencyCorrectionSec: input.latencyCorrectionSec,
    isCalibrated: input.isCalibrated,
    selectedMicId: input.selectedMicId,
  };
}

export function deserializeHumDocument(
  saved: SavedHumDocument,
): DeserializedDraftSnapshot {
  return {
    document: {
      arrangement: deserializeArrangementDocument(saved.arrangement),
      tracks: deserializeTracksDocument(saved.tracks),
      exportPreferences: deserializeExportPreferences(saved.exportPreferences),
    },
    currentPartIndex: clampPartIndex(saved.currentPartIndex),
    appScreen: deserializeAppScreen(saved.appScreen),
    latencyCorrectionSec: saved.latencyCorrectionSec,
    isCalibrated: saved.isCalibrated,
    selectedMicId: saved.selectedMicId ?? null,
  };
}

function clampPartIndex(value: number): PartIndex {
  return value <= 0 ? 0 : value >= 3 ? 3 : (Math.floor(value) as PartIndex);
}

function serializeAppScreen(screen: AppScreen): SavedAppScreen {
  return screen;
}

function deserializeAppScreen(screen: SavedAppScreen): AppScreen {
  return screen;
}

function serializeArrangementDocument(
  arrangement: ArrangementDocState,
): SavedArrangementDocument {
  return {
    chordsInput: arrangement.chordsInput,
    tempo: arrangement.tempo,
    meter: [arrangement.meter[0], arrangement.meter[1]],
    vocalRangeLow: arrangement.vocalRangeLow,
    vocalRangeHigh: arrangement.vocalRangeHigh,
    harmonyRangeCoverage: arrangement.harmonyRangeCoverage,
    selectedHarmonyGenerator: arrangement.selectedHarmonyGenerator,
    totalParts: arrangement.totalParts,
    customHarmony:
      arrangement.customHarmony == null
        ? null
        : {
            lines: arrangement.customHarmony.lines.map((line) => [...line]),
          },
  };
}

function deserializeArrangementDocument(
  saved: SavedArrangementDocument,
): ArrangementDocState {
  return {
    chordsInput: saved.chordsInput,
    tempo: saved.tempo,
    meter: [saved.meter[0], saved.meter[1]],
    vocalRangeLow: saved.vocalRangeLow,
    vocalRangeHigh: saved.vocalRangeHigh,
    harmonyRangeCoverage: saved.harmonyRangeCoverage,
    selectedHarmonyGenerator: saved.selectedHarmonyGenerator ?? "dynamic",
    totalParts: saved.totalParts,
    customHarmony:
      saved.customHarmony == null
        ? null
        : {
            lines: saved.customHarmony.lines.map((line) => [...line]),
          },
  };
}

function serializeExportPreferences(
  exportPreferences: ExportPreferences,
): SavedExportPreferences {
  return {
    preferredFormat: exportPreferences.preferredFormat,
  };
}

function deserializeExportPreferences(
  saved: SavedExportPreferences,
): ExportPreferences {
  return {
    preferredFormat: saved.preferredFormat,
  };
}

function serializeTracksDocument(
  tracks: TracksDocumentState,
): SavedTracksDocument {
  const tracksById: Record<string, SavedTrack> = {};
  for (const [trackId, track] of Object.entries(tracks.tracksById)) {
    tracksById[trackId] = {
      id: track.id,
      role: track.role,
      clipIds: [...track.clipIds],
      volume: track.volume,
      muted: track.muted,
    };
  }

  const clipsById: Record<string, SavedClip> = {};
  for (const [clipId, clip] of Object.entries(tracks.clipsById)) {
    clipsById[clipId] = {
      id: clip.id,
      trackId: clip.trackId,
      recordingId: clip.recordingId,
      timelineStartSec: clip.timelineStartSec,
      sourceStartSec: clip.sourceStartSec,
      durationSec: clip.durationSec,
      volumeEnvelope: serializeVolumeEnvelope(clip.volumeEnvelope),
    };
  }

  const recordingsById: Record<string, SavedRecording> = {};
  for (const [recordingId, recording] of Object.entries(
    tracks.recordingsById,
  )) {
    recordingsById[recordingId] = {
      id: recording.id,
      trackId: recording.trackId,
      mediaAssetId: recording.mediaAssetId,
      trimOffsetSec: recording.trimOffsetSec,
    };
  }

  return {
    trackOrder: [...tracks.trackOrder],
    tracksById,
    clipsById,
    recordingsById,
    reverbWet: tracks.reverbWet,
  };
}

function deserializeTracksDocument(
  saved: SavedTracksDocument,
): TracksDocumentState {
  const tracksById = Object.fromEntries(
    Object.entries(saved.tracksById).map(([trackId, track]) => [
      trackId,
      {
        id: track.id,
        role: track.role,
        clipIds: [...track.clipIds],
        volume: track.volume,
        muted: track.muted,
      },
    ]),
  );

  const clipsById = Object.fromEntries(
    Object.entries(saved.clipsById).map(([clipId, clip]) => [
      clipId,
      {
        id: clip.id,
        trackId: clip.trackId,
        recordingId: clip.recordingId,
        timelineStartSec: clip.timelineStartSec,
        sourceStartSec: clip.sourceStartSec,
        durationSec: clip.durationSec,
        volumeEnvelope: deserializeVolumeEnvelope(clip.volumeEnvelope),
        volumeEnvelopeRevision: 0,
      },
    ]),
  );

  const recordingsById = Object.fromEntries(
    Object.entries(saved.recordingsById).map(([recordingId, recording]) => [
      recordingId,
      {
        id: recording.id,
        trackId: recording.trackId,
        mediaAssetId: recording.mediaAssetId,
        trimOffsetSec: recording.trimOffsetSec,
      },
    ]),
  );

  return {
    trackOrder: [...saved.trackOrder],
    tracksById,
    clipsById,
    recordingsById,
    reverbWet: saved.reverbWet,
  };
}

function serializeVolumeEnvelope(
  volumeEnvelope: ClipVolumeEnvelope,
): SavedClipVolumeEnvelope {
  return {
    points: volumeEnvelope.points.map((point) => ({
      id: point.id,
      timeSec: point.timeSec,
      gainMultiplier: point.gainMultiplier,
    })),
  };
}

function deserializeVolumeEnvelope(
  saved: SavedClipVolumeEnvelope,
): ClipVolumeEnvelope {
  return {
    points: saved.points.map((point) => ({
      id: point.id,
      timeSec: point.timeSec,
      gainMultiplier: point.gainMultiplier,
    })),
  };
}
