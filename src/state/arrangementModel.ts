import {
  createArrangementFromLines,
  parseCustomArrangement,
  sampleLinesAtTicks,
  validateCustomArrangement,
  type CustomArrangement,
} from "../music/arrangementScore";
import {
  beatToArrangementTicks,
  deriveMeasuresFromChordEvents,
  durationBeatsToTicks,
  totalChordEventBeats,
  type ArrangementMeasure,
  type ChordEvent,
} from "../music/arrangementTimeline";
import { describeHarmonyNotesForChord } from "arranger";
import { progressionDurationSec } from "../music/playback";
import {
  getHarmonyLineNote,
  getHarmonyPartCount,
  noteNameToMidi,
} from "../music/types";
import type {
  Chord,
  HarmonyLine,
  HarmonyPriority,
  HarmonyRangeCoverage,
  HarmonyVoicing,
  Meter,
} from "../music/types";
import {
  generateHarmony,
  parseHarmonyInput,
  type HarmonyInput,
} from "arranger";

export type { ArrangementMeasure, ArrangementMeasureSlice, ChordEvent } from "../music/arrangementTimeline";

export type TotalPartCount = 3 | 4;

export type ArrangementDocState = {
  chordsInput: string;
  tempo: number;
  meter: Meter;
  vocalRangeLow: string;
  vocalRangeHigh: string;
  harmonyRangeCoverage: HarmonyRangeCoverage;
  harmonyPriority: HarmonyPriority;
  totalParts: TotalPartCount;
  customArrangement: CustomArrangement | null;
};

export type ArrangementEditorSpan = {
  id: string;
  chordEventIndex: number;
  measureIndex: number;
  chordText: string;
  lyrics: string;
  startTick: number;
  durationTicks: number;
  chord: Chord;
};

export type ArrangementInfo = {
  input: ArrangementDocState;
  chordEvents: ChordEvent[];
  measures: ArrangementMeasure[];
  editorSpans: ArrangementEditorSpan[];
  parsedChords: Chord[];
  invalidChordIds: string[];
  parseIssues: string[];
  harmonyVoicing: HarmonyVoicing | null;
  effectiveHarmonyVoicing: HarmonyVoicing | null;
  effectiveCustomArrangement: CustomArrangement | null;
  hasCustomHarmony: boolean;
  beatSec: number;
  progressionDurationSec: number;
  progressionIsValid: boolean;
  voicingIsValid: boolean;
  isValid: boolean;
};

type ParsedArrangementResult = {
  chordEvents: ChordEvent[];
  measures: ArrangementMeasure[];
  invalidChordIds: string[];
  parseIssues: string[];
};

export function createDefaultArrangementDocState(): ArrangementDocState {
  return {
    chordsInput: "A A F#m F#m D D E E",
    tempo: 80,
    meter: [4, 4],
    vocalRangeLow: "C3",
    vocalRangeHigh: "A4",
    harmonyRangeCoverage: "lower two thirds",
    harmonyPriority: "voiceLeading",
    totalParts: 4,
    customArrangement: null,
  };
}

export function parseTotalPartCount(raw: unknown): TotalPartCount {
  return raw === 3 ? 3 : 4;
}

export function parseArrangementDocState(raw: unknown): ArrangementDocState {
  const value = raw as Partial<ArrangementDocState> | null | undefined;
  const defaults = createDefaultArrangementDocState();

  return {
    chordsInput:
      typeof value?.chordsInput === "string"
        ? value.chordsInput
        : defaults.chordsInput,
    tempo:
      typeof value?.tempo === "number" && Number.isFinite(value.tempo)
        ? value.tempo
        : defaults.tempo,
    meter: Array.isArray(value?.meter)
      ? [Number(value.meter[0]) || 4, Number(value.meter[1]) || 4]
      : defaults.meter,
    vocalRangeLow:
      typeof value?.vocalRangeLow === "string"
        ? value.vocalRangeLow
        : defaults.vocalRangeLow,
    vocalRangeHigh:
      typeof value?.vocalRangeHigh === "string"
        ? value.vocalRangeHigh
        : defaults.vocalRangeHigh,
    harmonyRangeCoverage: parseHarmonyRangeCoverage(
      value?.harmonyRangeCoverage,
    ),
    harmonyPriority: parseHarmonyPriority(value?.harmonyPriority),
    totalParts: parseTotalPartCount(value?.totalParts),
    customArrangement: parseCustomArrangementOverride(value?.customArrangement),
  };
}

