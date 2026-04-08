import type { HarmonyLine, HarmonyVoicing, MidiNote } from "../music/types";

export type RecordingHarmonyGuidance = {
  harmonyLine: HarmonyLine | null;
  countInCueMidi: MidiNote | null;
};

export function resolveRecordingHarmonyGuidance(
  voicing: HarmonyVoicing | null,
  partIndex: number,
  totalParts: number,
): RecordingHarmonyGuidance {
  const harmonyPartCount = Math.max(1, totalParts - 1);
  const harmonyLine =
    voicing != null && partIndex < harmonyPartCount
      ? (voicing.lines[partIndex] ?? null)
      : null;
  const countInCueMidi =
    harmonyLine?.find((midi): midi is number => midi != null) ?? null;

  return {
    harmonyLine,
    countInCueMidi,
  };
}
