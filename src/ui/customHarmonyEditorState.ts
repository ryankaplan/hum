import {
  ARRANGEMENT_TICKS_PER_BEAT,
  type ArrangementEvent,
  type ArrangementVoice,
  type CustomArrangement,
} from "../music/arrangementScore";
import type { MidiNote } from "../music/types";

export type HarmonyEditorSelection = {
  voiceIndex: number;
  eventId: string;
};

export type ArrangementSelectionItem = HarmonyEditorSelection & {
  startTick: number;
  midi: MidiNote | null;
  kind: "note" | "rest";
};

export function cloneArrangement(
  arrangement: CustomArrangement,
): CustomArrangement {
  return {
    voices: arrangement.voices.map((voice) => ({
      id: voice.id,
      events: voice.events.map((event) => ({ ...event })),
    })),
  };
}

export function getSafeSelection(
  arrangement: CustomArrangement | null,
  selection: HarmonyEditorSelection | null,
): HarmonyEditorSelection | null {
  if (arrangement == null) return null;
  if (selection != null && getSelectedEvent(arrangement, selection) != null) {
    return selection;
  }
  for (let voiceIndex = 0; voiceIndex < arrangement.voices.length; voiceIndex++) {
    const event = arrangement.voices[voiceIndex]?.events[0];
    if (event != null) {
      return { voiceIndex, eventId: event.id };
    }
  }
  return null;
}

export function getSelectedEvent(
  arrangement: CustomArrangement | null,
  selection: HarmonyEditorSelection | null,
): ArrangementEvent | null {
  if (arrangement == null || selection == null) return null;
  return (
    arrangement.voices[selection.voiceIndex]?.events.find(
      (event) => event.id === selection.eventId,
    ) ?? null
  );
}

export function eventFitsWithinSpan(
  event: ArrangementEvent,
  span: { startTick: number; durationTicks: number },
): boolean {
  return (
    event.startTick >= span.startTick &&
    event.startTick + event.durationTicks <= span.startTick + span.durationTicks
  );
}

export function updateSelectedEventMidi(
  arrangement: CustomArrangement,
  selection: HarmonyEditorSelection,
  midi: MidiNote | null,
): CustomArrangement {
  return {
    ...arrangement,
    voices: arrangement.voices.map((voice, voiceIndex) =>
      voiceIndex !== selection.voiceIndex
        ? voice
        : {
            ...voice,
            events: voice.events.map((event) =>
              event.id === selection.eventId ? { ...event, midi } : event,
            ),
          },
    ),
  };
}

export function splitSelectedEventToBeats(
  arrangement: CustomArrangement,
  selection: HarmonyEditorSelection,
): { arrangement: CustomArrangement; selection: HarmonyEditorSelection } {
  return replaceSelectedEvent(arrangement, selection, (event, voiceIndex) => {
    const nextEvents: ArrangementEvent[] = [];
    let cursor = event.startTick;
    const eventEnd = event.startTick + event.durationTicks;
    let partIndex = 0;
    while (cursor < eventEnd) {
      const nextBoundary =
        Math.min(
          eventEnd,
          Math.floor(cursor / ARRANGEMENT_TICKS_PER_BEAT + 1) *
            ARRANGEMENT_TICKS_PER_BEAT,
        ) || eventEnd;
      const durationTicks = Math.max(1, nextBoundary - cursor);
      nextEvents.push({
        ...event,
        id: `${event.id}-split-${partIndex}`,
        startTick: cursor,
        durationTicks,
      });
      cursor += durationTicks;
      partIndex += 1;
    }
    return {
      nextEvents,
      nextSelection: { voiceIndex, eventId: nextEvents[0]?.id ?? event.id },
    };
  });
}

export function splitSelectedEventInHalf(
  arrangement: CustomArrangement,
  selection: HarmonyEditorSelection,
): { arrangement: CustomArrangement; selection: HarmonyEditorSelection } {
  return replaceSelectedEvent(arrangement, selection, (event, voiceIndex) => {
    const half = event.durationTicks / 2;
    return {
      nextEvents: [
        {
          ...event,
          id: `${event.id}-half-a`,
          durationTicks: half,
        },
        {
          ...event,
          id: `${event.id}-half-b`,
          startTick: event.startTick + half,
          durationTicks: half,
        },
      ],
      nextSelection: { voiceIndex, eventId: `${event.id}-half-a` },
    };
  });
}

