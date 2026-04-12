import { Box, Flex, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import {
  getAvailableHarmonyRhythmPatterns,
  getHarmonyRhythmPreviewSteps,
} from "../../music/harmonyRhythmPatterns";
import { dsColors } from "../designSystem";
import type {
  HarmonyRhythmPatternCardProps,
  HarmonyRhythmPatternPickerProps,
} from "./types";

export function HarmonyRhythmPatternPicker({
  meter,
  selectedPatternId,
  customBasePatternId,
  onPatternChange,
}: HarmonyRhythmPatternPickerProps) {
  const patterns = getAvailableHarmonyRhythmPatterns(meter);

  return (
    <Stack gap={3}>
      <Flex align="center" justify="space-between" gap={3} wrap="wrap">
        <Box>
          <Text color={dsColors.text} fontSize="sm" fontWeight="semibold">
            Harmony Rhythm
          </Text>
          <Text color={dsColors.textMuted} fontSize="xs">
            Choose how the harmony attacks and releases across the bar.
          </Text>
        </Box>
        {customBasePatternId != null ? (
          <Text color={dsColors.textSubtle} fontSize="xs" fontWeight="medium">
            Custom from{" "}
            {patterns.find((pattern) => pattern.id === customBasePatternId)?.name ??
              "selected pattern"}
          </Text>
        ) : null}
      </Flex>

      <SimpleGrid columns={{ base: 1, md: 2 }} gap={3}>
        {patterns.map((pattern) => (
          <HarmonyRhythmPatternCard
            key={pattern.id}
            pattern={pattern}
            meter={meter}
            selected={selectedPatternId === pattern.id}
            onClick={() => onPatternChange(pattern.id)}
          />
        ))}
      </SimpleGrid>
    </Stack>
  );
}

function HarmonyRhythmPatternCard({
  pattern,
  meter,
  selected,
  onClick,
}: HarmonyRhythmPatternCardProps) {
  const previewSteps = getHarmonyRhythmPreviewSteps(pattern, meter);

  return (
    <Box
      as="button"
      onClick={onClick}
      textAlign="left"
      p={4}
      borderRadius="xl"
      bg={selected ? dsColors.surfaceRaised : dsColors.surfaceSubtle}
      border="1px solid"
      borderColor={selected ? dsColors.accent : "transparent"}
      boxShadow={selected ? "inset 0 0 0 1px var(--app-accent)" : "none"}
      transition="background 120ms ease, border-color 120ms ease"
      _hover={{
        bg: dsColors.surfaceRaised,
        borderColor: selected ? dsColors.accent : dsColors.borderMuted,
      }}
    >
      <Stack gap={3}>
        <Flex justify="space-between" gap={3} align="flex-start">
          <Box>
            <Text color={dsColors.text} fontSize="sm" fontWeight="semibold">
              {pattern.name}
            </Text>
            <Text color={dsColors.textMuted} fontSize="xs" mt={1}>
              {pattern.description}
            </Text>
          </Box>
          {selected ? (
            <Text color={dsColors.accent} fontSize="xs" fontWeight="semibold">
              Selected
            </Text>
          ) : null}
        </Flex>

        <Flex gap={1.5}>
          {previewSteps.map((active, index) => (
            <Box
              key={`${pattern.id}-step-${index}`}
              flex="1 1 0"
              h="10px"
              borderRadius="full"
              bg={active ? dsColors.accent : dsColors.outline}
              opacity={active ? 1 : 0.5}
            />
          ))}
        </Flex>

        <Flex gap={2} wrap="wrap">
          {pattern.tags.map((tag) => (
            <Box
              key={`${pattern.id}-${tag}`}
              px={2}
              py={1}
              borderRadius="full"
              bg={dsColors.bg}
            >
              <Text color={dsColors.textSubtle} fontSize="10px" fontWeight="semibold">
                {tag.toUpperCase()}
              </Text>
            </Box>
          ))}
        </Flex>
      </Stack>
    </Box>
  );
}
