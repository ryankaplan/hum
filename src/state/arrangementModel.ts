import { generateHarmony } from "../music/harmony";
import { parseChordProgression } from "../music/parse";
import { progressionDurationSec } from "../music/playback";
import { noteNameToMidi } from "../music/types";
import type { Chord, HarmonyVoicing, Meter } from "../music/types";

export type TotalPartCount = 2 | 4;

export type ArrangementDocState = {
  chordsInput: string;
  tempo: number;
  meter: Meter;
  vocalRangeLow: string;
  vocalRangeHigh: string;
  totalParts: TotalPartCount;
};

export type ArrangementInfo = {
  input: ArrangementDocState;
  parsedChords: Chord[];
  harmonyVoicing: HarmonyVoicing | null;
  beatSec: number;
  progressionDurationSec: number;
  isValid: boolean;
};

export function createDefaultArrangementDocState(): ArrangementDocState {
  return {
    chordsInput: "A A F#m F#m D D E E",
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
    totalParts: parseTotalPartCount(value?.totalParts),
  };
}

export function computeArrangementInfo(
  input: ArrangementDocState,
): ArrangementInfo {
  const parsed = parseChordProgression(input.chordsInput, input.meter[0]);

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

  return {
    input,
    parsedChords: parsed,
    harmonyVoicing: voicing,
    beatSec,
    progressionDurationSec:
      parsed.length > 0 && input.tempo > 0
        ? progressionDurationSec(parsed, input.tempo)
        : 0,
    isValid: parsed.length > 0 && voicing != null,
  };
}
