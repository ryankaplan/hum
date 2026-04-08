import { Box, Button, Flex, NativeSelect, Stack, Text } from "@chakra-ui/react";
import type { SelectedHarmonyGenerator } from "../../music/types";
import {
  dsColors,
  dsFocusRing,
  dsInputControl,
  dsOutlineButton,
} from "../designSystem";
import { EditIcon, PlayIcon, StopIcon } from "../icons";
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
  const previewingSelected = previewingMode === selectedHarmonyGenerator;
  const previewingCustom = previewingMode === "custom";

  return (
    <Box bg={dsColors.surfaceRaised} borderRadius="xl" p={4}>
      <Stack gap={4}>
        <Flex justify="space-between" align="center" gap={3} wrap="wrap">
          <Text color={dsColors.textMuted} fontSize="xs" fontWeight="semibold">
            ARRANGEMENT
          </Text>
          <Flex gap={2} align="center" wrap="wrap" justify="flex-end">
            <NativeSelect.Root
              size="sm"
              width="auto"
              minW="unset"
              flex="0 0 auto"
            >
              <NativeSelect.Field
                value={selectedHarmonyGenerator}
                onChange={(e) =>
                  onSelectedHarmonyGeneratorChange(
                    e.target.value as SelectedHarmonyGenerator,
                  )
                }
                width="auto"
                minW="7rem"
                pr={8}
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
              color={previewingSelected ? dsColors.accent : dsColors.textMuted}
              _hover={{
                bg: dsColors.surfaceSubtle,
                color: previewingSelected ? dsColors.accent : dsColors.text,
              }}
              onClick={previewingSelected ? onStopPreview : onPreviewSelected}
            >
              <Flex align="center" gap={1.5}>
                {previewingSelected ? (
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
              onClick={onCustomizeHarmony}
            >
              <Flex align="center" gap={1.5}>
                <EditIcon size={14} />
                <Text fontSize="xs" fontWeight="semibold">
                  Edit
                </Text>
              </Flex>
            </Button>
            {hasCustomHarmony && effectiveHarmonyVoicing != null ? (
              <Button
                {...dsOutlineButton}
                size="xs"
                h={7}
                px={2.5}
                borderRadius="full"
                borderColor="transparent"
                color={previewingCustom ? dsColors.accent : dsColors.textMuted}
                _hover={{
                  bg: dsColors.surfaceSubtle,
                  color: previewingCustom ? dsColors.accent : dsColors.text,
                }}
                onClick={previewingCustom ? onStopPreview : onPreviewCustom}
              >
                <Flex align="center" gap={1.5}>
                  {previewingCustom ? (
                    <StopIcon size={14} strokeWidth={2.1} />
                  ) : (
                    <PlayIcon size={14} strokeWidth={2.1} />
                  )}
                  <Text fontSize="xs" fontWeight="semibold">
                    Preview Edit
                  </Text>
                </Flex>
              </Button>
            ) : null}
            {hasCustomHarmony ? (
              <Button {...dsOutlineButton} onClick={onResetCustomHarmony}>
                Reset
              </Button>
            ) : null}
          </Flex>
        </Flex>
        <VoicingComparisonSection
          title={undefined}
          parsed={parsed}
          voicing={selectedHarmonyVoicing ?? legacyVoicing}
          chordPreviewItems={chordPreviewItems}
        />
        {hasCustomHarmony && effectiveHarmonyVoicing != null && (
          <VoicingComparisonSection
            title="Edited"
            parsed={parsed}
            voicing={effectiveHarmonyVoicing}
            chordPreviewItems={chordPreviewItems}
          />
        )}
      </Stack>
    </Box>
  );
}
