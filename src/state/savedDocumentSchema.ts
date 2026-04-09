/*
 * Saved Hum document file schema.
 *
 * This file defines the persisted shape we store in IndexedDB for the user's
 * in-progress draft. These types are intentionally separate from the runtime
 * app/model types. Treat them like a file format, not like internal app state.
 *
 * Why this exists:
 * - Runtime types can evolve to suit the app.
 * - Persisted types need a stable, explicit contract.
 * - Keeping a dedicated saved schema makes it obvious what is safe to write to
 *   disk and what must stay runtime-only.
 *
 * How to use this file:
 * - Add or change persisted fields here first.
 * - Update `serialization.ts` to convert between runtime types and these saved
 *   types.
 * - Update `draftPersistence.ts` only if the IndexedDB storage layout changes.
 * - Do not write runtime `HumDocument` objects directly to storage.
 *
 * Versioning policy:
 * - `SAVED_HUM_DOCUMENT_SCHEMA_VERSION` represents the whole saved draft format.
 * - Increment it whenever a previously saved draft could no longer be read back
 *   correctly with the current parser/serializer.
 * - Because this app does not support migrations for draft persistence, a
 *   version bump means old drafts are discarded on load.
 * - If you are only refactoring runtime code without changing the saved shape
 *   or semantics, do not increment the version.
 *
 * Good reasons to increment the version:
 * - Renaming, removing, or changing the meaning of persisted fields
 * - Changing nested saved object structure
 * - Changing how ids or relationships are interpreted
 * - Changing blob/document linkage in a way old drafts would not satisfy
 *
 * Things that should never be added here:
 * - MediaStream, AudioContext, object URLs, decoded buffers, DOM elements
 * - Temporary UI state like current preview/review blobs or editor selection
 * - Any other data that cannot survive a refresh independently
 *
 * Storage model:
 * - One `SavedHumDocument` row lives in the IndexedDB `documents` store
 * - Binary blobs live separately in the `mediaAssets` store
 * - `mediaAssetId` is the stable join key from saved recordings to blob rows
 *
 * Parsing rules:
 * - Parsers in this file validate unknown persisted data at the storage
 *   boundary.
 * - On parse failure or schema version mismatch, callers should clear the draft
 *   instead of trying to partially recover it.
 */
export const SAVED_HUM_DOCUMENT_SCHEMA_VERSION = "7";

export const SAVED_HUM_DOCUMENT_ID = "current";

export type SavedExportVideoFormat = "mp4" | "webm";
export type SavedAppScreen = "setup" | "calibration" | "recording" | "review";

export type SavedExportPreferences = {
  preferredFormat: SavedExportVideoFormat | null;
};

export type SavedArrangementDocument = {
  chordsInput: string;
  tempo: number;
  meter: [number, number];
  vocalRangeLow: string;
  vocalRangeHigh: string;
  harmonyRangeCoverage: "lower two thirds" | "whole-range";
  selectedHarmonyGenerator?: "legacy" | "dynamic";
  totalParts: 2 | 4;
  customHarmony: { lines: Array<Array<number | null>> } | null;
};

export type SavedVolumePoint = {
  id: string;
  timeSec: number;
  gainMultiplier: number;
};

export type SavedClipVolumeEnvelope = {
  points: SavedVolumePoint[];
};

export type SavedTrack = {
  id: string;
  role: "harmony" | "melody";
  clipIds: string[];
  volume: number;
  muted: boolean;
};

export type SavedClip = {
  id: string;
  trackId: string;
  recordingId: string;
  timelineStartSec: number;
  sourceStartSec: number;
  durationSec: number;
  volumeEnvelope: SavedClipVolumeEnvelope;
};

export type SavedRecording = {
  id: string;
  trackId: string;
  mediaAssetId: string;
};

export type SavedTracksDocument = {
  trackOrder: string[];
  tracksById: Record<string, SavedTrack>;
  clipsById: Record<string, SavedClip>;
  recordingsById: Record<string, SavedRecording>;
  reverbWet: number;
};

