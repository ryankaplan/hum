import type { HarmonyLine, Meter } from "./types";
import { getHarmonyLineNote } from "./types";
import type { ChordEvent } from "./arrangementTimeline";
import {
  ARRANGEMENT_TICKS_PER_BEAT,
  type ArrangementEvent,
  type CustomArrangement,
} from "./arrangementScore";

export type HarmonyRhythmPatternId =
  | "sustain_pad"
  | "strong_beats"
  | "beat_pulse"
  | "backbeat_hits"
  | "upbeat_drive"
  | "anthem_lift"
  | "eighth_drive"
  | "chorus_push"
  | "broadway_hits"
  | "finale_hits"
  | "charleston"
  | "offbeat_comp"
  | "praise_lift"
  | "three_plus_three_plus_two"
  | "show_waltz"
  | "waltz_lift"
  | "waltz_block"
  | "sway_six"
  | "lift_six"
  | "compound_swell";

type HarmonyRhythmSlot = {
  startBeat: number;
  durationBeats: number;
};

type HarmonyRhythmPatternVariant = {
  alignment: "chord" | "measure";
  slots: readonly HarmonyRhythmSlot[];
  previewStepBeats: number;
};

export type HarmonyRhythmPatternDefinition = {
  id: HarmonyRhythmPatternId;
  name: string;
  description: string;
  tags: readonly string[];
  meters: Partial<Record<"4/4" | "3/4" | "6/8", HarmonyRhythmPatternVariant>>;
};

export type HarmonyRhythmPreviewHit = {
  startBeat: number;
  isDownbeat: boolean;
};

const FOUR_FOUR = "4/4";
const THREE_FOUR = "3/4";
const SIX_EIGHT = "6/8";

export const DEFAULT_HARMONY_RHYTHM_PATTERN_ID: HarmonyRhythmPatternId =
  "sustain_pad";

