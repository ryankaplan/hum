import { Observable } from "../observable";
import type { Mixer } from "../audio/mixer";
import {
  type ClipVolumeEnvelope,
  applyClipVolumeBrush,
  createDefaultClipVolumeEnvelope,
  splitClipVolumeEnvelopeAtTime,
} from "./clipAutomation";
import { createShortUuid } from "./id";

export type TrackId = string;
export type ClipId = string;
export type RecordingId = string;
export type MediaAssetId = string;

export type TrackRole = "harmony" | "melody";

export type TrackClip = {
  // Generated locally by the document model and used as stable clip identity.
  id: ClipId;

  // Foreign key into `tracksById` for the track that owns this clip.
  trackId: TrackId;

  // Foreign key into `recordingsById` for the committed recording backing
  // this clip.
  recordingId: RecordingId;

  // Clip start in the edited timeline.
  timelineStartSec: number;

  // Start offset into the underlying committed recording media.
  sourceStartSec: number;

  durationSec: number;
  volumeEnvelope: ClipVolumeEnvelope;
  volumeEnvelopeRevision: number;
};

export type TrackRecord = {
  // Stable ID for one arranged track in the document.
  id: TrackId;

  // Used to preserve the intended musical role as part count changes.
  role: TrackRole;

  // Ordered clip ids for this track. The order here is the source of truth
  // for clip traversal and editing within the track.
  clipIds: ClipId[];

  // Persisted per-track mix state.
  volume: number;
  muted: boolean;
};

export type RecordingRecord = {
  // Stable ID for one committed recording in a track.
  id: RecordingId;

  // Owning track for this recording.
  trackId: TrackId;

  // Reference to the original recorded media asset. In this app that asset is
  // the recorded video file, whose audio is later decoded for playback/editing.
  mediaAssetId: MediaAssetId;
};

export type TracksEditorSelection = {
  trackId: TrackId | null;
  clipId: ClipId | null;
};

export type TracksDocumentState = {
  // Ordered track ids for UI/rendering. This is the only place where track
  // position is stored; callers should prefer ids elsewhere.
  trackOrder: TrackId[];

  tracksById: Record<TrackId, TrackRecord>;
  clipsById: Record<ClipId, TrackClip>;
  recordingsById: Record<RecordingId, RecordingRecord>;

  // Global mix state that still applies across the full track document.
  reverbWet: number;
};

export type TracksEditorState = {
  selection: TracksEditorSelection;
  playheadSec: number;
};

export type ApplyClipVolumeBrushInput = {
  trackId: TrackId;
  clipId: ClipId;
  centerSec: number;
  deltaGainMultiplier: number;
  radiusSec: number;
};

type TracksDocumentModelOptions = {
  totalParts: number;
  getMixer: () => Mixer | null;
};

const DEFAULT_MELODY_TRACK_VOLUME = 1;
const DEFAULT_HARMONY_TRACK_VOLUME = 0.6;
const DEFAULT_REVERB_WET = 0.2;

function createTrackRecord(
  id: TrackId,
  displayIndex: number,
  totalParts: number,
): TrackRecord {
  const harmonyPartCount = Math.max(1, totalParts - 1);
  const role = displayIndex >= harmonyPartCount ? "melody" : "harmony";
  return {
    id,
    role,
    clipIds: [],
    volume:
      role === "melody"
        ? DEFAULT_MELODY_TRACK_VOLUME
        : DEFAULT_HARMONY_TRACK_VOLUME,
    muted: false,
  };
}

export function createEmptyTracksDocument(
  totalParts: number,
  makeTrackId?: () => TrackId,
): TracksDocumentState {
  const trackOrder: TrackId[] = [];
  const tracksById: Record<TrackId, TrackRecord> = {};

  for (let i = 0; i < totalParts; i++) {
    const trackId = makeTrackId ? makeTrackId() : `track-${i + 1}`;
    trackOrder.push(trackId);
    tracksById[trackId] = createTrackRecord(trackId, i, totalParts);
  }

  return {
    trackOrder,
    tracksById,
    clipsById: {},
    recordingsById: {},
    reverbWet: DEFAULT_REVERB_WET,
  };
}

