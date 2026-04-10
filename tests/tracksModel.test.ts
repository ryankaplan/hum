import { describe, expect, it } from "vitest";
import {
  createEmptyTracksDocument,
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
    expect(document.reverbWet).toBe(0.2);
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