export function mergeSelectedEventWithNext(
  arrangement: CustomArrangement,
  selection: HarmonyEditorSelection,
): { arrangement: CustomArrangement; selection: HarmonyEditorSelection } {
  return replaceSelectedEvent(arrangement, selection, (event, voiceIndex, voice) => {
    const currentIndex = voice.events.findIndex((entry) => entry.id === event.id);
    const nextEvent = voice.events[currentIndex + 1];
    if (
      nextEvent == null ||
      nextEvent.midi !== event.midi ||
      nextEvent.startTick !== event.startTick + event.durationTicks
    ) {
      return {
        nextEvents: [event],
        nextSelection: selection,
      };
    }
    return {
      nextEvents: [
        {
          ...event,
          durationTicks: event.durationTicks + nextEvent.durationTicks,
        },
      ],
      removeFollowingCount: 1,
      nextSelection: { voiceIndex, eventId: event.id },
    };
  });
}

export function canMergeWithNext(
  voice: ArrangementVoice | undefined,
  selectedEvent: ArrangementEvent | null,
): boolean {
  if (voice == null || selectedEvent == null) return false;
  const eventIndex = voice.events.findIndex((event) => event.id === selectedEvent.id);
  const nextEvent = voice.events[eventIndex + 1];
  return (
    nextEvent != null &&
    nextEvent.midi === selectedEvent.midi &&
    nextEvent.startTick === selectedEvent.startTick + selectedEvent.durationTicks
  );
}

export function getArrangementSelectionItems(
  arrangement: CustomArrangement | null,
): ArrangementSelectionItem[] {
  if (arrangement == null) return [];
  const items: ArrangementSelectionItem[] = [];
  arrangement.voices.forEach((voice, voiceIndex) => {
    voice.events.forEach((event) => {
      items.push({
        voiceIndex,
        eventId: event.id,
        startTick: event.startTick,
        midi: event.midi,
        kind: event.midi == null ? "rest" : "note",
      });
    });
  });
  items.sort((left, right) => {
    if (left.startTick !== right.startTick) return left.startTick - right.startTick;
    if (left.kind !== right.kind) return left.kind === "note" ? -1 : 1;
    if ((left.midi ?? -1) !== (right.midi ?? -1)) {
      return (right.midi ?? -1) - (left.midi ?? -1);
    }
    return left.voiceIndex - right.voiceIndex;
  });
  return items;
}

export function getNextSelectionInArrangementOrder(
  items: readonly ArrangementSelectionItem[],
  selection: HarmonyEditorSelection | null,
  direction: -1 | 1,
): HarmonyEditorSelection | null {
  if (selection == null) return null;
  const currentIndex = items.findIndex(
    (item) => item.voiceIndex === selection.voiceIndex && item.eventId === selection.eventId,
  );
  if (currentIndex === -1) return null;
  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return null;
  const nextItem = items[nextIndex];
  return nextItem == null
    ? null
    : { voiceIndex: nextItem.voiceIndex, eventId: nextItem.eventId };
}

function replaceSelectedEvent(
  arrangement: CustomArrangement,
  selection: HarmonyEditorSelection,
  replacer: (
    event: ArrangementEvent,
    voiceIndex: number,
    voice: ArrangementVoice,
  ) => {
    nextEvents: ArrangementEvent[];
    nextSelection: HarmonyEditorSelection;
    removeFollowingCount?: number;
  },
): { arrangement: CustomArrangement; selection: HarmonyEditorSelection } {
  const voice = arrangement.voices[selection.voiceIndex];
  if (voice == null) {
    return { arrangement, selection };
  }
  const eventIndex = voice.events.findIndex((event) => event.id === selection.eventId);
  const event = voice.events[eventIndex];
  if (event == null) {
    return { arrangement, selection };
  }
  const replacement = replacer(event, selection.voiceIndex, voice);
  const removeCount = 1 + (replacement.removeFollowingCount ?? 0);
  const nextVoice: ArrangementVoice = {
    ...voice,
    events: [
      ...voice.events.slice(0, eventIndex),
      ...replacement.nextEvents,
      ...voice.events.slice(eventIndex + removeCount),
    ],
  };
  return {
    arrangement: {
      ...arrangement,
      voices: arrangement.voices.map((candidate, voiceIndex) =>
        voiceIndex === selection.voiceIndex ? nextVoice : candidate,
      ),
    },
    selection: replacement.nextSelection,
  };
}