export function createEmptyTracksEditorState(): TracksEditorState {
  return {
    selection: { trackId: null, clipId: null },
    playheadSec: 0,
  };
}

export class TracksDocumentModel {
  readonly document: Observable<TracksDocumentState>;

  constructor(private options: TracksDocumentModelOptions) {
    this.document = new Observable<TracksDocumentState>(
      createEmptyTracksDocument(options.totalParts, () => this.makeTrackId()),
    );
  }

  getTrackIdAtIndex(index: number): TrackId | null {
    return this.document.get().trackOrder[index] ?? null;
  }

  getTrackIndex(trackId: TrackId): number {
    return this.document.get().trackOrder.indexOf(trackId);
  }

  getTrackCount(): number {
    return this.document.get().trackOrder.length;
  }

  getTrack(trackId: TrackId): TrackRecord | null {
    return this.document.get().tracksById[trackId] ?? null;
  }

  getOrderedClipsForTrack(trackId: TrackId): TrackClip[] {
    const current = this.document.get();
    const track = current.tracksById[trackId];
    if (track == null) return [];
    return track.clipIds
      .map((clipId) => current.clipsById[clipId] ?? null)
      .filter((clip): clip is TrackClip => clip != null);
  }

  getOrderedTracks(): TrackRecord[] {
    const current = this.document.get();
    return current.trackOrder
      .map((trackId) => current.tracksById[trackId] ?? null)
      .filter((track): track is TrackRecord => track != null);
  }

  getRecording(recordingId: RecordingId): RecordingRecord | null {
    return this.document.get().recordingsById[recordingId] ?? null;
  }

  getPrimaryRecordingIdForTrack(trackId: TrackId): RecordingId | null {
    const clip = this.getOrderedClipsForTrack(trackId)[0] ?? null;
    return clip?.recordingId ?? null;
  }

  replaceDocument(document: TracksDocumentState): void {
    this.document.set(document);
  }

  stageCommittedRecording(input: {
    trackId: TrackId;
    recording: RecordingRecord;
    timelineStartSec: number;
    sourceStartSec: number;
    durationSec: number;
  }): {
    removedRecordings: RecordingRecord[];
    clipId: ClipId | null;
  } {
    const {
      trackId,
      recording,
      timelineStartSec,
      sourceStartSec,
      durationSec,
    } = input;
    const clipId = this.makeClipId();
    let removedRecordings: RecordingRecord[] = [];

    this.setDocument((current) => {
      const track = current.tracksById[trackId];
      if (track == null) return current;

      const nextTracksById = { ...current.tracksById };
      const nextClipsById = { ...current.clipsById };
      const nextRecordingsById = { ...current.recordingsById };

      removedRecordings = this.collectRemovedTrackRecordings(
        current,
        trackId,
        nextClipsById,
        nextRecordingsById,
      );

      const nextClip: TrackClip = {
        id: clipId,
        trackId,
        recordingId: recording.id,
        timelineStartSec: Math.max(0, timelineStartSec),
        sourceStartSec: Math.max(0, sourceStartSec),
        durationSec: Math.max(0, durationSec),
        volumeEnvelope: createDefaultClipVolumeEnvelope(Math.max(0, durationSec)),
        volumeEnvelopeRevision: 0,
      };

      nextClipsById[clipId] = nextClip;
      nextRecordingsById[recording.id] = recording;
      nextTracksById[trackId] = {
        ...track,
        clipIds: [clipId],
      };

      return {
        ...current,
        tracksById: nextTracksById,
        clipsById: nextClipsById,
        recordingsById: nextRecordingsById,
      };
    });

    return { removedRecordings, clipId };
  }

