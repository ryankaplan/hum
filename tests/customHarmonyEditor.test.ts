import { describe, expect, it } from "vitest";
import { getNextMidiForArrowMove } from "../src/ui/CustomHarmonyEditor";

describe("getNextMidiForArrowMove", () => {
  it("moves an in-range note by one semitone", () => {
    expect(getNextMidiForArrowMove(60, 1, 48, 72)).toBe(61);
    expect(getNextMidiForArrowMove(60, -1, 48, 72)).toBe(59);
  });

  it("stops at the range boundaries", () => {
    expect(getNextMidiForArrowMove(48, -1, 48, 72)).toBeNull();
    expect(getNextMidiForArrowMove(72, 1, 48, 72)).toBeNull();
  });

  it("does nothing for rested slots", () => {
    expect(getNextMidiForArrowMove(null, 1, 48, 72)).toBeNull();
  });

  it("snaps out-of-range notes inward only when moving toward the range", () => {
    expect(getNextMidiForArrowMove(44, 1, 48, 72)).toBe(48);
    expect(getNextMidiForArrowMove(44, -1, 48, 72)).toBeNull();
    expect(getNextMidiForArrowMove(76, -1, 48, 72)).toBe(72);
    expect(getNextMidiForArrowMove(76, 1, 48, 72)).toBeNull();
  });
});
