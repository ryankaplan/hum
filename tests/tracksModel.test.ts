import { describe, expect, it } from "vitest";
import {
  createEmptyTracksDocument,
  TracksDocumentModel,
  TracksEditorModel,
} from "../src/state/tracksModel";

describe("TracksDocumentModel referenceWaveformTrackId", () => {
  it("captures the first recorded track and does not overwrite it later", () => {
    const tracks = new TracksDocumentModel({
      totalParts: 4,
      getMixer: () => null,
    });
    const [lowTrackId, midTrackId] = tracks.document.get().trackOrder;

    tracks.stageCommittedRecording({
      trackId: lowTrackId!,
      recording: {
        id: "recording-low-1",
        trackId: lowTrackId!,
        mediaAssetId: "media-low-1",
      },
      timelineStartSec: 0,
      sourceStartSec: 0,
      durationSec: 4,
    });
    expect(tracks.document.get().referenceWaveformTrackId).toBe(lowTrackId);

    tracks.stageCommittedRecording({
      trackId: midTrackId!,
      recording: {
        id: "recording-mid-1",
        trackId: midTrackId!,
        mediaAssetId: "media-mid-1",
      },
      timelineStartSec: 0,
      sourceStartSec: 0,
      durationSec: 4,
    });
    expect(tracks.document.get().referenceWaveformTrackId).toBe(lowTrackId);

    tracks.stageCommittedRecording({
      trackId: lowTrackId!,
      recording: {
        id: "recording-low-2",
        trackId: lowTrackId!,
        mediaAssetId: "media-low-2",
      },
      timelineStartSec: 0,
      sourceStartSec: 0,
      durationSec: 4,
    });
    expect(tracks.document.get().referenceWaveformTrackId).toBe(lowTrackId);
  });

  it("clears the reference track when resize removes it and reset starts fresh", () => {
    const tracks = new TracksDocumentModel({
      totalParts: 4,
      getMixer: () => null,
    });
    const melodyTrackId = tracks.document.get().trackOrder[3]!;

    tracks.stageCommittedRecording({
      trackId: melodyTrackId,
      recording: {
        id: "recording-melody-1",
        trackId: melodyTrackId,
        mediaAssetId: "media-melody-1",
      },
      timelineStartSec: 0,
      sourceStartSec: 0,
      durationSec: 4,
    });
    expect(tracks.document.get().referenceWaveformTrackId).toBe(melodyTrackId);

    tracks.resizeForPartCount(2);
    expect(tracks.document.get().referenceWaveformTrackId).toBeNull();

    tracks.stageCommittedRecording({
      trackId: tracks.document.get().trackOrder[0]!,
      recording: {
        id: "recording-harmony-1",
        trackId: tracks.document.get().trackOrder[0]!,
        mediaAssetId: "media-harmony-1",
      },
      timelineStartSec: 0,
      sourceStartSec: 0,
      durationSec: 4,
    });
    expect(tracks.document.get().referenceWaveformTrackId).toBe(
      tracks.document.get().trackOrder[0],
    );

    tracks.reset(2);
    expect(tracks.document.get().referenceWaveformTrackId).toBeNull();
  });
});