  initializeTrackFromRecording(
    trackId: TrackId,
    recordingId: RecordingId,
    sourceStartSec: number,
    durationSec: number,
  ): void {
    this.setDocument((current) => {
      const track = current.tracksById[trackId];
      if (track == null) return current;

      const firstClipId = track.clipIds[0] ?? null;
      const firstClip = firstClipId != null ? current.clipsById[firstClipId] : null;

      if (
        track.clipIds.length === 1 &&
        firstClip != null &&
        firstClip.recordingId === recordingId &&
        firstClip.timelineStartSec === 0
      ) {
        return {
          ...current,
          clipsById: {
            ...current.clipsById,
            [firstClip.id]: {
              ...firstClip,
              sourceStartSec,
              durationSec,
              volumeEnvelope: createDefaultClipVolumeEnvelope(durationSec),
              volumeEnvelopeRevision: firstClip.volumeEnvelopeRevision + 1,
            },
          },
        };
      }

      if (track.clipIds.length !== 0) return current;

      const clipId = this.makeClipId();
      return {
        ...current,
        clipsById: {
          ...current.clipsById,
          [clipId]: {
            id: clipId,
            trackId,
            recordingId,
            timelineStartSec: 0,
            sourceStartSec,
            durationSec,
            volumeEnvelope: createDefaultClipVolumeEnvelope(durationSec),
            volumeEnvelopeRevision: 0,
          },
        },
        tracksById: {
          ...current.tracksById,
          [trackId]: {
            ...track,
            clipIds: [clipId],
          },
        },
      };
    });
  }

  splitClipAtTime(input: {
    trackId: TrackId;
    clipId: ClipId;
    splitTimeSec: number;
  }): { leftClipId: ClipId; rightClipId: ClipId } | null {
    const { trackId, clipId, splitTimeSec } = input;
    let result: { leftClipId: ClipId; rightClipId: ClipId } | null = null;

    this.setDocument((current) => {
      const track = current.tracksById[trackId];
      if (track == null) return current;

      const idx = track.clipIds.findIndex((candidate) => candidate === clipId);
      if (idx < 0) return current;

      const clip = current.clipsById[clipId];
      if (clip == null) return current;

      const clipStart = clip.timelineStartSec;
      const clipEnd = clip.timelineStartSec + clip.durationSec;
      const epsilon = 1e-6;
      if (
        !(splitTimeSec > clipStart + epsilon && splitTimeSec < clipEnd - epsilon)
      ) {
        return current;
      }

      const leftDuration = splitTimeSec - clipStart;
      const rightDuration = clipEnd - splitTimeSec;
      if (leftDuration <= epsilon || rightDuration <= epsilon) return current;

      const splitVolumeEnvelope = splitClipVolumeEnvelopeAtTime(
        clip.volumeEnvelope,
        leftDuration,
        clip.durationSec,
      );

      const leftClipId = this.makeClipId();
      const rightClipId = this.makeClipId();

      const left: TrackClip = {
        ...clip,
        id: leftClipId,
        durationSec: leftDuration,
        volumeEnvelope: splitVolumeEnvelope.left,
        volumeEnvelopeRevision: clip.volumeEnvelopeRevision + 1,
      };

      const right: TrackClip = {
        ...clip,
        id: rightClipId,
        timelineStartSec: splitTimeSec,
        sourceStartSec: clip.sourceStartSec + leftDuration,
        durationSec: rightDuration,
        volumeEnvelope: splitVolumeEnvelope.right,
        volumeEnvelopeRevision: clip.volumeEnvelopeRevision + 1,
      };

      const nextClipIds = [
        ...track.clipIds.slice(0, idx),
        leftClipId,
        rightClipId,
        ...track.clipIds.slice(idx + 1),
      ];
      const nextClipsById = { ...current.clipsById };
      delete nextClipsById[clipId];
      nextClipsById[leftClipId] = left;
      nextClipsById[rightClipId] = right;

      result = { leftClipId, rightClipId };

      return {
        ...current,
        clipsById: nextClipsById,
        tracksById: {
          ...current.tracksById,
          [trackId]: {
            ...track,
            clipIds: nextClipIds,
          },
        },
      };
    });

    return result;
  }

