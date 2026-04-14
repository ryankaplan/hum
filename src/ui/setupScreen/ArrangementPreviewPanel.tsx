import { Box, Button, Flex, Stack, Text } from "@chakra-ui/react";
import {
  dsColors,
  dsOutlineButton,
} from "../designSystem";
import { EditIcon, PlayIcon, StopIcon } from "../icons";
import { VoicingComparisonSection } from "./VoicingComparisonSection";
import type { ArrangementPreviewPanelProps } from "./types";

export function ArrangementPreviewPanel({
  measures,
  parsed,
  harmonyVoicing,
  effectiveHarmonyVoicing,
  hasCustomHarmony,
  previewingMode,
  onPreviewSelected,
  onPreviewCustom,
  onStopPreview,
  onCustomizeHarmony,
  onResetCustomHarmony,
}: ArrangementPreviewPanelProps) {
  const previewingSelected = previewingMode === "generated";
  const previewingCustom = previewingMode === "custom";

  return (
    <Box bg={dsColors.surfaceRaised} borderRadius="xl" p={4}>
      <Stack gap={4}>
        <Flex justify="space-between" align="center" gap={3} wrap="wrap">
          <Text color={dsColors.textMuted} fontSize="xs" fontWeight="semibold">
            ARRANGEMENT
          </Text>
          <Flex gap={2} align="center" wrap="wrap" justify="flex-end">
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
          voicing={harmonyVoicing}
          measures={measures}
        />
        {hasCustomHarmony && effectiveHarmonyVoicing != null && (
          <VoicingComparisonSection
            title="Edited"
            parsed={parsed}
            voicing={effectiveHarmonyVoicing}
            measures={measures}
          />
        )}
      </Stack>
    </Box>
  );
}