export const HARMONY_RHYTHM_PATTERNS: readonly HarmonyRhythmPatternDefinition[] = [
  {
    id: "sustain_pad",
    name: "Sustain",
    description: "Attack on the change and hold through the chord.",
    tags: ["pop", "choral"],
    meters: {
      [FOUR_FOUR]: {
        alignment: "chord",
        slots: [{ startBeat: 0, durationBeats: 4 }],
        previewStepBeats: 0.5,
      },
      [THREE_FOUR]: {
        alignment: "chord",
        slots: [{ startBeat: 0, durationBeats: 3 }],
        previewStepBeats: 0.5,
      },
      [SIX_EIGHT]: {
        alignment: "chord",
        slots: [{ startBeat: 0, durationBeats: 6 }],
        previewStepBeats: 1,
      },
    },
  },
  {
    id: "strong_beats",
    name: "Downbeats",
    description: "Re-articulate the structural beats and let them ring.",
    tags: ["pop", "gospel"],
    meters: {
      [FOUR_FOUR]: {
        alignment: "measure",
        slots: [
          { startBeat: 0, durationBeats: 1.5 },
          { startBeat: 2, durationBeats: 1.5 },
        ],
        previewStepBeats: 0.5,
      },
      [THREE_FOUR]: {
        alignment: "measure",
        slots: [{ startBeat: 0, durationBeats: 2.25 }],
        previewStepBeats: 0.5,
      },
      [SIX_EIGHT]: {
        alignment: "measure",
        slots: [
          { startBeat: 0, durationBeats: 2.5 },
          { startBeat: 3, durationBeats: 2.5 },
        ],
        previewStepBeats: 1,
      },
    },
  },
  {
    id: "beat_pulse",
    name: "Beat Pulse",
    description: "Short attacks on every beat.",
    tags: ["pop", "gospel", "choral"],
    meters: {
      [FOUR_FOUR]: {
        alignment: "measure",
        slots: [
          { startBeat: 0, durationBeats: 0.75 },
          { startBeat: 1, durationBeats: 0.75 },
          { startBeat: 2, durationBeats: 0.75 },
          { startBeat: 3, durationBeats: 0.75 },
        ],
        previewStepBeats: 0.5,
      },
      [THREE_FOUR]: {
        alignment: "measure",
        slots: [
          { startBeat: 0, durationBeats: 0.75 },
          { startBeat: 1, durationBeats: 0.75 },
          { startBeat: 2, durationBeats: 0.75 },
        ],
        previewStepBeats: 0.5,
      },
      [SIX_EIGHT]: {
        alignment: "measure",
        slots: [
          { startBeat: 0, durationBeats: 0.8 },
          { startBeat: 1, durationBeats: 0.8 },
          { startBeat: 2, durationBeats: 0.8 },
          { startBeat: 3, durationBeats: 0.8 },
          { startBeat: 4, durationBeats: 0.8 },
          { startBeat: 5, durationBeats: 0.8 },
        ],
        previewStepBeats: 1,
      },
    },
  },
  {
    id: "backbeat_hits",
    name: "Backbeat Hits",
    description: "Punch the backbeat with short hits on 2 and 4.",
    tags: ["pop", "rnb"],
    meters: {
      [FOUR_FOUR]: {
        alignment: "measure",
        slots: [
          { startBeat: 1, durationBeats: 0.85 },
          { startBeat: 3, durationBeats: 0.85 },
        ],
        previewStepBeats: 0.5,
      },
    },
  },
  {
    id: "upbeat_drive",
    name: "Upbeat Drive",
    description: "Push every offbeat with upbeat attacks.",
    tags: ["pop", "gospel"],
    meters: {
      [FOUR_FOUR]: {
        alignment: "measure",
        slots: [
          { startBeat: 0.5, durationBeats: 0.5 },
          { startBeat: 1.5, durationBeats: 0.5 },
          { startBeat: 2.5, durationBeats: 0.5 },
          { startBeat: 3.5, durationBeats: 0.5 },
        ],
        previewStepBeats: 0.5,
      },
    },
  },
  {
    id: "anthem_lift",
    name: "Anthem Lift",
    description: "Broad hits on 1 and 4 for a lifted pop feel.",
    tags: ["pop", "worship"],
    meters: {
      [FOUR_FOUR]: {
        alignment: "measure",
        slots: [
          { startBeat: 0, durationBeats: 1.75 },
          { startBeat: 3, durationBeats: 1 },
        ],
        previewStepBeats: 0.5,
      },
    },
  },
  {
    id: "eighth_drive",
    name: "Eighths",
    description: "Continuous eighth-note attacks for a driving pop feel.",
    tags: ["pop", "theater"],
    meters: {
      [FOUR_FOUR]: {
        alignment: "measure",
        slots: [
          { startBeat: 0, durationBeats: 0.3 },
          { startBeat: 0.5, durationBeats: 0.3 },
          { startBeat: 1, durationBeats: 0.3 },
          { startBeat: 1.5, durationBeats: 0.3 },
          { startBeat: 2, durationBeats: 0.3 },
          { startBeat: 2.5, durationBeats: 0.3 },
          { startBeat: 3, durationBeats: 0.3 },
          { startBeat: 3.5, durationBeats: 0.3 },
        ],
        previewStepBeats: 0.5,
      },
    },
  },
  {
    id: "chorus_push",
    name: "Chorus",
    description: "A lifted pop chorus pattern with syncopated pushes.",
    tags: ["pop", "theater"],
    meters: {
      [FOUR_FOUR]: {
        alignment: "measure",
        slots: [
          { startBeat: 0, durationBeats: 0.85 },
          { startBeat: 1.5, durationBeats: 0.65 },
          { startBeat: 2.5, durationBeats: 0.65 },
          { startBeat: 3.5, durationBeats: 0.5 },
        ],
        previewStepBeats: 0.5,
      },
    },
  },
  {
    id: "broadway_hits",
    name: "Broadway",
    description: "Bright stage-style punches that sit right in a show tune.",
    tags: ["theater", "pop"],
    meters: {
      [FOUR_FOUR]: {
        alignment: "measure",
        slots: [
          { startBeat: 0, durationBeats: 0.8 },
          { startBeat: 1, durationBeats: 0.6 },
          { startBeat: 2.5, durationBeats: 0.6 },
          { startBeat: 3.5, durationBeats: 0.45 },
        ],
        previewStepBeats: 0.5,
      },
    },
  },
  {
    id: "finale_hits",
    name: "Finale",
    description: "Big stage-ready accents for a climactic ending feel.",
    tags: ["theater", "pop"],
    meters: {
      [FOUR_FOUR]: {
        alignment: "measure",
        slots: [
          { startBeat: 0, durationBeats: 0.95 },
          { startBeat: 1.5, durationBeats: 0.65 },
          { startBeat: 2, durationBeats: 0.6 },
          { startBeat: 3, durationBeats: 0.85 },
        ],
        previewStepBeats: 0.5,
      },
    },
  },
  {
    id: "charleston",
    name: "Charleston",
    description: "Classic hit on 1, then the and of 2.",
    tags: ["jazz"],
    meters: {
      [FOUR_FOUR]: {
        alignment: "measure",
        slots: [
          { startBeat: 0, durationBeats: 1.25 },
          { startBeat: 1.5, durationBeats: 1 },
        ],
        previewStepBeats: 0.5,
      },
    },
  },
  {
    id: "offbeat_comp",
    name: "Offbeat Comp",
    description: "Short syncopated answers on the back half of the bar.",
    tags: ["jazz"],
    meters: {
      [FOUR_FOUR]: {
        alignment: "measure",
        slots: [
          { startBeat: 1.5, durationBeats: 0.75 },
          { startBeat: 3.5, durationBeats: 0.5 },
        ],
        previewStepBeats: 0.5,
      },
    },
  },
  {
    id: "praise_lift",
    name: "Praise Lift",
    description: "Hold the downbeat, then answer with a pickup on the and of 4.",
    tags: ["gospel", "worship"],
    meters: {
      [FOUR_FOUR]: {
        alignment: "measure",
        slots: [
          { startBeat: 0, durationBeats: 2.5 },
          { startBeat: 3.5, durationBeats: 0.5 },
        ],
        previewStepBeats: 0.5,
      },
    },
  },
  {
    id: "three_plus_three_plus_two",
    name: "3+3+2 Lift",
    description: "A familiar pop and gospel 3+3+2 accent shape.",
    tags: ["pop", "gospel"],
    meters: {
      [FOUR_FOUR]: {
        alignment: "measure",
        slots: [
          { startBeat: 0, durationBeats: 1 },
          { startBeat: 1.5, durationBeats: 1 },
          { startBeat: 3, durationBeats: 0.75 },
        ],
        previewStepBeats: 0.5,
      },
    },
  },
  {
    id: "show_waltz",
    name: "Show Waltz",
    description: "A lyrical waltz pulse common in musical theater.",
    tags: ["theater", "waltz"],
    meters: {
      [THREE_FOUR]: {
        alignment: "measure",
        slots: [
          { startBeat: 0, durationBeats: 0.8 },
          { startBeat: 1.5, durationBeats: 0.55 },
          { startBeat: 2.5, durationBeats: 0.45 },
        ],
        previewStepBeats: 0.5,
      },
    },
  },
  {
    id: "waltz_lift",
    name: "Waltz Lift",
    description: "Open 3/4 accents that leave room for a singing line.",
    tags: ["pop", "theater"],
    meters: {
      [THREE_FOUR]: {
        alignment: "measure",
        slots: [
          { startBeat: 0, durationBeats: 1.25 },
          { startBeat: 2, durationBeats: 0.8 },
        ],
        previewStepBeats: 0.5,
      },
    },
  },
  {
    id: "waltz_block",
    name: "Waltz Block",
    description: "Steady 3/4 re-attacks across the bar.",
    tags: ["choral", "folk"],
    meters: {
      [THREE_FOUR]: {
        alignment: "measure",
        slots: [
          { startBeat: 0, durationBeats: 0.75 },
          { startBeat: 1, durationBeats: 0.75 },
          { startBeat: 2, durationBeats: 0.75 },
        ],
        previewStepBeats: 0.5,
      },
    },
  },
  {
    id: "sway_six",
    name: "Sway 6/8",
    description: "A lilting 6/8 sway often heard in pop ballads and theater.",
    tags: ["pop", "theater"],
    meters: {
      [SIX_EIGHT]: {
        alignment: "measure",
        slots: [
          { startBeat: 0, durationBeats: 0.85 },
          { startBeat: 2, durationBeats: 0.65 },
          { startBeat: 3, durationBeats: 0.85 },
          { startBeat: 5, durationBeats: 0.55 },
        ],
        previewStepBeats: 1,
      },
    },
  },
  {
    id: "lift_six",
    name: "Lift 6/8",
    description: "Broad 6/8 pushes that bloom toward the end of the bar.",
    tags: ["pop", "theater"],
    meters: {
      [SIX_EIGHT]: {
        alignment: "measure",
        slots: [
          { startBeat: 0, durationBeats: 1.8 },
          { startBeat: 3, durationBeats: 1.4 },
          { startBeat: 5, durationBeats: 0.5 },
        ],
        previewStepBeats: 1,
      },
    },
  },
  {
    id: "compound_swell",
    name: "Compound Swell",
    description: "Broad 6/8 swells on 1 and 4.",
    tags: ["gospel", "choral"],
    meters: {
      [SIX_EIGHT]: {
        alignment: "measure",
        slots: [
          { startBeat: 0, durationBeats: 2.5 },
          { startBeat: 3, durationBeats: 2.5 },
        ],
        previewStepBeats: 1,
      },
    },
  },
] as const;