  moveClip(trackId: TrackId, clipId: ClipId, desiredStartSec: number): void {
    this.setDocument((current) => {
      const track = current.tracksById[trackId];
      if (track == null) return current;

      const idx = track.clipIds.findIndex((candidate) => candidate === clipId);
      if (idx < 0) return current;

      const clip = current.clipsById[clipId];
      if (clip == null) return current;

      const prev = idx > 0 ? current.clipsById[track.clipIds[idx - 1]!] : null;
      const next =
        idx < track.clipIds.length - 1
          ? current.clipsById[track.clipIds[idx + 1]!] ?? null
          : null;

      const minStart =
        prev != null ? prev.timelineStartSec + prev.durationSec : 0;
      const maxStart =
        next != null
          ? Math.max(minStart, next.timelineStartSec - clip.durationSec)
          : Number.POSITIVE_INFINITY;

      const clamped = Math.min(Math.max(desiredStartSec, minStart), maxStart);
      if (Math.abs(clamped - clip.timelineStartSec) < 1e-6) return current;

      return {
        ...current,
        clipsById: {
          ...current.clipsById,
          [clipId]: {
            ...clip,
            timelineStartSec: clamped,
          },
        },
      };
    });
  }

  deleteClip(input: {
    trackId: TrackId;
    clipId: ClipId;
  }): { deleted: boolean; removedRecordings: RecordingRecord[] } {
    const { trackId, clipId } = input;
    let deleted = false;
    let removedRecordings: RecordingRecord[] = [];

    this.setDocument((current) => {
      const track = current.tracksById[trackId];
      if (track == null) return current;
      if (track.clipIds.includes(clipId) === false) return current;

      const nextClipsById = { ...current.clipsById };
      delete nextClipsById[clipId];

      const nextRecordingsById = { ...current.recordingsById };
      removedRecordings = this.removeUnreferencedRecordings(
        current,
        nextClipsById,
        nextRecordingsById,
      );

      deleted = true;

      return {
        ...current,
        clipsById: nextClipsById,
        recordingsById: nextRecordingsById,
        tracksById: {
          ...current.tracksById,
          [trackId]: {
            ...track,
            clipIds: track.clipIds.filter((candidate) => candidate !== clipId),
          },
        },
      };
    });

    return { deleted, removedRecordings };
  }

  applyClipVolumeBrush(input: ApplyClipVolumeBrushInput): void {
    if (Math.abs(input.deltaGainMultiplier) <= 1e-6 || input.radiusSec <= 0) {
      return;
    }

    this.setDocument((current) => {
      const track = current.tracksById[input.trackId];
      if (track == null || track.clipIds.includes(input.clipId) === false) {
        return current;
      }

      const clip = current.clipsById[input.clipId];
      if (clip == null || clip.durationSec <= 0) return current;

      const nextEnvelope = applyClipVolumeBrush({
        envelope: clip.volumeEnvelope,
        durationSec: clip.durationSec,
        centerSec: input.centerSec,
        deltaGainMultiplier: input.deltaGainMultiplier,
        radiusSec: input.radiusSec,
      });

      if (isSameVolumeEnvelope(clip.volumeEnvelope, nextEnvelope)) {
        return current;
      }

      return {
        ...current,
        clipsById: {
          ...current.clipsById,
          [input.clipId]: {
            ...clip,
            volumeEnvelope: nextEnvelope,
            volumeEnvelopeRevision: clip.volumeEnvelopeRevision + 1,
          },
        },
      };
    });
  }

