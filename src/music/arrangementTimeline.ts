import { ARRANGEMENT_TICKS_PER_BEAT } from "./arrangementScore";
import { parseChordText } from "./parse";
import type { Chord } from "./types";

export type ParsedChordToken = {
  id: string;
  chordText: string;
  lyrics: string;
  beats: number;
  column: number;
};

export type ChordEvent = {
  id: string;
  chordText: string;
  lyrics: string;
  chord: Chord;
  startBeat: number;
  durationBeats: number;
};

export type ArrangementMeasureSliceSegmentKind =
  | "single"
  | "start"
  | "middle"
  | "end";

export type ArrangementMeasureSlice = {
  id: string;
  chordEventIndex: number;
  chordEventId: string;
  chordText: string;
  lyrics: string;
  startBeatInMeasure: number;
  durationBeats: number;
  segmentKind: ArrangementMeasureSliceSegmentKind;
};

export type ArrangementMeasure = {
  id: string;
  measureIndex: number;
  slices: ArrangementMeasureSlice[];
};

export function buildChordEvents(
  tokens: ParsedChordToken[],
  beatsPerBar: number,
): {
  chordEvents: ChordEvent[];
  invalidChordIds: string[];
  parseIssues: string[];
} {
  const chordEvents: ChordEvent[] = [];
  const invalidChordIds: string[] = [];
  const parseIssues: string[] = [];
  let startBeat = 0;

  for (const token of tokens) {
    const durationBeats = token.beats * beatsPerBar;
    const chord = parseChordText(token.chordText, durationBeats);
    if (chord == null) {
      invalidChordIds.push(token.id);
      parseIssues.push(`unsupported chord token "${token.chordText}".`);
      continue;
    }

    chordEvents.push({
      id: token.id,
      chordText: token.chordText,
      lyrics: token.lyrics,
      chord,
      startBeat,
      durationBeats,
    });
    startBeat += durationBeats;
  }

  return { chordEvents, invalidChordIds, parseIssues };
}

export function deriveMeasuresFromChordEvents(
  chordEvents: ChordEvent[],
  beatsPerBar: number,
): ArrangementMeasure[] {
  if (beatsPerBar <= 0 || chordEvents.length === 0) return [];

  const measures = new Map<number, ArrangementMeasureSlice[]>();

  for (let chordEventIndex = 0; chordEventIndex < chordEvents.length; chordEventIndex++) {
    const event = chordEvents[chordEventIndex]!;
    const start = event.startBeat;
    const end = event.startBeat + event.durationBeats;
    const startMeasureIndex = Math.floor(start / beatsPerBar);
    const endMeasureIndex = Math.floor((Math.max(start, end - 0.000001)) / beatsPerBar);

    for (let measureIndex = startMeasureIndex; measureIndex <= endMeasureIndex; measureIndex++) {
      const measureStart = measureIndex * beatsPerBar;
      const measureEnd = measureStart + beatsPerBar;
      const sliceStart = Math.max(start, measureStart);
      const sliceEnd = Math.min(end, measureEnd);
      const durationBeats = sliceEnd - sliceStart;
      if (durationBeats <= 0) continue;

      const segmentKind =
        startMeasureIndex === endMeasureIndex
          ? "single"
          : measureIndex === startMeasureIndex
            ? "start"
            : measureIndex === endMeasureIndex
              ? "end"
              : "middle";

      const slices = measures.get(measureIndex) ?? [];
      slices.push({
        id: `${event.id}-measure-${measureIndex}`,
        chordEventIndex,
        chordEventId: event.id,
        chordText: event.chordText,
        lyrics:
          segmentKind === "single" || segmentKind === "start" ? event.lyrics : "",
        startBeatInMeasure: sliceStart - measureStart,
        durationBeats,
        segmentKind,
      });
      measures.set(measureIndex, slices);
    }
  }

  const lastBeat = totalChordEventBeats(chordEvents);
  const measureCount = Math.max(1, Math.ceil(lastBeat / beatsPerBar));
  const result: ArrangementMeasure[] = [];
  for (let measureIndex = 0; measureIndex < measureCount; measureIndex++) {
    result.push({
      id: `measure-${measureIndex}`,
      measureIndex,
      slices: measures.get(measureIndex) ?? [],
    });
  }
  return result;
}

export function totalChordEventBeats(chordEvents: readonly ChordEvent[]): number {
  const last = chordEvents[chordEvents.length - 1];
  return last == null ? 0 : last.startBeat + last.durationBeats;
}

export function beatToMeasurePosition(
  beat: number,
  beatsPerBar: number,
): { measureIndex: number; beatInMeasure: number } {
  if (beatsPerBar <= 0) {
    return { measureIndex: 0, beatInMeasure: beat };
  }
  const measureIndex = Math.floor(beat / beatsPerBar);
  return {
    measureIndex,
    beatInMeasure: beat - measureIndex * beatsPerBar,
  };
}

export function beatToArrangementTicks(beat: number): number {
  return Math.round(beat * ARRANGEMENT_TICKS_PER_BEAT);
}

export function durationBeatsToTicks(durationBeats: number): number {
  return Math.max(1, Math.round(durationBeats * ARRANGEMENT_TICKS_PER_BEAT));
}
