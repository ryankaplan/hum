import {
  createArrangementFromLines,
  parseCustomArrangement,
  sampleLinesAtTicks,
  validateCustomArrangement,
  type CustomArrangement,
} from "../music/arrangementScore";
import {
  beatToArrangementTicks,
  buildChordEvents,
  deriveMeasuresFromChordEvents,
  durationBeatsToTicks,
  totalChordEventBeats,
  type ArrangementMeasure,
  type ChordEvent,
  type ParsedChordToken,
} from "../music/arrangementTimeline";
import {
  describeHarmonyNotesForChord,
  generateHarmony,
} from "../music/harmony";
import { parseChordText } from "../music/parse";
import { progressionDurationSec } from "../music/playback";
import { getHarmonyLineNote, noteNameToMidi } from "../music/types";
import type {
  Chord,
  HarmonyLine,
  HarmonyRangeCoverage,
  HarmonyVoicing,
  Meter,
} from "../music/types";

export type { ArrangementMeasure, ArrangementMeasureSlice, ChordEvent } from "../music/arrangementTimeline";

export type TotalPartCount = 2 | 4;

export type ArrangementDocState = {
  chordsInput: string;
  tempo: number;
  meter: Meter;
  vocalRangeLow: string;
  vocalRangeHigh: string;
  harmonyRangeCoverage: HarmonyRangeCoverage;
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

type ParsedChordLine = {
  tokens: ParsedChordToken[];
  invalidChordIds: string[];
  parseIssues: string[];
};

const DURATION_DIVISOR_BY_SUFFIX: Record<string, number> = {
  "": 1,
  ".": 2,
  "..": 4,
};

export function createDefaultArrangementDocState(): ArrangementDocState {
  return {
    chordsInput: "A A F#m F#m D D E E",
    tempo: 80,
    meter: [4, 4],
    vocalRangeLow: "C3",
    vocalRangeHigh: "A4",
    harmonyRangeCoverage: "lower two thirds",
    totalParts: 4,
    customArrangement: null,
  };
}

export function parseTotalPartCount(raw: unknown): TotalPartCount {
  return raw === 2 ? 2 : 4;
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
    totalParts: parseTotalPartCount(value?.totalParts),
    customArrangement: parseCustomArrangementOverride(value?.customArrangement),
  };
}

function parseHarmonyRangeCoverage(raw: unknown): HarmonyRangeCoverage {
  return raw === "lower two thirds" || raw === "whole-range"
    ? raw
    : "lower two thirds";
}

function parseCustomArrangementOverride(raw: unknown): CustomArrangement | null {
  return parseCustomArrangement(raw);
}

export function parseArrangementText(
  input: string,
  beatsPerBar: number,
): ParsedArrangementResult {
  const lines = input
    .split(/\r?\n/)
    .map((line, index) => ({
      raw: line.replace(/\s+$/, ""),
      index,
    }))
    .filter((line) => line.raw.trim().length > 0);

  if (lines.length === 0) {
    return {
      chordEvents: [],
      measures: [],
      invalidChordIds: [],
      parseIssues: [],
    };
  }

  const firstChordLine = parseChordLine(lines[0]!.raw, lines[0]!.index);
  const secondChordLine =
    lines.length > 1 ? parseChordLine(lines[1]!.raw, lines[1]!.index) : null;
  const chordOnlyMode =
    secondChordLine == null ||
    (isChordLine(firstChordLine) && isChordLine(secondChordLine));

  const allTokens: ParsedChordToken[] = [];
  const invalidChordIds: string[] = [];
  const parseIssues: string[] = [];

  if (chordOnlyMode) {
    for (const line of lines) {
      const parsed = parseChordLine(line.raw, line.index);
      invalidChordIds.push(...parsed.invalidChordIds);
      parseIssues.push(...parsed.parseIssues);
      allTokens.push(...parsed.tokens);
    }
  } else {
    for (let index = 0; index < lines.length; index += 2) {
      const chordLine = lines[index];
      if (chordLine == null) break;
      const lyricLine = lines[index + 1]?.raw ?? "";
      const parsed = parseChordLine(chordLine.raw, chordLine.index);
      invalidChordIds.push(...parsed.invalidChordIds);
      parseIssues.push(...parsed.parseIssues);
      allTokens.push(...attachLyricsToTokens(parsed.tokens, lyricLine));
    }
  }

  const built = buildChordEvents(allTokens, beatsPerBar);

  return {
    chordEvents: built.chordEvents,
    measures: deriveMeasuresFromChordEvents(built.chordEvents, beatsPerBar),
    invalidChordIds,
    parseIssues,
  };
}