function parseHarmonyRangeCoverage(raw: unknown): HarmonyRangeCoverage {
  return raw === "lower two thirds" || raw === "whole-range"
    ? raw
    : "lower two thirds";
}

function parseHarmonyPriority(raw: unknown): HarmonyPriority {
  return raw === "chordIntent" ? "chordIntent" : "voiceLeading";
}

function parseCustomArrangementOverride(raw: unknown): CustomArrangement | null {
  return parseCustomArrangement(raw);
}

export function parseArrangementText(
  input: string,
  beatsPerBar: number,
): ParsedArrangementResult {
  const parsed = parseHarmonyInput(input, { beatsPerBar });
  if (!parsed.ok) {
    return {
      chordEvents: [],
      measures: [],
      invalidChordIds: parsed.issues.flatMap((issue) =>
        issue.code === "invalid_chord_token" && issue.tokenId != null
          ? [issue.tokenId]
          : [],
      ),
      parseIssues: parsed.issues.map((issue) => issue.message),
    };
  }

  const chordEvents = parsed.value.events.map((event) => ({
    id: event.id,
    chordText: event.sourceText,
    lyrics: event.lyrics,
    chord: {
      ...event.symbol,
      beats: event.durationBeats,
    },
    startBeat: event.startBeat,
    durationBeats: event.durationBeats,
  }));

  return {
    chordEvents,
    measures: deriveMeasuresFromChordEvents(chordEvents, beatsPerBar),
    invalidChordIds: [],
    parseIssues: [],
  };
}

export function computeArrangementInfo(
  input: ArrangementDocState,
): ArrangementInfo {
  const parsedArrangement = parseArrangementText(
    input.chordsInput,
    input.meter[0],
  );
  const parsedChords = parsedArrangement.chordEvents.map((event) => event.chord);
  const progressionIsValid =
    parsedArrangement.chordEvents.length > 0 &&
    parsedArrangement.invalidChordIds.length === 0 &&
    parsedArrangement.parseIssues.length === 0;
  const editorSpans = progressionIsValid
    ? buildEditorSpans(parsedArrangement.chordEvents, input.meter[0])
    : [];

  let harmonyVoicing: HarmonyVoicing | null = null;
  let effectiveHarmonyVoicing: HarmonyVoicing | null = null;
  let effectiveCustomArrangement: CustomArrangement | null = null;
  let hasCustomHarmony = false;
  try {
    const low = noteNameToMidi(input.vocalRangeLow);
    const high = noteNameToMidi(input.vocalRangeHigh);
    if (high > low && parsedChords.length > 0) {
      const harmonyPartCount = getHarmonyPartCount(input.totalParts);
      const harmonyInput = toHarmonyInput(parsedArrangement.chordEvents, input.meter[0]);
      const harmonyRange = resolveHarmonyRange(
        { low, high },
        input.harmonyRangeCoverage,
      );
      const generated = generateHarmony(harmonyInput, {
        range: harmonyRange,
        voices: harmonyPartCount,
        priority: input.harmonyPriority,
      });
      harmonyVoicing = {
        ...generated,
        harmonyPartCount,
      };

      const generatedArrangement = createArrangementFromLines(
        harmonyVoicing.lines,
        parsedChords,
      );
      const totalTicks = durationBeatsToTicks(
        totalChordEventBeats(parsedArrangement.chordEvents),
      );
      const customArrangement = normalizeCustomArrangementOverride(
        input.customArrangement,
        harmonyPartCount,
        totalTicks,
      );
      effectiveCustomArrangement = customArrangement ?? generatedArrangement;
      hasCustomHarmony = customArrangement != null;

      if (effectiveCustomArrangement != null && editorSpans.length > 0) {
        const sampledLines = sampleLinesAtTicks(
          effectiveCustomArrangement,
          editorSpans.map((span) => span.startTick),
        );
        const customHarmonyTop = getHighestMidi(sampledLines);
        const customAnnotations = harmonyVoicing.annotations.map(
          (annotation, chordIndex) => {
            const chord = parsedChords[chordIndex];
            if (chord == null) return annotation;
            return {
              ...annotation,
              chordTones: describeHarmonyNotesForChord(
                chord,
                getChordNotesAtIndex(sampledLines, chordIndex),
              ),
            };
          },
        );
        effectiveHarmonyVoicing = {
          ...harmonyVoicing,
          lines: sampledLines,
          annotations: customAnnotations,
          harmonyTop:
            Number.isFinite(customHarmonyTop)
              ? customHarmonyTop
              : harmonyVoicing.harmonyTop,
        };
      }
    }
  } catch {
    harmonyVoicing = null;
    effectiveHarmonyVoicing = null;
    effectiveCustomArrangement = null;
    hasCustomHarmony = false;
  }

  const beatSec = input.tempo > 0 ? 60 / input.tempo : 0;
  const voicingIsValid = progressionIsValid && effectiveHarmonyVoicing != null;

  return {
    input,
    chordEvents: parsedArrangement.chordEvents,
    measures: parsedArrangement.measures,
    editorSpans,
    parsedChords,
    invalidChordIds: parsedArrangement.invalidChordIds,
    parseIssues: parsedArrangement.parseIssues,
    harmonyVoicing,
    effectiveHarmonyVoicing,
    effectiveCustomArrangement,
    hasCustomHarmony,
    beatSec,
    progressionDurationSec:
      parsedChords.length > 0 && input.tempo > 0
        ? progressionDurationSec(parsedChords, input.tempo)
        : 0,
    progressionIsValid,
    voicingIsValid,
    isValid: voicingIsValid,
  };
}