export function getHarmonyRhythmPattern(
  patternId: HarmonyRhythmPatternId,
): HarmonyRhythmPatternDefinition {
  return (
    HARMONY_RHYTHM_PATTERNS.find((pattern) => pattern.id === patternId) ??
    HARMONY_RHYTHM_PATTERNS[0]
  )!;
}

export function parseHarmonyRhythmPatternId(
  raw: unknown,
): HarmonyRhythmPatternId {
  return HARMONY_RHYTHM_PATTERNS.some((pattern) => pattern.id === raw)
    ? (raw as HarmonyRhythmPatternId)
    : DEFAULT_HARMONY_RHYTHM_PATTERN_ID;
}

export function getAvailableHarmonyRhythmPatterns(
  meter: Meter,
): HarmonyRhythmPatternDefinition[] {
  const meterKey = meterToKey(meter);
  return HARMONY_RHYTHM_PATTERNS.filter(
    (pattern) => pattern.meters[meterKey] != null,
  );
}

export function getHarmonyRhythmPreviewSteps(
  pattern: HarmonyRhythmPatternDefinition,
  meter: Meter,
): boolean[] {
  const variant = pattern.meters[meterToKey(meter)];
  if (variant == null) return [];

  const stepBeats = variant.previewStepBeats;
  const totalSteps = Math.max(1, Math.round(meter[0] / stepBeats));
  return Array.from({ length: totalSteps }, (_, stepIndex) => {
    const stepStart = stepIndex * stepBeats;
    return variant.slots.some((slot) => Math.abs(slot.startBeat - stepStart) < 0.001);
  });
}

