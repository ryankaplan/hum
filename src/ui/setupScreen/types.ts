import type {
  HarmonyRhythmPatternDefinition,
  HarmonyRhythmPatternId,
} from "../../music/harmonyRhythmPatterns";
import type {
  HarmonyPriority,
  HarmonyRangeCoverage,
  Meter,
} from "../../music/types";
import type { ArrangementInfo } from "../../state/model";

export type PreviewMode = "pattern" | "custom" | null;

export const METER_OPTIONS: { label: string; value: Meter }[] = [
  { label: "4/4", value: [4, 4] },
  { label: "3/4", value: [3, 4] },
  { label: "6/8", value: [6, 8] },
];

export const RANGE_OPTIONS = [
  { label: "Bass", low: "F2", high: "D4" },
  { label: "Baritone", low: "A2", high: "F4" },
  { label: "Tenor", low: "C3", high: "A4" },
  { label: "Alto", low: "A3", high: "D5" },
  { label: "Soprano", low: "D4", high: "G5" },
] as const;

export const HARMONY_COVERAGE_OPTIONS = [
  { label: "Lower Two Thirds", value: "lower two thirds" },
  { label: "Whole Range", value: "whole-range" },
] as const;

export const HARMONY_PRIORITY_OPTIONS = [
  { label: "Voice leading", value: "voiceLeading" },
  { label: "Chord intent", value: "chordIntent" },
] as const;

export type SetupFormFieldsProps = {
  meterLabel: string;
  tempoInputValue: string;
  selectedRangeValue: string;
  harmonyRangeCoverage: HarmonyRangeCoverage;
  harmonyPriority: HarmonyPriority;
  totalParts: number;
  onTempoInputChange: (value: string) => void;
  onTempoInputBlur: () => void;
  onMeterLabelChange: (label: string) => void;
  onRangePresetChange: (value: string) => void;
  onHarmonyCoverageChange: (value: HarmonyRangeCoverage) => void;
  onHarmonyPriorityChange: (value: HarmonyPriority) => void;
  onPartCountChange: (value: "3" | "4") => void;
};

export type HarmonyRhythmPatternPickerProps = {
  meter: Meter;
  selectedPatternId: HarmonyRhythmPatternId;
  customBasePatternId: HarmonyRhythmPatternId | null;
  onPatternChange: (value: HarmonyRhythmPatternId) => void;
  previewingPatternId: HarmonyRhythmPatternId | null;
  previewingPatternStepIndex: number | null;
  onPatternPreviewToggle: (value: HarmonyRhythmPatternId) => void;
};

export type HarmonyRhythmPatternCardProps = {
  pattern: HarmonyRhythmPatternDefinition;
  meter: Meter;
  activePreviewStepIndex: number | null;
  previewing: boolean;
  selected: boolean;
  onClick: () => void;
  onPreviewToggle: () => void;
};

export type VoicingComparisonSectionProps = {
  title?: string;
  parsed: ArrangementInfo["parsedChords"];
  voicing: NonNullable<ArrangementInfo["harmonyVoicing"]>;
  measures: ArrangementInfo["measures"];
};

export type ArrangementPreviewPanelProps = {
  measures: ArrangementInfo["measures"];
  parsed: ArrangementInfo["parsedChords"];
  patternName: string;
  customBasePatternName: string | null;
  harmonyVoicing: NonNullable<ArrangementInfo["harmonyVoicing"]>;
  effectiveHarmonyVoicing: ArrangementInfo["effectiveHarmonyVoicing"];
  hasCustomHarmony: boolean;
  previewingMode: PreviewMode;
  onPreviewPattern: () => void;
  onPreviewCustom: () => void;
  onStopPreview: () => void;
  onCustomizeHarmony: () => void;
  onResetCustomHarmony: () => void;
};

export type SetupCardProps = {
  arrangement: ArrangementInfo;
  meterLabel: string;
  tempoInputValue: string;
  previewingMode: PreviewMode;
  starting: boolean;
  error: string | null;
  onChordsChange: (value: string) => void;
  onTempoInputChange: (value: string) => void;
  onTempoInputBlur: () => void;
  onMeterLabelChange: (label: string) => void;
  onRangePresetChange: (value: string) => void;
  onHarmonyCoverageChange: (value: HarmonyRangeCoverage) => void;
  onHarmonyPriorityChange: (value: HarmonyPriority) => void;
  onPartCountChange: (value: "3" | "4") => void;
  onHarmonyRhythmPatternChange: (value: HarmonyRhythmPatternId) => void;
  previewingPatternId: HarmonyRhythmPatternId | null;
  previewingPatternStepIndex: number | null;
  onPatternPreviewToggle: (value: HarmonyRhythmPatternId) => void;
  onPreviewPattern: () => void;
  onPreviewCustom: () => void;
  onStopPreview: () => void;
  onCustomizeHarmony: () => void;
  onResetCustomHarmony: () => void;
  onStart: () => void;
};
