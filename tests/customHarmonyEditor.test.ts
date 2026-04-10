import { describe, expect, it } from "vitest";
import {
  getNextMidiForArrowMove,
  getNextSelectionInVisualOrder,
  getVisualSelectionItems,
  reduceTypedPitchBuffer,
} from "../src/ui/CustomHarmonyEditor";

function asCandidateSet(values: number[]): ReadonlySet<number> {
  return new Set(values);
}

describe("getNextMidiForArrowMove", () => {
  it("stops at the range boundaries", () => {
    expect(getNextMidiForArrowMove(48, -1, 48, 72)).toBeNull();
    expect(getNextMidiForArrowMove(72, 1, 48, 72)).toBeNull();
  });

  it("snaps out-of-range notes inward only when moving toward the range", () => {
    expect(getNextMidiForArrowMove(44, 1, 48, 72)).toBe(48);
    expect(getNextMidiForArrowMove(44, -1, 48, 72)).toBeNull();
    expect(getNextMidiForArrowMove(76, -1, 48, 72)).toBe(72);
    expect(getNextMidiForArrowMove(76, 1, 48, 72)).toBeNull();
  });
});

describe("getVisualSelectionItems", () => {
  it("orders note pills top-to-bottom, then rests, within each chord", () => {
    const items = getVisualSelectionItems(
      [
        [52, null, 57],
        [57, 59, null],
        [64, null, 60],
      ],
      3,
    );

    expect(items).toEqual([
      { chordIndex: 0, voiceIndex: 2, kind: "note", midi: 64 },
      { chordIndex: 0, voiceIndex: 1, kind: "note", midi: 57 },
      { chordIndex: 0, voiceIndex: 0, kind: "note", midi: 52 },
      { chordIndex: 1, voiceIndex: 1, kind: "note", midi: 59 },
      { chordIndex: 1, voiceIndex: 0, kind: "rest", midi: null },
      { chordIndex: 1, voiceIndex: 2, kind: "rest", midi: null },
      { chordIndex: 2, voiceIndex: 2, kind: "note", midi: 60 },
      { chordIndex: 2, voiceIndex: 0, kind: "note", midi: 57 },
      { chordIndex: 2, voiceIndex: 1, kind: "rest", midi: null },
    ]);
  });

  it("keeps duplicate-pitch stacks stable by voice order", () => {
    const items = getVisualSelectionItems(
      [
        [60],
        [60],
        [64],
      ],
      1,
    );

    expect(items).toEqual([
      { chordIndex: 0, voiceIndex: 2, kind: "note", midi: 64 },
      { chordIndex: 0, voiceIndex: 0, kind: "note", midi: 60 },
      { chordIndex: 0, voiceIndex: 1, kind: "note", midi: 60 },
    ]);
  });
});

describe("getNextSelectionInVisualOrder", () => {
  it("moves forward through note pills, then rests, then the next chord", () => {
    const items = getVisualSelectionItems(
      [
        [52, null, 57],
        [57, 59, null],
        [64, null, 60],
      ],
      3,
    );

    expect(
      getNextSelectionInVisualOrder(items, { chordIndex: 0, voiceIndex: 2 }, 1),
    ).toEqual({ chordIndex: 0, voiceIndex: 1 });
    expect(
      getNextSelectionInVisualOrder(items, { chordIndex: 1, voiceIndex: 1 }, 1),
    ).toEqual({ chordIndex: 1, voiceIndex: 0 });
    expect(
      getNextSelectionInVisualOrder(items, { chordIndex: 1, voiceIndex: 2 }, 1),
    ).toEqual({ chordIndex: 2, voiceIndex: 2 });
  });

  it("moves backward in the exact reverse order", () => {
    const items = getVisualSelectionItems(
      [
        [52, null],
        [57, 59],
      ],
      2,
    );

    expect(
      getNextSelectionInVisualOrder(items, { chordIndex: 1, voiceIndex: 0 }, -1),
    ).toEqual({ chordIndex: 1, voiceIndex: 1 });
    expect(
      getNextSelectionInVisualOrder(items, { chordIndex: 0, voiceIndex: 0 }, -1),
    ).toEqual({ chordIndex: 0, voiceIndex: 1 });
  });
});

describe("reduceTypedPitchBuffer", () => {
  it("commits a parsed note when it is editable", () => {
    const afterA = reduceTypedPitchBuffer("", "A", asCandidateSet([57]));
    expect(afterA).toEqual({ nextBuffer: "A", commit: "none" });

    const after3 = reduceTypedPitchBuffer("A", "3", asCandidateSet([57]));
    expect(after3).toEqual({ nextBuffer: "", commit: "note", midi: 57 });
  });

  it("supports sharps and flats", () => {
    expect(
      reduceTypedPitchBuffer("F#", "3", asCandidateSet([54])),
    ).toEqual({ nextBuffer: "", commit: "note", midi: 54 });
    expect(
      reduceTypedPitchBuffer("Bb", "2", asCandidateSet([46])),
    ).toEqual({ nextBuffer: "", commit: "note", midi: 46 });
  });

  it("commits rest immediately for R", () => {
    expect(reduceTypedPitchBuffer("", "r", asCandidateSet([]))).toEqual({
      nextBuffer: "",
      commit: "rest",
    });
  });

  it("ignores completed notes that are not editable", () => {
    expect(
      reduceTypedPitchBuffer("A", "3", asCandidateSet([60])),
    ).toEqual({ nextBuffer: "", commit: "none" });
  });

  it("supports backspace and escape for the active buffer", () => {
    expect(
      reduceTypedPitchBuffer("F#3", "Backspace", asCandidateSet([54])),
    ).toEqual({ nextBuffer: "F#", commit: "none" });
    expect(
      reduceTypedPitchBuffer("F#", "Escape", asCandidateSet([54])),
    ).toEqual({ nextBuffer: "", commit: "none" });
  });

  it("ignores unsupported or impossible characters without mutating the buffer", () => {
    expect(reduceTypedPitchBuffer("A", "x", asCandidateSet([57]))).toBeNull();
    expect(
      reduceTypedPitchBuffer("A#", "#", asCandidateSet([58])),
    ).toEqual({ nextBuffer: "A#", commit: "none" });
  });
});