export function getHarmonyRhythmPreviewHits(
  patternId: HarmonyRhythmPatternId,
  meter: Meter,
  measureCount: number,
): HarmonyRhythmPreviewHit[] {
  const variant = getHarmonyRhythmPatternVariant(patternId, meter);
  if (variant == null) return [];

  const beatsPerBar = Math.max(1, meter[0]);
  const hits: HarmonyRhythmPreviewHit[] = [];

  for (let measureIndex = 0; measureIndex < Math.max(1, measureCount); measureIndex++) {
    const measureStart = measureIndex * beatsPerBar;

    if (variant.alignment === "chord") {
      hits.push({
        startBeat: measureStart,
        isDownbeat: true,
      });
      continue;
    }

    for (const slot of variant.slots) {
      hits.push({
        startBeat: measureStart + slot.startBeat,
        isDownbeat: Math.abs(slot.startBeat) < 0.001,
      });
    }
  }

  return hits;
}

export function createArrangementFromPattern(
  lines: HarmonyLine[],
  chordEvents: ChordEvent[],
  meter: Meter,
  patternId: HarmonyRhythmPatternId,
): CustomArrangement {
  const variant = getHarmonyRhythmPatternVariant(patternId, meter);
  const totalBeats = getTotalChordEventBeats(chordEvents);

  if (variant == null) {
    return { voices: lines.map((_, voiceIndex) => ({ id: `voice-${voiceIndex}`, events: [] })) };
  }

  return {
    voices: lines.map((line, voiceIndex) => ({
      id: `voice-${voiceIndex}`,
      events: buildVoiceEvents(line, chordEvents, meter[0], variant, totalBeats, voiceIndex),
    })),
  };
}

function getHarmonyRhythmPatternVariant(
  patternId: HarmonyRhythmPatternId,
  meter: Meter,
): HarmonyRhythmPatternVariant | null {
  const meterKey = meterToKey(meter);
  return (
    getHarmonyRhythmPattern(patternId).meters[meterKey] ??
    getHarmonyRhythmPattern(DEFAULT_HARMONY_RHYTHM_PATTERN_ID).meters[meterKey] ??
    null
  );
}

function buildVoiceEvents(
  line: HarmonyLine,
  chordEvents: ChordEvent[],
  beatsPerBar: number,
  variant: HarmonyRhythmPatternVariant,
  totalBeats: number,
  voiceIndex: number,
): ArrangementEvent[] {
  const noteEvents =
    variant.alignment === "chord"
      ? buildChordAlignedEvents(line, chordEvents)
      : buildMeasureAlignedEvents(line, chordEvents, beatsPerBar, variant, totalBeats);

  return fillVoiceTimeline(noteEvents, totalBeats, voiceIndex);
}

function buildChordAlignedEvents(
  line: HarmonyLine,
  chordEvents: ChordEvent[],
): Array<{ startBeat: number; endBeat: number; midi: number | null }> {
  return chordEvents.map((event, chordIndex) => ({
    startBeat: event.startBeat,
    endBeat: event.startBeat + event.durationBeats,
    midi: getHarmonyLineNote(line, chordIndex),
  }));
}