export type SavedHumDocument = {
  schemaVersion: string;
  id: string;
  arrangement: SavedArrangementDocument;
  tracks: SavedTracksDocument;
  exportPreferences: SavedExportPreferences;
  currentPartIndex: number;
  appScreen: SavedAppScreen;
};

export type SavedMediaAsset = {
  mediaAssetId: string;
  blob: Blob;
  mimeType: string;
  documentId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value != null && Array.isArray(value) === false
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function parseSavedExportPreferences(
  raw: unknown,
): SavedExportPreferences | null {
  if (!isRecord(raw)) return null;
  const preferredFormat = raw.preferredFormat;
  if (
    preferredFormat !== null &&
    preferredFormat !== "mp4" &&
    preferredFormat !== "webm"
  ) {
    return null;
  }
  return {
    preferredFormat: preferredFormat as SavedExportVideoFormat | null,
  };
}

function parseSavedArrangementDocument(
  raw: unknown,
): SavedArrangementDocument | null {
  if (!isRecord(raw)) return null;
  const customHarmony = parseSavedCustomHarmony(raw.customHarmony);
  const meter = raw.meter;
  if (
    typeof raw.chordsInput !== "string" ||
    isFiniteNumber(raw.tempo) === false ||
    Array.isArray(meter) === false ||
    meter.length !== 2 ||
    isFiniteNumber(meter[0]) === false ||
    isFiniteNumber(meter[1]) === false ||
    typeof raw.vocalRangeLow !== "string" ||
    typeof raw.vocalRangeHigh !== "string" ||
    (raw.harmonyRangeCoverage !== undefined &&
      raw.harmonyRangeCoverage !== "lower two thirds" &&
      raw.harmonyRangeCoverage !== "whole-range") ||
    (raw.selectedHarmonyGenerator !== undefined &&
      raw.selectedHarmonyGenerator !== "legacy" &&
      raw.selectedHarmonyGenerator !== "dynamic") ||
    (raw.totalParts !== 2 && raw.totalParts !== 4) ||
    (raw.customHarmony != null && customHarmony == null)
  ) {
    return null;
  }

  return {
    chordsInput: raw.chordsInput,
    tempo: raw.tempo,
    meter: [meter[0], meter[1]],
    vocalRangeLow: raw.vocalRangeLow,
    vocalRangeHigh: raw.vocalRangeHigh,
    harmonyRangeCoverage: (raw.harmonyRangeCoverage ??
      "lower two thirds") as SavedArrangementDocument["harmonyRangeCoverage"],
    selectedHarmonyGenerator:
      raw.selectedHarmonyGenerator as
        | SavedArrangementDocument["selectedHarmonyGenerator"]
        | undefined,
    totalParts: raw.totalParts,
    customHarmony,
  };
}

function parseSavedCustomHarmony(
  raw: unknown,
): { lines: Array<Array<number | null>> } | null {
  if (raw == null) return null;
  if (
    !isRecord(raw) ||
    !Array.isArray(raw.lines) ||
    raw.lines.some(
      (line) =>
        !Array.isArray(line) ||
        line.some((entry) => entry !== null && isFiniteNumber(entry) === false),
    )
  ) {
    return null;
  }
  return {
    lines: raw.lines.map((line) => [...line]) as Array<Array<number | null>>,
  };
}

function parseSavedVolumePoint(raw: unknown): SavedVolumePoint | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.id !== "string" ||
    isFiniteNumber(raw.timeSec) === false ||
    isFiniteNumber(raw.gainMultiplier) === false
  ) {
    return null;
  }
  return {
    id: raw.id,
    timeSec: raw.timeSec,
    gainMultiplier: raw.gainMultiplier,
  };
}

function parseSavedClipVolumeEnvelope(
  raw: unknown,
): SavedClipVolumeEnvelope | null {
  if (!isRecord(raw) || Array.isArray(raw.points) === false) return null;
  const points = raw.points
    .map((point) => parseSavedVolumePoint(point))
    .filter((point): point is SavedVolumePoint => point != null);
  if (points.length !== raw.points.length) return null;
  return { points };
}

