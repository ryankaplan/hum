import type { PartIndex } from "../music/types";
import type { TracksDocumentState } from "./tracksModel";

export function getPrimaryRecordingIdForTrack(
  tracks: TracksDocumentState,
  trackId: string,
): string | null {
  const track = tracks.tracksById[trackId];
  if (track == null) return null;

  const clipId = track.clipIds[0] ?? null;
  if (clipId == null) return null;

  const clip = tracks.clipsById[clipId];
  return clip?.recordingId ?? null;
}

export function findIncompletePartIndex(
  tracks: TracksDocumentState,
  startIndex = 0,
): PartIndex | null {
  const normalizedStartIndex = Math.max(0, Math.floor(startIndex));

  for (let index = normalizedStartIndex; index < tracks.trackOrder.length; index++) {
    const trackId = tracks.trackOrder[index];
    if (trackId == null) continue;
    if (getPrimaryRecordingIdForTrack(tracks, trackId) == null) {
      return index as PartIndex;
    }
  }

  return null;
}