  setTrackVolume(trackId: TrackId, volume: number): void {
    this.setDocument((current) => {
      const track = current.tracksById[trackId];
      if (track == null) return current;

      return {
        ...current,
        tracksById: {
          ...current.tracksById,
          [trackId]: {
            ...track,
            volume,
          },
        },
      };
    });

    const trackIndex = this.getTrackIndex(trackId);
    if (trackIndex >= 0) {
      this.options.getMixer()?.setTrackVolume(trackIndex, volume);
    }
  }

  setTrackMuted(trackId: TrackId, muted: boolean): void {
    this.setDocument((current) => {
      const track = current.tracksById[trackId];
      if (track == null) return current;

      return {
        ...current,
        tracksById: {
          ...current.tracksById,
          [trackId]: {
            ...track,
            muted,
          },
        },
      };
    });

    const trackIndex = this.getTrackIndex(trackId);
    if (trackIndex >= 0) {
      this.options.getMixer()?.setTrackMuted(trackIndex, muted);
    }
  }

  setReverbWet(wet: number): void {
    this.setDocument((current) => ({
      ...current,
      reverbWet: wet,
    }));

    this.options.getMixer()?.setReverbWet(wet);
  }

  clearTrack(trackId: TrackId): RecordingRecord[] {
    let removedRecordings: RecordingRecord[] = [];

    this.setDocument((current) => {
      const track = current.tracksById[trackId];
      if (track == null) return current;

      const nextClipsById = { ...current.clipsById };
      const nextRecordingsById = { ...current.recordingsById };
      removedRecordings = this.collectRemovedTrackRecordings(
        current,
        trackId,
        nextClipsById,
        nextRecordingsById,
      );

      return {
        ...current,
        clipsById: nextClipsById,
        recordingsById: nextRecordingsById,
        tracksById: {
          ...current.tracksById,
          [trackId]: {
            ...track,
            clipIds: [],
          },
        },
      };
    });

    return removedRecordings;
  }

  resizeForPartCount(totalParts: number): RecordingRecord[] {
    const removedRecordings: RecordingRecord[] = [];

    this.setDocument((current) => {
      const nextTrackOrder = current.trackOrder.slice(0, totalParts);
      const nextTracksById: Record<TrackId, TrackRecord> = {};

      for (const trackId of nextTrackOrder) {
        const track = current.tracksById[trackId];
        if (track != null) {
          nextTracksById[trackId] = track;
        }
      }

      for (let i = nextTrackOrder.length; i < totalParts; i++) {
        const trackId = this.makeTrackId();
        nextTrackOrder.push(trackId);
        nextTracksById[trackId] = createTrackRecord(trackId, i, totalParts);
      }

      for (let i = 0; i < nextTrackOrder.length; i++) {
        const trackId = nextTrackOrder[i]!;
        nextTracksById[trackId] = {
          ...nextTracksById[trackId]!,
          role: i >= Math.max(1, totalParts - 1) ? "melody" : "harmony",
        };
      }

      const nextClipsById: Record<ClipId, TrackClip> = {};
      for (const clip of Object.values(current.clipsById)) {
        if (nextTracksById[clip.trackId] != null) {
          nextClipsById[clip.id] = clip;
        }
      }

      const nextRecordingsById: Record<RecordingId, RecordingRecord> = {};
      for (const recording of Object.values(current.recordingsById)) {
        if (nextTracksById[recording.trackId] != null) {
          nextRecordingsById[recording.id] = recording;
        } else {
          removedRecordings.push(recording);
        }
      }

      for (const trackId of nextTrackOrder) {
        const track = nextTracksById[trackId];
        if (track == null) continue;
        nextTracksById[trackId] = {
          ...track,
          clipIds: track.clipIds.filter((clipId) => nextClipsById[clipId] != null),
        };
      }

      return {
        ...current,
        trackOrder: nextTrackOrder,
        tracksById: nextTracksById,
        clipsById: nextClipsById,
        recordingsById: nextRecordingsById,
      };
    });

    return removedRecordings;
  }

