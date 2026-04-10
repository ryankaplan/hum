import { describe, expect, it } from "vitest";
import {
  createEmptyTracksDocument,
  TracksDocumentModel,
  TracksEditorModel,
} from "../src/state/tracksModel";

describe("createEmptyTracksDocument", () => {
  it("defaults harmony tracks quieter than melody and uses 20% reverb", () => {
    const document = createEmptyTracksDocument(4);
    const orderedTracks = document.trackOrder.map(
      (trackId) => document.tracksById[trackId],
    );

    expect(orderedTracks.map((track) => track?.role)).toEqual([
      "harmony",
      "harmony",
      "harmony",
      "melody",
    ]);
    expect(orderedTracks.map((track) => track?.volume)).toEqual([
      0.6,
      0.6,
      0.6,
      1,
    ]);
    expect(document.referenceWaveformTrackId).toBeNull();
    expect(document.reverbWet).toBe(0.2);
  });
});

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

describe("TracksEditorModel", () => {
  it("does not notify listeners when clearing an already empty selection", () => {
    const editor = new TracksEditorModel();
    let notifyCount = 0;

    editor.editor.register(() => {
      notifyCount += 1;
    });

    editor.clearSelection();
    editor.clearSelection();

    expect(notifyCount).toBe(0);
    expect(editor.editor.get().selection).toEqual({
      trackId: null,
      clipId: null,
      volumePointId: null,
    });
  });
});
