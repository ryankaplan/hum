import { Box, Button, Flex, NativeSelect, Stack, Text } from "@chakra-ui/react";
import type { SelectedHarmonyGenerator } from "../../music/types";
import {
  dsColors,
  dsFocusRing,
  dsInputControl,
  dsOutlineButton,
} from "../designSystem";
import { PlayIcon, StopIcon } from "../icons";
import { VoicingComparisonSection } from "./VoicingComparisonSection";
import type { ArrangementPreviewPanelProps } from "./types";

const controlStyles = {
  ...dsInputControl,
  _focus: {
    borderColor: dsColors.focusRing,
    boxShadow: dsFocusRing,
  },
};

export function ArrangementPreviewPanel({
  measures,
  parsed,
  legacyVoicing,
  selectedHarmonyGenerator,
  selectedHarmonyVoicing,
  effectiveHarmonyVoicing,
  hasCustomHarmony,
  previewingMode,
  chordPreviewItems,
  onSelectedHarmonyGeneratorChange,
  onPreviewSelected,
  onPreviewCustom,
  onStopPreview,
  onCustomizeHarmony,
  onResetCustomHarmony,
}: ArrangementPreviewPanelProps) {
  return (
    <Box bg={dsColors.surfaceRaised} borderRadius="xl" p={4}>
      <Stack gap={3}>
        <Flex justify="space-between" align="center" gap={3} wrap="wrap">
          <Text color={dsColors.textMuted} fontSize="xs" fontWeight="semibold">
            ARRANGEMENT - {measures.length} measure
            {measures.length !== 1 ? "s" : ""}, {parsed.length} chord
            {parsed.length !== 1 ? "s" : ""}
          </Text>
          <Flex gap={2} align="center">
            <NativeSelect.Root size="sm">
              <NativeSelect.Field
                value={selectedHarmonyGenerator}
                onChange={(e) =>
                  onSelectedHarmonyGeneratorChange(
                    e.target.value as SelectedHarmonyGenerator,
                  )
                }
                {...controlStyles}
              >
                <option value="legacy">Basic</option>
                <option value="dynamic">Beam Search</option>
              </NativeSelect.Field>
            </NativeSelect.Root>
            <Button
              {...dsOutlineButton}
              size="xs"
              h={7}
              px={2.5}
              borderRadius="full"
              borderColor="transparent"
              color={
                previewingMode === selectedHarmonyGenerator
                  ? dsColors.accent
                  : dsColors.textMuted
              }
              _hover={{
                bg: dsColors.surfaceSubtle,
                color:
                  previewingMode === selectedHarmonyGenerator
                    ? dsColors.accent
                    : dsColors.text,
              }}
              onClick={
                previewingMode === selectedHarmonyGenerator
                  ? onStopPreview
                  : onPreviewSelected
              }
            >
              <Flex align="center" gap={1.5}>
                {previewingMode === selectedHarmonyGenerator ? (
                  <StopIcon size={14} strokeWidth={2.1} />
                ) : (
                  <PlayIcon size={14} strokeWidth={2.1} />
                )}
                <Text fontSize="xs" fontWeight="semibold">
                  Preview
                </Text>
              </Flex>
            </Button>
            <Button
              {...dsOutlineButton}
              size="xs"
              h={7}
              px={2.5}
              borderRadius="full"
              borderColor="transparent"
              color={
                previewingMode === "custom"
                  ? dsColors.accent
                  : dsColors.textMuted
              }
              _hover={{
                bg: dsColors.surfaceSubtle,
                color:
                  previewingMode === "custom" ? dsColors.accent : dsColors.text,
              }}
              disabled={!hasCustomHarmony || effectiveHarmonyVoicing == null}
              onClick={
                previewingMode === "custom" ? onStopPreview : onPreviewCustom
              }
            >
              <Flex align="center" gap={1.5}>
                {previewingMode === "custom" ? (
                  <StopIcon size={14} strokeWidth={2.1} />
                ) : (
                  <PlayIcon size={14} strokeWidth={2.1} />
                )}
                <Text fontSize="xs" fontWeight="semibold">
                  Custom
                </Text>
              </Flex>
            </Button>
          </Flex>
        </Flex>
        <VoicingComparisonSection
          title={selectedHarmonyGenerator === "legacy" ? "Legacy" : "Dynamic"}
          parsed={parsed}
          voicing={selectedHarmonyVoicing ?? legacyVoicing}
          chordPreviewItems={chordPreviewItems}
        />
        {hasCustomHarmony && effectiveHarmonyVoicing != null && (
          <VoicingComparisonSection
            title="Custom"
            parsed={parsed}
            voicing={effectiveHarmonyVoicing}
            chordPreviewItems={chordPreviewItems}
          />
        )}
      </Stack>
      <Flex
        mt={4}
        pt={4}
        borderTop="1px solid"
        borderColor={dsColors.border}
        justify="space-between"
        align={{ base: "flex-start", md: "center" }}
        gap={3}
        flexWrap="wrap"
      >
        <Box>
          <Text color={dsColors.textMuted} fontSize="xs" fontWeight="semibold">
            HARMONY EDITING
          </Text>
          <Text color={dsColors.text} fontSize="sm" fontWeight="medium">
            {hasCustomHarmony ? "Custom harmony active" : "Using auto harmony"}
          </Text>
          <Text color={dsColors.textSubtle} fontSize="xs">
            Lyrics stay read-only and chord timing stays fixed.
          </Text>
        </Box>
        <Flex gap={2} flexWrap="wrap">
          <Button {...dsOutlineButton} onClick={onCustomizeHarmony}>
            {hasCustomHarmony ? "Edit custom harmony" : "Customize harmony"}
          </Button>
          {hasCustomHarmony && (
            <Button {...dsOutlineButton} onClick={onResetCustomHarmony}>
              Reset to auto
            </Button>
          )}
        </Flex>
      </Flex>
    </Box>
  );
}
