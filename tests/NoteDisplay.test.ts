import { describe, expect, it } from "vitest";
import { computeNoteTimelineMetrics } from "../src/ui/NoteDisplay";

describe("computeNoteTimelineMetrics", () => {
  it("keeps short progressions at the minimum lane width without stretching beats", () => {
    expect(computeNoteTimelineMetrics(4, 4)).toEqual({
      trackWidthPx: 280,
      contentWidthPx: 80,
      notePxPerBeat: 20,
      beatGuideCount: 5,
    });
  });

  it("uses the full content width once the progression is wider than the minimum", () => {
    expect(computeNoteTimelineMetrics(16, 4)).toEqual({
      trackWidthPx: 332,
      contentWidthPx: 320,
      notePxPerBeat: 20,
      beatGuideCount: 17,
    });
  });
});