function parseSavedTrack(raw: unknown): SavedTrack | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.id !== "string" ||
    (raw.role !== "harmony" && raw.role !== "melody") ||
    isStringArray(raw.clipIds) === false ||
    isFiniteNumber(raw.volume) === false ||
    typeof raw.muted !== "boolean"
  ) {
    return null;
  }
  return {
    id: raw.id,
    role: raw.role,
    clipIds: raw.clipIds,
    volume: raw.volume,
    muted: raw.muted,
  };
}

function parseSavedClip(raw: unknown): SavedClip | null {
  if (!isRecord(raw)) return null;
  const volumeEnvelope = parseSavedClipVolumeEnvelope(raw.volumeEnvelope);
  if (
    typeof raw.id !== "string" ||
    typeof raw.trackId !== "string" ||
    typeof raw.recordingId !== "string" ||
    isFiniteNumber(raw.timelineStartSec) === false ||
    isFiniteNumber(raw.sourceStartSec) === false ||
    isFiniteNumber(raw.durationSec) === false ||
    volumeEnvelope == null
  ) {
    return null;
  }
  return {
    id: raw.id,
    trackId: raw.trackId,
    recordingId: raw.recordingId,
    timelineStartSec: raw.timelineStartSec,
    sourceStartSec: raw.sourceStartSec,
    durationSec: raw.durationSec,
    volumeEnvelope,
  };
}

function parseSavedRecording(raw: unknown): SavedRecording | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.id !== "string" ||
    typeof raw.trackId !== "string" ||
    typeof raw.mediaAssetId !== "string"
  ) {
    return null;
  }
  return {
    id: raw.id,
    trackId: raw.trackId,
    mediaAssetId: raw.mediaAssetId,
  };
}

function parseSavedRecordMap<T>(
  raw: unknown,
  parseEntry: (value: unknown) => T | null,
): Record<string, T> | null {
  if (!isRecord(raw)) return null;
  const parsed: Record<string, T> = {};
  for (const [key, value] of Object.entries(raw)) {
    const entry = parseEntry(value);
    if (entry == null) return null;
    parsed[key] = entry;
  }
  return parsed;
}

function parseSavedTracksDocument(raw: unknown): SavedTracksDocument | null {
  if (!isRecord(raw)) return null;
  const tracksById = parseSavedRecordMap(raw.tracksById, parseSavedTrack);
  const clipsById = parseSavedRecordMap(raw.clipsById, parseSavedClip);
  const recordingsById = parseSavedRecordMap(
    raw.recordingsById,
    parseSavedRecording,
  );
  if (
    isStringArray(raw.trackOrder) === false ||
    tracksById == null ||
    clipsById == null ||
    recordingsById == null ||
    isFiniteNumber(raw.reverbWet) === false
  ) {
    return null;
  }
  return {
    trackOrder: raw.trackOrder,
    tracksById,
    clipsById,
    recordingsById,
    reverbWet: raw.reverbWet,
  };
}

export function parseSavedHumDocument(raw: unknown): SavedHumDocument | null {
  if (!isRecord(raw)) return null;
  if (raw.schemaVersion !== SAVED_HUM_DOCUMENT_SCHEMA_VERSION) {
    return null;
  }

  const arrangement = parseSavedArrangementDocument(raw.arrangement);
  const tracks = parseSavedTracksDocument(raw.tracks);
  const exportPreferences = parseSavedExportPreferences(raw.exportPreferences);
  if (
    typeof raw.id !== "string" ||
    arrangement == null ||
    tracks == null ||
    exportPreferences == null ||
    isFiniteNumber(raw.currentPartIndex) === false ||
    (raw.appScreen !== "setup" &&
      raw.appScreen !== "calibration" &&
      raw.appScreen !== "recording" &&
      raw.appScreen !== "review")
  ) {
    return null;
  }

  return {
    schemaVersion: raw.schemaVersion,
    id: raw.id,
    arrangement,
    tracks,
    exportPreferences,
    currentPartIndex: raw.currentPartIndex,
    appScreen: raw.appScreen,
  };
}
