import {
  getHarmonyLineNote,
  midiToNoteName,
  type Chord,
  type HarmonyLine,
  type MidiNote,
} from "./types";

export const ARRANGEMENT_TICKS_PER_BEAT = 4;

export type ArrangementEvent = {
  id: string;
  startTick: number;
  durationTicks: number;
  midi: MidiNote | null;
};

export type ArrangementVoice = {
  id: string;
  events: ArrangementEvent[];
};

export type CustomArrangement = {
  ticksPerBeat: number;
  voices: ArrangementVoice[];
};

export function createArrangementFromLines(
  lines: HarmonyLine[],
  chords: Chord[],
  ticksPerBeat = ARRANGEMENT_TICKS_PER_BEAT,
): CustomArrangement {
  const chordTicks = chords.map((chord) =>
    Math.max(1, Math.round(chord.beats * ticksPerBeat)),
  );

  return {
    ticksPerBeat,
    voices: lines.map((line, voiceIndex) => {
      let cursor = 0;
      const events: ArrangementEvent[] = [];

      for (let chordIndex = 0; chordIndex < chordTicks.length; chordIndex++) {
        const durationTicks = chordTicks[chordIndex] ?? ticksPerBeat;
        events.push({
          id: createArrangementEventId(voiceIndex, chordIndex, cursor),
          startTick: cursor,
          durationTicks,
          midi: getHarmonyLineNote(line, chordIndex),
        });
        cursor += durationTicks;
      }

      return {
        id: `voice-${voiceIndex}`,
        events,
      };
    }),
  };
}

export function getArrangementTotalTicks(
  arrangement: Pick<CustomArrangement, "voices"> | null | undefined,
): number {
  const firstVoice = arrangement?.voices[0];
  if (firstVoice == null) return 0;
  const lastEvent = firstVoice.events[firstVoice.events.length - 1];
  if (lastEvent == null) return 0;
  return lastEvent.startTick + lastEvent.durationTicks;
}

export function findActiveEventAtTick(
  voice: ArrangementVoice | null | undefined,
  tick: number,
): ArrangementEvent | null {
  if (voice == null) return null;
  for (const event of voice.events) {
    if (tick >= event.startTick && tick < event.startTick + event.durationTicks) {
      return event;
    }
  }
  return null;
}

export function getMidiAtTick(
  voice: ArrangementVoice | null | undefined,
  tick: number,
): MidiNote | null {
  return findActiveEventAtTick(voice, tick)?.midi ?? null;
}

export function sampleLinesAtTicks(
  arrangement: Pick<CustomArrangement, "voices"> | null | undefined,
  ticks: readonly number[],
): HarmonyLine[] {
  const voices = arrangement?.voices ?? [];
  return voices.map((voice) =>
    ticks.map((tick) => getMidiAtTick(voice, tick)),
  );
}

export function validateCustomArrangement(
  raw: unknown,
  expectedVoiceCount: number,
  totalTicks: number,
): CustomArrangement | null {
  if (
    typeof raw !== "object" ||
    raw == null ||
    Array.isArray(raw) ||
    typeof (raw as { ticksPerBeat?: unknown }).ticksPerBeat !== "number" ||
    !Array.isArray((raw as { voices?: unknown }).voices)
  ) {
    return null;
  }

  const ticksPerBeat = Math.round(
    (raw as { ticksPerBeat: number }).ticksPerBeat,
  );
  if (ticksPerBeat !== ARRANGEMENT_TICKS_PER_BEAT) {
    return null;
  }

  const voices = (raw as { voices: unknown[] }).voices
    .map((voice, voiceIndex) => parseArrangementVoice(voice, voiceIndex))
    .filter((voice): voice is ArrangementVoice => voice != null);

  if (voices.length !== expectedVoiceCount) {
    return null;
  }

  for (const voice of voices) {
    if (!voiceCoversTimeline(voice, totalTicks)) {
      return null;
    }
  }

  return {
    ticksPerBeat,
    voices,
  };
}

export function getFirstActiveMidi(
  voice: ArrangementVoice | null | undefined,
): MidiNote | null {
  if (voice == null) return null;
  for (const event of voice.events) {
    if (event.midi != null) {
      return event.midi;
    }
  }
  return null;
}

export function describeArrangementEvent(
  event: ArrangementEvent,
  ticksPerBeat: number,
): string {
  const beats = event.durationTicks / ticksPerBeat;
  const pitch = event.midi == null ? "Rest" : midiToNoteName(event.midi);
  return `${pitch} • ${formatBeatCount(beats)}`;
}

export function formatBeatCount(beats: number): string {
  if (Number.isInteger(beats)) {
    return `${beats} beat${beats === 1 ? "" : "s"}`;
  }
  return `${beats.toFixed(2).replace(/\.?0+$/, "")} beats`;
}

function parseArrangementVoice(
  raw: unknown,
  voiceIndex: number,
): ArrangementVoice | null {
  if (
    typeof raw !== "object" ||
    raw == null ||
    Array.isArray(raw) ||
    !Array.isArray((raw as { events?: unknown }).events)
  ) {
    return null;
  }

  const events = (raw as { events: unknown[] }).events
    .map((event, eventIndex) =>
      parseArrangementEvent(event, voiceIndex, eventIndex),
    )
    .filter((event): event is ArrangementEvent => event != null);

  if (events.length !== (raw as { events: unknown[] }).events.length) {
    return null;
  }

  return {
    id:
      typeof (raw as { id?: unknown }).id === "string"
        ? ((raw as { id: string }).id ?? `voice-${voiceIndex}`)
        : `voice-${voiceIndex}`,
    events,
  };
}

function parseArrangementEvent(
  raw: unknown,
  voiceIndex: number,
  eventIndex: number,
): ArrangementEvent | null {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return null;
  }

  const startTick = (raw as { startTick?: unknown }).startTick;
  const durationTicks = (raw as { durationTicks?: unknown }).durationTicks;
  const midi = (raw as { midi?: unknown }).midi;
  if (
    typeof startTick !== "number" ||
    !Number.isFinite(startTick) ||
    typeof durationTicks !== "number" ||
    !Number.isFinite(durationTicks) ||
    durationTicks <= 0 ||
    !Number.isInteger(startTick) ||
    !Number.isInteger(durationTicks) ||
    (midi !== null && (typeof midi !== "number" || !Number.isFinite(midi)))
  ) {
    return null;
  }

  return {
    id:
      typeof (raw as { id?: unknown }).id === "string"
        ? (raw as { id: string }).id
        : createArrangementEventId(voiceIndex, eventIndex, startTick),
    startTick,
    durationTicks,
    midi: midi as MidiNote | null,
  };
}

function voiceCoversTimeline(voice: ArrangementVoice, totalTicks: number): boolean {
  if (voice.events.length === 0) {
    return totalTicks === 0;
  }

  let cursor = 0;
  for (const event of voice.events) {
    if (event.startTick !== cursor) {
      return false;
    }
    cursor += event.durationTicks;
  }

  return cursor === totalTicks;
}

function createArrangementEventId(
  voiceIndex: number,
  eventIndex: number,
  startTick: number,
): string {
  return `voice-${voiceIndex}-event-${eventIndex}-${startTick}`;
}
