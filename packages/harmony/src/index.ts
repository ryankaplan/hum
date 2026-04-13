import { durationSuffixToBeats, parseChordSymbol } from "./parse";
import { generateHarmony as generateHarmonyInternal } from "./generator";
import type {
  ChordSymbol,
  GeneratedHarmony,
  GenerateHarmonyOptions,
  HarmonyInput,
  HarmonyInputEvent,
  HarmonyMeasure,
  HarmonyMeasureSlice,
  ParseIssue,
  ParseResult,
} from "./types";

const TOKEN_PATTERN =
  /[A-G][#b]?(?:maj7|M7|add9|m7b9|-7b9|7b9|\(b9\)|m9|-9|9sus2|9sus4|9|sus2|sus4|m7|-7|m6|-6|6|dim|o|m|-|7)?(?:\/[A-G][#b]?)?\.{0,2}/g;

type ParsedChordToken = {
  id: string;
  chordText: string;
  lyrics: string;
  durationBeats: number;
  column: number;
};

type ParsedChordLine = {
  tokens: ParsedChordToken[];
  issues: ParseIssue[];
};

export function parseHarmonyInput(
  source: string,
  options: { beatsPerBar: number },
): ParseResult {
  const beatsPerBar = options.beatsPerBar;
  const lines = source
    .split(/\r?\n/)
    .map((line, index) => ({
      raw: line.replace(/\s+$/, ""),
      index,
    }))
    .filter((line) => line.raw.trim().length > 0);

  if (lines.length === 0) {
    return {
      ok: false,
      issues: [
        {
          code: "empty_input",
          message: "Enter at least one chord line.",
          line: 1,
          column: 1,
          length: 0,
        },
      ],
    };
  }

  const firstChordLine = parseChordLine(lines[0]!.raw, lines[0]!.index, beatsPerBar);
  const secondChordLine =
    lines.length > 1
      ? parseChordLine(lines[1]!.raw, lines[1]!.index, beatsPerBar)
      : null;
  const chordOnlyMode =
    secondChordLine == null ||
    (isChordLine(firstChordLine) && isChordLine(secondChordLine));

  const allTokens: ParsedChordToken[] = [];
  const issues: ParseIssue[] = [];

  if (chordOnlyMode) {
    for (const line of lines) {
      const parsed = parseChordLine(line.raw, line.index, beatsPerBar);
      issues.push(...parsed.issues);
      allTokens.push(...parsed.tokens);
    }
  } else {
    for (let index = 0; index < lines.length; index += 2) {
      const chordLine = lines[index];
      if (chordLine == null) break;
      const lyricLine = lines[index + 1]?.raw ?? "";
      const parsed = parseChordLine(chordLine.raw, chordLine.index, beatsPerBar);
      issues.push(...parsed.issues);
      allTokens.push(...attachLyricsToTokens(parsed.tokens, lyricLine));
    }
  }

  if (issues.length > 0) {
    return {
      ok: false,
      issues,
    };
  }

  const events: HarmonyInputEvent[] = [];
  let startBeat = 0;
  for (const token of allTokens) {
    const symbol = parseChordSymbol(token.chordText);
    if (symbol == null) {
      return {
        ok: false,
        issues: [
          {
            code: "invalid_chord_token",
            message: `Line 1: unsupported chord token "${token.chordText}".`,
            line: 1,
            column: token.column + 1,
            length: token.chordText.length,
            tokenId: token.id,
          },
        ],
      };
    }
    events.push({
      id: token.id,
      symbol,
      sourceText: token.chordText,
      lyrics: token.lyrics,
      startBeat,
      durationBeats: token.durationBeats,
    });
    startBeat += token.durationBeats;
  }

  return {
    ok: true,
    value: {
      beatsPerBar,
      events,
      measures: deriveMeasuresFromEvents(events, beatsPerBar),
    },
  };
}

export function generateHarmony(
  input: HarmonyInput,
  options: GenerateHarmonyOptions,
): GeneratedHarmony {
  return generateHarmonyInternal(input, options);
}

export type {
  ChordQuality,
  ChordSymbol,
  GeneratedHarmony,
  GenerateHarmonyOptions,
  HarmonyAnnotation,
  HarmonyPriority,
  HarmonyInput,
  HarmonyInputEvent,
  HarmonyLine,
  HarmonyMeasure,
  HarmonyMeasureSlice,
  MidiNote,
  NoteName,
  ParseIssue,
  ParseResult,
  VocalRange,
} from "./types";
export { NOTE_NAMES } from "./types";

function isChordLine(parsed: ParsedChordLine): boolean {
  return parsed.tokens.length > 0 && parsed.issues.length === 0;
}

function parseChordLine(
  line: string,
  lineIndex: number,
  beatsPerBar: number,
): ParsedChordLine {
  const tokens: ParsedChordToken[] = [];
  const issues: ParseIssue[] = [];
  let match: RegExpExecArray | null;

  while ((match = TOKEN_PATTERN.exec(line)) != null) {
    const raw = match[0] ?? "";
    const chordText = raw.replace(/\.+$/, "");
    const suffix = raw.slice(chordText.length);
    const durationBeats = durationSuffixToBeats(suffix, beatsPerBar);
    const id = createChordId(lineIndex, tokens.length, chordText);

    if (durationBeats == null) continue;
    if (parseChordSymbol(chordText) == null) {
      issues.push({
        code: "invalid_chord_token",
        message: `Line ${lineIndex + 1}: unsupported chord token "${chordText}".`,
        line: lineIndex + 1,
        column: match.index + 1,
        length: chordText.length,
        tokenId: id,
      });
    }

    tokens.push({
      id,
      chordText,
      lyrics: "",
      durationBeats,
      column: match.index,
    });
  }

  const unsupportedSegments = collectUnsupportedSegments(line);
  if (tokens.length === 0 && unsupportedSegments.length === 0) {
    issues.push({
      code: "not_a_chord_line",
      message: `Line ${lineIndex + 1} is not a chord line.`,
      line: lineIndex + 1,
      column: 1,
      length: line.length,
    });
  } else {
    for (const segment of unsupportedSegments) {
      issues.push({
        code: "unsupported_text",
        message: `Line ${lineIndex + 1}: unsupported text "${segment.text}".`,
        line: lineIndex + 1,
        column: segment.column + 1,
        length: segment.text.length,
      });
    }
  }

  TOKEN_PATTERN.lastIndex = 0;

  return {
    tokens,
    issues,
  };
}

function collectUnsupportedSegments(
  line: string,
): Array<{ text: string; column: number }> {
  const matcher = new RegExp(TOKEN_PATTERN.source, TOKEN_PATTERN.flags);
  const segments: Array<{ text: string; column: number }> = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(line)) != null) {
    const start = match.index;
    if (start > cursor) {
      segments.push(...splitUnsupportedSegment(line.slice(cursor, start), cursor));
    }
    cursor = start + (match[0]?.length ?? 0);
  }

  if (cursor < line.length) {
    segments.push(...splitUnsupportedSegment(line.slice(cursor), cursor));
  }

  return segments;
}

