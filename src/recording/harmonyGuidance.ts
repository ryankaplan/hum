import type { ArrangementVoice } from "../music/arrangementScore";
import type { HarmonyLine, HarmonyVoicing, MidiNote } from "../music/types";
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
  const harmonyPartCount = Math.max(1, totalParts - 1);
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
