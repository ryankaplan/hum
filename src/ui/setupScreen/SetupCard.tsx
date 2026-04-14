import { Box, Button, Heading, Stack, Text } from "@chakra-ui/react";
import { getHarmonyRhythmPattern } from "../../music/harmonyRhythmPatterns";
import { dsColors, dsPanel, dsPrimaryButton } from "../designSystem";
import { ArrangementPreviewPanel } from "./ArrangementPreviewPanel";
import { ChordInputField } from "./ChordInputField";
import { HarmonyRhythmPatternPicker } from "./HarmonyRhythmPatternPicker";
import { SetupFormFields } from "./SetupFormFields";
import { RANGE_OPTIONS, type SetupCardProps } from "./types";

export function SetupCard({
  arrangement,
  meterLabel,
  tempoInputValue,
  previewingMode,
  starting,
  error,
  onChordsChange,
  onTempoInputChange,
  onTempoInputBlur,
  onMeterLabelChange,
  onRangePresetChange,
  onHarmonyCoverageChange,
  onHarmonyPriorityChange,
  onPartCountChange,
  onHarmonyRhythmPatternChange,
  onPreviewPattern,
  onPreviewCustom,
  onStopPreview,
  onCustomizeHarmony,
  onResetCustomHarmony,
  onStart,
}: SetupCardProps) {
  const {
    input,
    measures,
    parsedChords: parsed,
    invalidChordIds,
    parseIssues,
    harmonyVoicing,
    effectiveHarmonyVoicing,
    hasCustomHarmony,
    isValid,
  } = arrangement;
  const {
    chordsInput,
    vocalRangeLow: rangeLow,
    vocalRangeHigh: rangeHigh,
    harmonyRangeCoverage,
    harmonyPriority,
    totalParts,
    harmonyRhythmPatternId,
  } = input;
  const selectedRangeValue =
    RANGE_OPTIONS.find(
      (option) => option.low === rangeLow && option.high === rangeHigh,
    )?.label ?? "";
  const selectedPattern = getHarmonyRhythmPattern(harmonyRhythmPatternId);

  return (
    <Box w="100%" p={{ base: 6, md: 8 }} overflow="hidden" {...dsPanel}>
      <Stack gap={6}>
        <Box>
          <Heading
            color={dsColors.accent}
            fontSize={{ base: "3.1rem", md: "3.35rem" }}
            lineHeight="0.95"
            letterSpacing="-0.02em"
            fontFamily="'Quicksand', 'Manrope', 'Avenir Next', sans-serif"
            fontWeight="500"
          >
            hum
          </Heading>
        </Box>

        <SetupFormFields
          meterLabel={meterLabel}
          tempoInputValue={tempoInputValue}
          selectedRangeValue={selectedRangeValue}
          harmonyRangeCoverage={harmonyRangeCoverage}
          harmonyPriority={harmonyPriority}
          totalParts={totalParts}
          onTempoInputChange={onTempoInputChange}
          onTempoInputBlur={onTempoInputBlur}
          onMeterLabelChange={onMeterLabelChange}
          onRangePresetChange={onRangePresetChange}
          onHarmonyCoverageChange={onHarmonyCoverageChange}
          onHarmonyPriorityChange={onHarmonyPriorityChange}
          onPartCountChange={onPartCountChange}
        />

        <HarmonyRhythmPatternPicker
          meter={input.meter}
          selectedPatternId={harmonyRhythmPatternId}
          customBasePatternId={hasCustomHarmony ? harmonyRhythmPatternId : null}
          onPatternChange={onHarmonyRhythmPatternChange}
        />

        {parsed.length > 0 && harmonyVoicing != null && (
          <>
            <ChordInputField
              chordsInput={chordsInput}
              onChordsChange={onChordsChange}
            />
            <ArrangementPreviewPanel
              measures={measures}
              parsed={parsed}
              patternName={selectedPattern.name}
              customBasePatternName={
                hasCustomHarmony ? selectedPattern.name : null
              }
              harmonyVoicing={harmonyVoicing}
              effectiveHarmonyVoicing={effectiveHarmonyVoicing}
              hasCustomHarmony={hasCustomHarmony}
              previewingMode={previewingMode}
              onPreviewPattern={onPreviewPattern}
              onPreviewCustom={onPreviewCustom}
              onStopPreview={onStopPreview}
              onCustomizeHarmony={onCustomizeHarmony}
              onResetCustomHarmony={onResetCustomHarmony}
            />
          </>
        )}

        {parsed.length === 0 || harmonyVoicing == null ? (
          <ChordInputField
            chordsInput={chordsInput}
            onChordsChange={onChordsChange}
          />
        ) : null}

        {(invalidChordIds.length > 0 || parseIssues.length > 0) && (
          <Box
            bg={dsColors.errorBg}
            border="1px solid"
            borderColor={dsColors.errorBorder}
            borderRadius="lg"
            p={4}
          >
            <Text color={dsColors.errorText} fontSize="sm">
              {parseIssues[0] ??
                "Some chord tokens are unsupported right now. Use supported chord spellings before continuing."}
            </Text>
          </Box>
        )}

        {error != null && (
          <Box
            bg={dsColors.errorBg}
            border="1px solid"
            borderColor={dsColors.errorBorder}
            borderRadius="lg"
            p={4}
          >
            <Text color={dsColors.errorText} fontSize="sm">
              {error}
            </Text>
          </Box>
        )}

        <Button
          {...dsPrimaryButton}
          size="lg"
          onClick={onStart}
          disabled={!isValid || starting}
          w="100%"
        >
          {starting ? "Starting..." : "Calibrate Microphone"}
        </Button>

        {!isValid && parsed.length === 0 && (
          <Text color={dsColors.textSubtle} fontSize="xs" textAlign="center">
            Enter a valid chord progression to continue
          </Text>
        )}
      </Stack>
    </Box>
  );
}