function splitUnsupportedSegment(
  segment: string,
  startColumn: number,
): Array<{ text: string; column: number }> {
  const pieces: Array<{ text: string; column: number }> = [];
  let current = "";
  let currentColumn = startColumn;

  for (let index = 0; index < segment.length; index++) {
    const char = segment[index]!;
    if (/\s/.test(char)) {
      if (current.length > 0) {
        pieces.push({ text: current, column: currentColumn });
        current = "";
      }
      continue;
    }
    if (current.length === 0) {
      currentColumn = startColumn + index;
    }
    current += char;
  }

  if (current.length > 0) {
    pieces.push({ text: current, column: currentColumn });
  }

  return pieces;
}

function attachLyricsToTokens(
  tokens: ParsedChordToken[],
  lyricsLine: string,
): ParsedChordToken[] {
  const lyricWords = Array.from(lyricsLine.matchAll(/\S+/g)).map((match) => ({
    start: match.index ?? 0,
    word: match[0]!,
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

function deriveMeasuresFromEvents(
  events: HarmonyInputEvent[],
  beatsPerBar: number,
): HarmonyMeasure[] {
  if (beatsPerBar <= 0 || events.length === 0) return [];

  const measures = new Map<number, HarmonyMeasureSlice[]>();

  for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
    const event = events[eventIndex]!;
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
        eventIndex,
        eventId: event.id,
        sourceText: event.sourceText,
        lyrics:
          segmentKind === "single" || segmentKind === "start" ? event.lyrics : "",
        startBeatInMeasure: sliceStart - measureStart,
        durationBeats,
        segmentKind,
      });
      measures.set(measureIndex, slices);
    }
  }

  const last = events[events.length - 1];
  const totalBeats =
    last == null ? 0 : last.startBeat + last.durationBeats;
  const measureCount = Math.max(1, Math.ceil(totalBeats / beatsPerBar));
  const result: HarmonyMeasure[] = [];
  for (let measureIndex = 0; measureIndex < measureCount; measureIndex++) {
    result.push({
      id: `measure-${measureIndex}`,
      measureIndex,
      slices: measures.get(measureIndex) ?? [],
    });
  }
  return result;
}

function createChordId(
  lineIndex: number,
  tokenIndex: number,
  chordText: string,
): string {
  return `line-${lineIndex}-token-${tokenIndex}-${chordText}`;
}