function buildMeasureAlignedEvents(
  line: HarmonyLine,
  chordEvents: ChordEvent[],
  beatsPerBar: number,
  variant: HarmonyRhythmPatternVariant,
  totalBeats: number,
): Array<{ startBeat: number; endBeat: number; midi: number | null }> {
  const noteEvents: Array<{ startBeat: number; endBeat: number; midi: number | null }> = [];
  const measureCount = Math.max(1, Math.ceil(totalBeats / Math.max(1, beatsPerBar)));

  for (let measureIndex = 0; measureIndex < measureCount; measureIndex++) {
    const measureStart = measureIndex * beatsPerBar;
    const measureEnd = Math.min(totalBeats, measureStart + beatsPerBar);

    for (const slot of variant.slots) {
      const windowStart = measureStart + slot.startBeat;
      const windowEnd = Math.min(measureEnd, windowStart + slot.durationBeats);
      if (windowEnd <= windowStart) continue;

      for (let chordIndex = 0; chordIndex < chordEvents.length; chordIndex++) {
        const event = chordEvents[chordIndex]!;
        const overlapStart = Math.max(windowStart, event.startBeat);
        const overlapEnd = Math.min(windowEnd, event.startBeat + event.durationBeats);
        if (overlapEnd <= overlapStart) continue;
        noteEvents.push({
          startBeat: overlapStart,
          endBeat: overlapEnd,
          midi: getHarmonyLineNote(line, chordIndex),
        });
      }
    }
  }

  return noteEvents;
}

function fillVoiceTimeline(
  noteEvents: Array<{ startBeat: number; endBeat: number; midi: number | null }>,
  totalBeats: number,
  voiceIndex: number,
): ArrangementEvent[] {
  const sorted = [...noteEvents]
    .filter((event) => event.endBeat > event.startBeat)
    .sort((left, right) => left.startBeat - right.startBeat);

  const events: ArrangementEvent[] = [];
  let cursorBeat = 0;

  for (const event of sorted) {
    if (event.startBeat > cursorBeat) {
      events.push(
        makeArrangementEvent(voiceIndex, events.length, cursorBeat, event.startBeat, null),
      );
    }
    events.push(
      makeArrangementEvent(
        voiceIndex,
        events.length,
        event.startBeat,
        event.endBeat,
        event.midi,
      ),
    );
    cursorBeat = event.endBeat;
  }

  if (cursorBeat < totalBeats) {
    events.push(
      makeArrangementEvent(voiceIndex, events.length, cursorBeat, totalBeats, null),
    );
  }

  return mergeAdjacentEvents(events);
}

function mergeAdjacentEvents(events: ArrangementEvent[]): ArrangementEvent[] {
  const merged: ArrangementEvent[] = [];

  for (const event of events) {
    if (event.durationTicks <= 0) continue;
    const previous = merged[merged.length - 1];
    if (
      previous != null &&
      previous.midi == null &&
      event.midi == null &&
      previous.startTick + previous.durationTicks === event.startTick
    ) {
      previous.durationTicks += event.durationTicks;
      continue;
    }
    merged.push({ ...event });
  }

  return merged.map((event, eventIndex) => ({
    ...event,
    id: `voice-${getVoiceIndexFromId(event.id)}-event-${eventIndex}-${event.startTick}`,
  }));
}

function makeArrangementEvent(
  voiceIndex: number,
  eventIndex: number,
  startBeat: number,
  endBeat: number,
  midi: number | null,
): ArrangementEvent {
  const startTick = Math.round(startBeat * ARRANGEMENT_TICKS_PER_BEAT);
  const endTick = Math.round(endBeat * ARRANGEMENT_TICKS_PER_BEAT);
  return {
    id: `voice-${voiceIndex}-event-${eventIndex}-${startTick}`,
    startTick,
    durationTicks: Math.max(1, endTick - startTick),
    midi,
  };
}

function meterToKey(meter: Meter): "4/4" | "3/4" | "6/8" {
  const key = `${meter[0]}/${meter[1]}`;
  if (key === THREE_FOUR || key === SIX_EIGHT) {
    return key;
  }
  return FOUR_FOUR;
}

function getTotalChordEventBeats(chordEvents: ChordEvent[]): number {
  const last = chordEvents[chordEvents.length - 1];
  return last == null ? 0 : last.startBeat + last.durationBeats;
}

function getVoiceIndexFromId(id: string): number {
  const match = id.match(/^voice-(\d+)-/);
  return match == null ? 0 : Number.parseInt(match[1]!, 10) || 0;
}