function isChordLine(parsed: ParsedChordLine): boolean {
  return parsed.tokens.length > 0 && parsed.parseIssues.length === 0;
}

function parseChordLine(line: string, lineIndex: number): ParsedChordLine {
  const tokenPattern =
    /[A-G][#b]?(?:maj7|M7|add9|m7b9|-7b9|7b9|\(b9\)|m9|-9|9sus2|9sus4|9|sus2|sus4|m7|-7|m6|-6|6|dim|o|m|-|7)?(?:\/[A-G][#b]?)?\.{0,2}/g;
  const tokens: ParsedChordToken[] = [];
  const invalidChordIds: string[] = [];
  const parseIssues: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(line)) != null) {
    const raw = match[0] ?? "";
    const chordText = raw.replace(/\.+$/, "");
    const suffix = raw.slice(chordText.length);
    const divisor = DURATION_DIVISOR_BY_SUFFIX[suffix];
    const id = createChordId(lineIndex, tokens.length, chordText);

    if (divisor == null) continue;
    if (parseChordText(chordText, 1) == null) {
      invalidChordIds.push(id);
      parseIssues.push(
        `Line ${lineIndex + 1}: unsupported chord token "${chordText}".`,
      );
    }

    tokens.push({
      id,
      chordText,
      lyrics: "",
      beats: 1 / divisor,
      column: match.index,
    });
  }

  const unsupportedSegments = collectUnsupportedSegments(line, tokenPattern);
  if (tokens.length === 0 && unsupportedSegments.length === 0) {
    parseIssues.push(`Line ${lineIndex + 1} is not a chord line.`);
  } else {
    for (const segment of unsupportedSegments) {
      parseIssues.push(`Line ${lineIndex + 1}: unsupported text "${segment}".`);
    }
  }

  return {
    tokens,
    invalidChordIds,
    parseIssues,
  };
}

function collectUnsupportedSegments(
  line: string,
  tokenPattern: RegExp,
): string[] {
  const matcher = new RegExp(tokenPattern.source, tokenPattern.flags);
  const segments: string[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(line)) != null) {
    const start = match.index;
    if (start > cursor) {
      segments.push(...splitUnsupportedSegment(line.slice(cursor, start)));
    }
    cursor = start + (match[0]?.length ?? 0);
  }

  if (cursor < line.length) {
    segments.push(...splitUnsupportedSegment(line.slice(cursor)));
  }

  return segments;
}

function splitUnsupportedSegment(segment: string): string[] {
  return segment
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function attachLyricsToTokens(
  tokens: ParsedChordToken[],
  lyricsLine: string,
): ParsedChordToken[] {
  const lyricWords = Array.from(lyricsLine.matchAll(/\S+/g)).map((match) => ({
    start: match.index ?? 0,
    word: match[0],
  }));

  return tokens.map((token, index) => {
    const nextColumn = tokens[index + 1]?.column ?? Number.POSITIVE_INFINITY;
    const words = lyricWords
      .filter((word) => word.start >= token.column && word.start < nextColumn)
      .map((word) => word.word);
    return {
      ...token,
      lyrics: words.join(" "),
    };
  });
}

function createChordId(
  lineIndex: number,
  tokenIndex: number,
  chordText: string,
): string {
  return `line-${lineIndex}-token-${tokenIndex}-${chordText}`;
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
      const harmonyPartCount = Math.max(1, input.totalParts - 1);
      harmonyVoicing = generateHarmony(
        parsedChords,
        { low, high },
        harmonyPartCount,
        input.harmonyRangeCoverage,
      );

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
