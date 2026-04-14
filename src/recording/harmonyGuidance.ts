import type { ArrangementVoice } from "../music/arrangementScore";
import {
  getHarmonyPartCount,
  type HarmonyLine,
  type HarmonyVoicing,
  type MidiNote,
} from "../music/types";
import { getFirstActiveMidi } from "../music/arrangementScore";

export type RecordingHarmonyGuidance = {
  harmonyLine: HarmonyLine | null;
  arrangementVoice: ArrangementVoice | null;
  countInCueMidi: MidiNote | null;
};

export function resolveRecordingHarmonyGuidance(
  voicing: HarmonyVoicing | null,
  arrangementVoices: ArrangementVoice[],
  partIndex: number,
  totalParts: number,
): RecordingHarmonyGuidance {
  const harmonyPartCount = getHarmonyPartCount(totalParts);
  const harmonyLine =
    voicing != null && partIndex < harmonyPartCount
      ? (voicing.lines[partIndex] ?? null)
      : null;
  const arrangementVoice =
    partIndex < harmonyPartCount ? (arrangementVoices[partIndex] ?? null) : null;
  const countInCueMidi =
    getFirstActiveMidi(arrangementVoice) ??
    harmonyLine?.find((midi): midi is number => midi != null) ??
    null;

  return {
    harmonyLine,
    arrangementVoice,
    countInCueMidi,
  };
}
