import type { HarmonyRangeCoverage, Meter } from "../../music/types";
import type {
  HarmonyRhythmPatternDefinition,
  HarmonyRhythmPatternId,
} from "../../music/harmonyRhythmPatterns";
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

export type SetupFormFieldsProps = {
  meterLabel: string;
  tempoInputValue: string;
  selectedRangeValue: string;
  harmonyRangeCoverage: HarmonyRangeCoverage;
  totalParts: number;
  onTempoInputChange: (value: string) => void;
  onTempoInputBlur: () => void;
  onMeterLabelChange: (label: string) => void;
  onRangePresetChange: (value: string) => void;
  onHarmonyCoverageChange: (value: HarmonyRangeCoverage) => void;
  onPartCountChange: (value: "3" | "4") => void;
};

export type HarmonyRhythmPatternPickerProps = {
  meter: Meter;
  selectedPatternId: HarmonyRhythmPatternId;
  customBasePatternId: HarmonyRhythmPatternId | null;
  onPatternChange: (value: HarmonyRhythmPatternId) => void;
};

export type HarmonyRhythmPatternCardProps = {
  pattern: HarmonyRhythmPatternDefinition;
  meter: Meter;
  selected: boolean;
  onClick: () => void;
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
  onPartCountChange: (value: "3" | "4") => void;
  onHarmonyRhythmPatternChange: (value: HarmonyRhythmPatternId) => void;
  onPreviewPattern: () => void;
  onPreviewCustom: () => void;
  onStopPreview: () => void;
  onCustomizeHarmony: () => void;
  onResetCustomHarmony: () => void;
  onStart: () => void;
};
