import {
  generateHarmony,
  generateHarmonyDynamic,
} from "../music/harmony";
import { parseChordText } from "../music/parse";
import { progressionDurationSec } from "../music/playback";
import { noteNameToMidi } from "../music/types";
import type {
  Chord,
  HarmonyRangeCoverage,
  HarmonyVoicing,
  Meter,
} from "../music/types";

export type TotalPartCount = 2 | 4;

export type ArrangementChord = {
  id: string;
  chordText: string;
  lyrics: string;
};

export type ArrangementMeasure = {
  id: string;
  chords: ArrangementChord[];
};

export type ArrangementDocState = {
  chordsInput: string;
  tempo: number;
  meter: Meter;
  vocalRangeLow: string;
  vocalRangeHigh: string;
  harmonyRangeCoverage: HarmonyRangeCoverage;
  totalParts: TotalPartCount;
};

export type ArrangementInfo = {
  input: ArrangementDocState;
  measures: ArrangementMeasure[];
  parsedChords: Chord[];
  invalidChordIds: string[];
  parseIssues: string[];
  harmonyVoicing: HarmonyVoicing | null;
  harmonyVoicingDynamic: HarmonyVoicing | null;
  beatSec: number;
  progressionDurationSec: number;
  progressionIsValid: boolean;
  voicingIsValid: boolean;
  isValid: boolean;
};

type ParsedArrangementResult = {
  measures: ArrangementMeasure[];
  parsedChords: Chord[];
  invalidChordIds: string[];
  parseIssues: string[];
};

type ParsedChordToken = {
  id: string;
  chordText: string;
  lyrics: string;
  beats: number;
  column: number;
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
  };
}

function parseHarmonyRangeCoverage(raw: unknown): HarmonyRangeCoverage {
  return raw === "lower two thirds" || raw === "whole-range"
    ? raw
    : "lower two thirds";
}

export function flattenArrangementLyrics(
  measures: ArrangementMeasure[],
): string[] {
  const lyrics: string[] = [];
  for (const measure of measures) {
    for (const chord of measure.chords) {
      lyrics.push(chord.lyrics);
    }
  }
  return lyrics;
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
      measures: [],
      parsedChords: [],
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

  const grouped = groupTokensIntoMeasures(allTokens, beatsPerBar);
  parseIssues.push(...grouped.parseIssues);

  return {
    measures: grouped.measures,
    parsedChords: grouped.parsedChords,
    invalidChordIds,
    parseIssues,
  };
}

function isChordLine(parsed: ParsedChordLine): boolean {
  return parsed.tokens.length > 0 && parsed.parseIssues.length === 0;
}

function parseChordLine(line: string, lineIndex: number): ParsedChordLine {
  const tokenPattern =
    /[A-G][#b]?(?:maj7|M7|m7b9|-7b9|7b9|\(b9\)|m9|-9|9sus2|9sus4|9|sus2|sus4|m7|-7|m6|-6|6|dim|o|m|-|7)?(?:\/[A-G][#b]?)?\.{0,2}/g;
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

function groupTokensIntoMeasures(
  tokens: ParsedChordToken[],
  beatsPerBar: number,
): {
  measures: ArrangementMeasure[];
  parsedChords: Chord[];
  parseIssues: string[];
} {
  const measures: ArrangementMeasure[] = [];
  const parsedChords: Chord[] = [];
  const parseIssues: string[] = [];
  let currentTokens: ParsedChordToken[] = [];
  let currentBeats = 0;

  for (const token of tokens) {
    const tokenBeats = token.beats * beatsPerBar;
    currentTokens.push(token);
    currentBeats += tokenBeats;

    if (currentBeats > beatsPerBar + 0.0001) {
      parseIssues.push(
        `A measure exceeds ${beatsPerBar} beats while grouping dotted durations.`,
      );
      currentTokens = [];
      currentBeats = 0;
      continue;
    }

    if (Math.abs(currentBeats - beatsPerBar) < 0.0001) {
      measures.push({
        id: `measure-${measures.length}`,
        chords: currentTokens.map((current) => ({
          id: current.id,
          chordText: current.chordText,
          lyrics: current.lyrics,
        })),
      });

      for (const current of currentTokens) {
        const parsed = parseChordText(
          current.chordText,
          current.beats * beatsPerBar,
        );
        if (parsed != null) {
          parsedChords.push(parsed);
        }
      }

      currentTokens = [];
      currentBeats = 0;
    }
  }

  if (currentTokens.length > 0) {
    parseIssues.push(
      `A measure is incomplete; dotted durations must add up to ${beatsPerBar} beats.`,
    );
  }

  return {
    measures,
    parsedChords,
    parseIssues,
  };
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

  let voicing: HarmonyVoicing | null = null;
  let dynamicVoicing: HarmonyVoicing | null = null;
  try {
    const low = noteNameToMidi(input.vocalRangeLow);
    const high = noteNameToMidi(input.vocalRangeHigh);
    if (high > low && parsedArrangement.parsedChords.length > 0) {
      const harmonyPartCount = Math.max(1, input.totalParts - 1);
      voicing = generateHarmony(
        parsedArrangement.parsedChords,
        { low, high },
        harmonyPartCount,
        input.harmonyRangeCoverage,
      );
      dynamicVoicing = generateHarmonyDynamic(
        parsedArrangement.parsedChords,
        { low, high },
        harmonyPartCount,
        input.harmonyRangeCoverage,
      );
    }
  } catch {
    voicing = null;
    dynamicVoicing = null;
  }

  const beatSec = input.tempo > 0 ? 60 / input.tempo : 0;
  const progressionIsValid =
    parsedArrangement.parsedChords.length > 0 &&
    parsedArrangement.invalidChordIds.length === 0 &&
    parsedArrangement.parseIssues.length === 0;
  const voicingIsValid = progressionIsValid && voicing != null;

  return {
    input,
    measures: parsedArrangement.measures,
    parsedChords: parsedArrangement.parsedChords,
    invalidChordIds: parsedArrangement.invalidChordIds,
    parseIssues: parsedArrangement.parseIssues,
    harmonyVoicing: voicing,
    harmonyVoicingDynamic: dynamicVoicing,
    beatSec,
    progressionDurationSec:
      parsedArrangement.parsedChords.length > 0 && input.tempo > 0
        ? progressionDurationSec(parsedArrangement.parsedChords, input.tempo)
        : 0,
    progressionIsValid,
    voicingIsValid,
    isValid: voicingIsValid,
  };
}
