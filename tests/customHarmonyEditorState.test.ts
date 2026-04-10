import { describe, expect, it } from "vitest";
import type { CustomArrangement } from "../src/music/arrangementScore";
import {
  canMergeWithNext,
  cloneArrangement,
  getArrangementSelectionItems,
  getNextSelectionInArrangementOrder,
  getSafeSelection,
  getSelectedEvent,
  mergeSelectedEventWithNext,
  splitSelectedEventInHalf,
  splitSelectedEventToBeats,
  updateSelectedEventMidi,
} from "../src/ui/customHarmonyEditorState";

function makeArrangement(): CustomArrangement {
  return {
    voices: [
      {
        id: "voice-0",
        events: [
          { id: "a", startTick: 0, durationTicks: 8, midi: 60 },
          { id: "b", startTick: 8, durationTicks: 8, midi: 60 },
          { id: "c", startTick: 16, durationTicks: 8, midi: null },
        ],
      },
      {
        id: "voice-1",
        events: [
          { id: "d", startTick: 0, durationTicks: 16, midi: 64 },
          { id: "e", startTick: 16, durationTicks: 8, midi: 67 },
        ],
      },
    ],
  };
}

describe("customHarmonyEditorState", () => {
  it("clones arrangements without sharing nested references", () => {
    const arrangement = makeArrangement();
    const cloned = cloneArrangement(arrangement);

    cloned.voices[0]!.events[0]!.midi = 55;

    expect(arrangement.voices[0]!.events[0]!.midi).toBe(60);
  });

  it("keeps an existing valid selection and falls back when needed", () => {
    const arrangement = makeArrangement();

    expect(
      getSafeSelection(arrangement, { voiceIndex: 1, eventId: "e" }),
    ).toEqual({ voiceIndex: 1, eventId: "e" });
    expect(
      getSafeSelection(arrangement, { voiceIndex: 1, eventId: "missing" }),
    ).toEqual({ voiceIndex: 0, eventId: "a" });
  });

  it("orders arrangement selections by tick, then notes before rests", () => {
    const items = getArrangementSelectionItems(makeArrangement());

    expect(items.map(({ eventId }) => eventId)).toEqual(["d", "a", "b", "e", "c"]);
    expect(
      getNextSelectionInArrangementOrder(items, { voiceIndex: 1, eventId: "d" }, 1),
    ).toEqual({ voiceIndex: 0, eventId: "a" });
  });

  it("updates the selected event midi without touching other events", () => {
    const updated = updateSelectedEventMidi(
      makeArrangement(),
      { voiceIndex: 0, eventId: "c" },
      65,
    );

    expect(getSelectedEvent(updated, { voiceIndex: 0, eventId: "c" })?.midi).toBe(65);
    expect(getSelectedEvent(updated, { voiceIndex: 1, eventId: "d" })?.midi).toBe(64);
  });

  it("splits the selected event to beat boundaries", () => {
    const result = splitSelectedEventToBeats(
      makeArrangement(),
      { voiceIndex: 1, eventId: "d" },
    );

    expect(result.selection).toEqual({ voiceIndex: 1, eventId: "d-split-0" });
    expect(result.arrangement.voices[1]?.events.slice(0, 2)).toEqual([
      { id: "d-split-0", startTick: 0, durationTicks: 4, midi: 64 },
      { id: "d-split-1", startTick: 4, durationTicks: 4, midi: 64 },
    ]);
  });

  it("splits the selected event in half", () => {
    const result = splitSelectedEventInHalf(
      makeArrangement(),
      { voiceIndex: 0, eventId: "a" },
    );

    expect(result.selection).toEqual({ voiceIndex: 0, eventId: "a-half-a" });
    expect(result.arrangement.voices[0]?.events.slice(0, 2)).toEqual([
      { id: "a-half-a", startTick: 0, durationTicks: 4, midi: 60 },
      { id: "a-half-b", startTick: 4, durationTicks: 4, midi: 60 },
    ]);
  });

  it("detects merge candidates and merges with the next event", () => {
    const arrangement = makeArrangement();
    const selectedEvent = getSelectedEvent(arrangement, {
      voiceIndex: 0,
      eventId: "a",
    });
    expect(canMergeWithNext(arrangement.voices[0], selectedEvent)).toBe(true);

    const result = mergeSelectedEventWithNext(arrangement, {
      voiceIndex: 0,
      eventId: "a",
    });

    expect(result.arrangement.voices[0]?.events).toEqual([
      { id: "a", startTick: 0, durationTicks: 16, midi: 60 },
      { id: "c", startTick: 16, durationTicks: 8, midi: null },
    ]);
  });
});