function normalizeCustomArrangementOverride(
  raw: CustomArrangement | null,
  harmonyPartCount: number,
  totalTicks: number,
): CustomArrangement | null {
  if (raw == null) return null;
  return validateCustomArrangement(raw, harmonyPartCount, totalTicks);
}

function getChordNotesAtIndex(
  lines: HarmonyLine[],
  chordIndex: number,
): number[] {
  const notes: number[] = [];
  for (let voiceIndex = 0; voiceIndex < lines.length; voiceIndex++) {
    const midi = getHarmonyLineNote(lines[voiceIndex], chordIndex);
    if (midi != null) {
      notes.push(midi);
    }
  }
  return notes;
}

function getHighestMidi(lines: HarmonyLine[]): number {
  let top = Number.NEGATIVE_INFINITY;
  for (const line of lines) {
    for (const midi of line) {
      if (midi == null) continue;
      top = Math.max(top, midi);
    }
  }
  return top;
}

function buildEditorSpans(
  chordEvents: ChordEvent[],
  beatsPerBar: number,
): ArrangementEditorSpan[] {
  return chordEvents.map((event, chordEventIndex) => ({
    id: `span-${chordEventIndex}`,
    chordEventIndex,
    measureIndex: Math.floor(event.startBeat / Math.max(1, beatsPerBar)),
    chordText: event.chordText,
    lyrics: event.lyrics,
    startTick: beatToArrangementTicks(event.startBeat),
    durationTicks: durationBeatsToTicks(event.durationBeats),
    chord: event.chord,
  }));
}

function toHarmonyInput(
  chordEvents: ChordEvent[],
  beatsPerBar: number,
): HarmonyInput {
  return {
    beatsPerBar,
    events: chordEvents.map((event) => ({
      id: event.id,
      symbol: {
        root: event.chord.root,
        quality: event.chord.quality,
        bass: event.chord.bass,
      },
      sourceText: event.chordText,
      lyrics: event.lyrics,
      startBeat: event.startBeat,
      durationBeats: event.durationBeats,
    })),
    measures: chordEvents.length === 0
      ? []
      : deriveMeasuresFromChordEvents(chordEvents, beatsPerBar).map((measure) => ({
          id: measure.id,
          measureIndex: measure.measureIndex,
          slices: measure.slices.map((slice) => ({
            id: slice.id,
            eventIndex: slice.chordEventIndex,
            eventId: slice.chordEventId,
            sourceText: slice.chordText,
            lyrics: slice.lyrics,
            startBeatInMeasure: slice.startBeatInMeasure,
            durationBeats: slice.durationBeats,
            segmentKind: slice.segmentKind,
          })),
        })),
  };
}

function resolveHarmonyRange(
  range: { low: number; high: number },
  coverage: HarmonyRangeCoverage,
): { low: number; high: number } {
  const ratio = coverage === "whole-range" ? 1 : 2 / 3;
  return {
    low: range.low,
    high: range.low + Math.round((range.high - range.low) * ratio),
  };
}