  reset(totalParts: number): RecordingRecord[] {
    const removedRecordings = Object.values(this.document.get().recordingsById);
    this.document.set(
      createEmptyTracksDocument(totalParts, () => this.makeTrackId()),
    );
    return removedRecordings;
  }

  private collectRemovedTrackRecordings(
    current: TracksDocumentState,
    trackId: TrackId,
    nextClipsById: Record<ClipId, TrackClip>,
    nextRecordingsById: Record<RecordingId, RecordingRecord>,
  ): RecordingRecord[] {
    const track = current.tracksById[trackId];
    if (track == null) return [];

    for (const clipId of track.clipIds) {
      delete nextClipsById[clipId];
    }

    return this.removeUnreferencedRecordings(
      current,
      nextClipsById,
      nextRecordingsById,
    );
  }

  private removeUnreferencedRecordings(
    current: TracksDocumentState,
    nextClipsById: Record<ClipId, TrackClip>,
    nextRecordingsById: Record<RecordingId, RecordingRecord>,
  ): RecordingRecord[] {
    const referencedRecordingIds = new Set(
      Object.values(nextClipsById).map((clip) => clip.recordingId),
    );

    const removed: RecordingRecord[] = [];
    for (const [recordingId, recording] of Object.entries(current.recordingsById)) {
      if (referencedRecordingIds.has(recordingId)) {
        nextRecordingsById[recordingId] = recording;
      } else {
        delete nextRecordingsById[recordingId];
        removed.push(recording);
      }
    }
    return removed;
  }

  private setDocument(
    updater: (current: TracksDocumentState) => TracksDocumentState,
  ): void {
    const current = this.document.get();
    const next = updater(current);
    if (next !== current) {
      this.document.set(next);
    }
  }

  private makeTrackId(): TrackId {
    return `track-${createShortUuid()}`;
  }

  private makeClipId(): ClipId {
    return `clip-${createShortUuid()}`;
  }
}

export class TracksEditorModel {
  readonly editor = new Observable<TracksEditorState>(
    createEmptyTracksEditorState(),
  );
  readonly playbackPlayheadSec = new Observable<number>(0);

  setPlayhead(sec: number): void {
    const nextSec = Math.max(0, sec);
    this.setEditor((current) => ({
      ...current,
      playheadSec: nextSec,
    }));
    this.playbackPlayheadSec.set(nextSec);
  }

  setPlaybackPlayhead(sec: number): void {
    this.playbackPlayheadSec.set(Math.max(0, sec));
  }

  setSelection(selection: TracksEditorSelection): void {
    const current = this.editor.get().selection;
    if (isSameTracksEditorSelection(current, selection)) {
      return;
    }
    this.setEditor((current) => ({
      ...current,
      selection,
    }));
  }

  clearSelection(): void {
    this.setSelection({ trackId: null, clipId: null });
  }

  reset(): void {
    this.editor.set(createEmptyTracksEditorState());
    this.playbackPlayheadSec.set(0);
  }

  private setEditor(updater: (current: TracksEditorState) => TracksEditorState) {
    const current = this.editor.get();
    const next = updater(current);
    if (next !== current) {
      this.editor.set(next);
    }
  }
}

function isSameVolumeEnvelope(
  a: ClipVolumeEnvelope,
  b: ClipVolumeEnvelope,
): boolean {
  if (a.points.length !== b.points.length) return false;
  for (let i = 0; i < a.points.length; i++) {
    const left = a.points[i];
    const right = b.points[i];
    if (left == null || right == null) return false;
    if (Math.abs(left.timeSec - right.timeSec) > 1e-6) return false;
    if (Math.abs(left.gainMultiplier - right.gainMultiplier) > 1e-6) {
      return false;
    }
  }
  return true;
}

function isSameTracksEditorSelection(
  a: TracksEditorSelection,
  b: TracksEditorSelection,
): boolean {
  return a.trackId === b.trackId && a.clipId === b.clipId;
}
