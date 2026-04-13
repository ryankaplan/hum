import {
  Field,
  Grid,
  Input,
  NativeSelect,
  Stack,
} from "@chakra-ui/react";
import type { HarmonyRangeCoverage } from "../../music/types";
import { dsColors, dsFocusRing, dsInputControl } from "../designSystem";
import {
  HARMONY_PRIORITY_OPTIONS,
  HARMONY_COVERAGE_OPTIONS,
  METER_OPTIONS,
  RANGE_OPTIONS,
  type SetupFormFieldsProps,
} from "./types";

const controlStyles = {
  ...dsInputControl,
  _focus: {
    borderColor: dsColors.focusRing,
    boxShadow: dsFocusRing,
  },
};

export function SetupFormFields({
  meterLabel,
  tempoInputValue,
  selectedRangeValue,
  harmonyRangeCoverage,
  harmonyPriority,
  totalParts,
  onTempoInputChange,
  onTempoInputBlur,
  onMeterLabelChange,
  onRangePresetChange,
  onHarmonyCoverageChange,
  onHarmonyPriorityChange,
  onPartCountChange,
}: SetupFormFieldsProps) {
  return (
    <Stack gap={4}>
      <Grid templateColumns={{ base: "1fr", md: "1fr 1fr 1fr" }} gap={4}>
        <Field.Root>
          <Field.Label color={dsColors.text}>Tempo (BPM)</Field.Label>
          <Input
            type="number"
            value={tempoInputValue}
            min={40}
            max={240}
            onChange={(e) => onTempoInputChange(e.target.value)}
            onBlur={onTempoInputBlur}
            {...controlStyles}
          />
        </Field.Root>

        <Field.Root>
          <Field.Label color={dsColors.text}>Meter</Field.Label>
          <NativeSelect.Root>
            <NativeSelect.Field
              value={meterLabel}
              onChange={(e) => onMeterLabelChange(e.target.value)}
              {...controlStyles}
            >
              {METER_OPTIONS.map((option) => (
                <option key={option.label} value={option.label}>
                  {option.label}
                </option>
              ))}
            </NativeSelect.Field>
          </NativeSelect.Root>
        </Field.Root>

        <Field.Root>
          <Field.Label color={dsColors.text}>Range</Field.Label>
          <NativeSelect.Root>
            <NativeSelect.Field
              value={selectedRangeValue}
              onChange={(e) => onRangePresetChange(e.target.value)}
              {...controlStyles}
            >
              <option value="" disabled>
                Select range
              </option>
              {RANGE_OPTIONS.map((option) => (
                <option key={option.label} value={option.label}>
                  {option.label}: {option.low}-{option.high}
                </option>
              ))}
            </NativeSelect.Field>
          </NativeSelect.Root>
        </Field.Root>
      </Grid>

      <Grid templateColumns={{ base: "1fr", md: "1fr 1fr 1fr" }} gap={4}>
        <Field.Root>
          <Field.Label color={dsColors.text}>Harmony Placement</Field.Label>
          <NativeSelect.Root>
            <NativeSelect.Field
              value={harmonyRangeCoverage}
              onChange={(e) =>
                onHarmonyCoverageChange(e.target.value as HarmonyRangeCoverage)
              }
              {...controlStyles}
            >
              {HARMONY_COVERAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect.Field>
          </NativeSelect.Root>
        </Field.Root>

        <Field.Root>
          <Field.Label color={dsColors.text}>Harmony Priority</Field.Label>
          <NativeSelect.Root>
            <NativeSelect.Field
              value={harmonyPriority}
              onChange={(e) =>
                onHarmonyPriorityChange(
                  e.target.value === "chordIntent"
                    ? "chordIntent"
                    : "voiceLeading",
                )
              }
              {...controlStyles}
            >
              {HARMONY_PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect.Field>
          </NativeSelect.Root>
        </Field.Root>

        <Field.Root>
          <Field.Label color={dsColors.text}>Voices</Field.Label>
          <NativeSelect.Root>
            <NativeSelect.Field
              value={String(totalParts)}
              onChange={(e) =>
                onPartCountChange(e.target.value === "3" ? "3" : "4")
              }
              {...controlStyles}
            >
              <option value="3">3-part (2 harmony + melody)</option>
              <option value="4">4-part (3 harmony + melody)</option>
            </NativeSelect.Field>
          </NativeSelect.Root>
        </Field.Root>
      </Grid>
    </Stack>
  );
}
