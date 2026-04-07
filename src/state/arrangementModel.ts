import { generateHarmony } from "../music/harmony";
import { parseChordText } from "../music/parse";
import { progressionDurationSec } from "../music/playback";
import { noteNameToMidi } from "../music/types";
import type { Chord, HarmonyVoicing, Meter } from "../music/types";
import { createShortUuid } from "./id";

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
  measures: ArrangementMeasure[];
  tempo: number;
  meter: Meter;
  vocalRangeLow: string;
  vocalRangeHigh: string;
  totalParts: TotalPartCount;
};

export type ArrangementInfo = {
  input: ArrangementDocState;
  measures: ArrangementMeasure[];
  parsedChords: Chord[];
  lyricsByChord: string[];
  invalidChordIds: string[];
  harmonyVoicing: HarmonyVoicing | null;
  beatSec: number;
  progressionDurationSec: number;
  progressionIsValid: boolean;
  voicingIsValid: boolean;
  isValid: boolean;
};

function createChord(chordText: string, lyrics = ""): ArrangementChord {
  return {
    id: createShortUuid(),
    chordText,
    lyrics,
  };
}

function createMeasure(
  chordTexts: string[],
  lyricsByChord?: string[],
): ArrangementMeasure {
  return {
    id: createShortUuid(),
    chords: chordTexts.map((chordText, index) =>
      createChord(chordText, lyricsByChord?.[index] ?? ""),
    ),
  };
}

export function createDefaultArrangementDocState(): ArrangementDocState {
  return {
    measures: [
      createMeasure(["A"]),
      createMeasure(["A"]),
      createMeasure(["F#m"]),
      createMeasure(["F#m"]),
      createMeasure(["D"]),
      createMeasure(["D"]),
      createMeasure(["E"]),
      createMeasure(["E"]),
    ],
    tempo: 80,
    meter: [4, 4],
    vocalRangeLow: "C3",
    vocalRangeHigh: "A4",
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
    measures: parseArrangementMeasures(value?.measures) ?? defaults.measures,
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
    totalParts: parseTotalPartCount(value?.totalParts),
  };
}

function parseArrangementMeasures(raw: unknown): ArrangementMeasure[] | null {
  if (!Array.isArray(raw)) return null;
  const measures = raw
    .map((measure) => parseArrangementMeasure(measure))
    .filter((measure): measure is ArrangementMeasure => measure != null);
  return measures.length === raw.length ? measures : null;
}

function parseArrangementMeasure(raw: unknown): ArrangementMeasure | null {
  if (
    typeof raw !== "object" ||
    raw == null ||
    Array.isArray(raw) ||
    !Array.isArray((raw as { chords?: unknown }).chords)
  ) {
    return null;
  }
  const value = raw as Partial<ArrangementMeasure>;
  const chords = value.chords
    ?.map((chord) => parseArrangementChord(chord))
    .filter((chord): chord is ArrangementChord => chord != null);
  if (chords == null || chords.length !== value.chords?.length) {
    return null;
  }
  return {
    id: typeof value.id === "string" ? value.id : createShortUuid(),
    chords,
  };
}

function parseArrangementChord(raw: unknown): ArrangementChord | null {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return null;
  }
  const value = raw as Partial<ArrangementChord>;
  if (
    typeof value.chordText !== "string" ||
    typeof value.lyrics !== "string"
  ) {
    return null;
  }
  return {
    id: typeof value.id === "string" ? value.id : createShortUuid(),
    chordText: value.chordText,
    lyrics: value.lyrics,
  };
}

export function computeArrangementInfo(
  input: ArrangementDocState,
): ArrangementInfo {
  const parsed: Chord[] = [];
  const lyricsByChord: string[] = [];
  const invalidChordIds: string[] = [];

  for (const measure of input.measures) {
    const nonEmptyChords = measure.chords.filter(
      (chord) => chord.chordText.trim().length > 0,
    );
    if (nonEmptyChords.length === 0) continue;

    const beatsPerChord = input.meter[0] / nonEmptyChords.length;
    for (const chord of nonEmptyChords) {
      const parsedChord = parseChordText(chord.chordText.trim(), beatsPerChord);
      if (parsedChord == null) {
        invalidChordIds.push(chord.id);
        continue;
      }
      parsed.push(parsedChord);
      lyricsByChord.push(chord.lyrics);
    }
  }

  let voicing: HarmonyVoicing | null = null;
  try {
    const low = noteNameToMidi(input.vocalRangeLow);
    const high = noteNameToMidi(input.vocalRangeHigh);
    if (high > low && parsed.length > 0) {
      const harmonyPartCount = Math.max(1, input.totalParts - 1);
      voicing = generateHarmony(parsed, { low, high }, harmonyPartCount);
    }
  } catch {
    voicing = null;
  }

  const beatSec = input.tempo > 0 ? 60 / input.tempo : 0;
  const progressionIsValid = parsed.length > 0 && invalidChordIds.length === 0;
  const voicingIsValid = progressionIsValid && voicing != null;

  return {
    input,
    measures: input.measures,
    parsedChords: parsed,
    lyricsByChord,
    invalidChordIds,
    harmonyVoicing: voicing,
    beatSec,
    progressionDurationSec:
      parsed.length > 0 && input.tempo > 0
        ? progressionDurationSec(parsed, input.tempo)
        : 0,
    progressionIsValid,
    voicingIsValid,
    isValid: voicingIsValid,
  };
}
