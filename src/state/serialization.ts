import type { ClipVolumeEnvelope } from "./clipAutomation";
import type {
  ArrangementDocState,
  HumDocument,
  TracksDocumentState,
} from "./model";
import {
  SAVED_HUM_DOCUMENT_ID,
  SAVED_HUM_DOCUMENT_SCHEMA_VERSION,
  type SavedArrangementDocument,
  type SavedClip,
  type SavedClipVolumeEnvelope,
  type SavedHumDocument,
  type SavedRecording,
  type SavedTrack,
  type SavedTracksDocument,
} from "./savedDocumentSchema";

export type DraftSnapshot = {
  document: HumDocument;
};

export type DeserializedDraftSnapshot = {
  document: HumDocument;
};

export function serializeHumDocument(input: DraftSnapshot): SavedHumDocument {
  return {
    schemaVersion: SAVED_HUM_DOCUMENT_SCHEMA_VERSION,
    id: SAVED_HUM_DOCUMENT_ID,
    arrangement: serializeArrangementDocument(input.document.arrangement),
    tracks: serializeTracksDocument(input.document.tracks),
  };
}

export function deserializeHumDocument(
  saved: SavedHumDocument,
): DeserializedDraftSnapshot {
  return {
    document: {
      arrangement: deserializeArrangementDocument(saved.arrangement),
      tracks: deserializeTracksDocument(saved.tracks),
    },
  };
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
    harmonyPriority: arrangement.harmonyPriority,
    totalParts: arrangement.totalParts,
    customArrangement:
      arrangement.customArrangement == null
        ? null
        : {
            voices: arrangement.customArrangement.voices.map((voice) => ({
              id: voice.id,
              events: voice.events.map((event) => ({
                id: event.id,
                startTick: event.startTick,
                durationTicks: event.durationTicks,
                midi: event.midi,
              })),
            })),
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
    harmonyPriority: saved.harmonyPriority,
    totalParts: saved.totalParts,
    customArrangement:
      saved.customArrangement == null
        ? null
        : {
            voices: saved.customArrangement.voices.map((voice) => ({
              id: voice.id,
              events: voice.events.map((event) => ({
                id: event.id,
                startTick: event.startTick,
                durationTicks: event.durationTicks,
                midi: event.midi,
              })),
            })),
          },
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
    };
  }

  return {
    trackOrder: [...tracks.trackOrder],
    tracksById,
    clipsById,
    recordingsById,
    referenceWaveformTrackId: tracks.referenceWaveformTrackId,
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
      },
    ]),
  );

  return {
    trackOrder: [...saved.trackOrder],
    tracksById,
    clipsById,
    recordingsById,
    referenceWaveformTrackId:
      saved.referenceWaveformTrackId != null &&
      tracksById[saved.referenceWaveformTrackId] != null
        ? saved.referenceWaveformTrackId
        : null,
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
