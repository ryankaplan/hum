import { Box, Button, Flex, Stack, Text } from "@chakra-ui/react";
import type { KeyboardEvent, MouseEvent } from "react";
import {
  getAvailableHarmonyRhythmPatterns,
  getHarmonyRhythmPreviewSteps,
} from "../../music/harmonyRhythmPatterns";
import { dsColors, dsOutlineButton } from "../designSystem";
import { PlayIcon, StopIcon } from "../icons";
import type {
  HarmonyRhythmPatternCardProps,
  HarmonyRhythmPatternPickerProps,
} from "./types";

export function HarmonyRhythmPatternPicker({
  meter,
  selectedPatternId,
  customBasePatternId,
  onPatternChange,
  previewingPatternId,
  previewingPatternStepIndex,
  onPatternPreviewToggle,
}: HarmonyRhythmPatternPickerProps) {
  const patterns = getAvailableHarmonyRhythmPatterns(meter);
  const customPatternName =
    patterns.find((pattern) => pattern.id === customBasePatternId)?.name ??
    "selected pattern";

  return (
    <Stack gap={2.5}>
      <Flex align="center" justify="space-between" gap={3} wrap="wrap">
        <Text color={dsColors.text} fontSize="sm" fontWeight="semibold">
          Harmony Rhythm
        </Text>
        {customBasePatternId != null ? (
          <Text color={dsColors.textSubtle} fontSize="xs" fontWeight="medium">
            Custom from {customPatternName}
          </Text>
        ) : null}
      </Flex>

      <Box
        overflowX="auto"
        overflowY="hidden"
        pb={1}
        css={{
          scrollbarWidth: "thin",
        }}
      >
        <Flex gap={2.5} minW="max-content">
          {patterns.map((pattern) => (
            <HarmonyRhythmPatternCard
              key={pattern.id}
              pattern={pattern}
              meter={meter}
              activePreviewStepIndex={
                previewingPatternId === pattern.id
                  ? previewingPatternStepIndex
                  : null
              }
              previewing={previewingPatternId === pattern.id}
              selected={selectedPatternId === pattern.id}
              onClick={() => onPatternChange(pattern.id)}
              onPreviewToggle={() => onPatternPreviewToggle(pattern.id)}
            />
          ))}
        </Flex>
      </Box>
    </Stack>
  );
}

function HarmonyRhythmPatternCard({
  pattern,
  meter,
  activePreviewStepIndex,
  previewing,
  selected,
  onClick,
  onPreviewToggle,
}: HarmonyRhythmPatternCardProps) {
  const previewSteps = getHarmonyRhythmPreviewSteps(pattern, meter);

  function handlePreviewButtonClick(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
    onPreviewToggle();
  }

  function handleCardKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClick();
  }

  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleCardKeyDown}
      aria-pressed={selected}
      textAlign="left"
      boxSizing="border-box"
      flex="0 0 auto"
      w={{ base: "112px", md: "116px" }}
      h="80px"
      px={2.5}
      py={2.5}
      borderRadius="xl"
      bg={selected ? dsColors.surfaceRaised : dsColors.surfaceSubtle}
      border="1px solid"
      borderColor={selected ? dsColors.accent : dsColors.borderMuted}
      transition="background 120ms ease, border-color 120ms ease"
      _hover={{
        bg: dsColors.surfaceRaised,
        borderColor: selected ? dsColors.accent : dsColors.borderMuted,
      }}
    >
      <Flex direction="column" h="100%" justify="space-between" gap={3}>
        <Flex justify="space-between" align="flex-start" gap={2}>
          <Text
            color={dsColors.text}
            fontSize="11px"
            fontWeight="semibold"
            lineHeight="1.2"
            whiteSpace="normal"
            overflow="hidden"
            display="-webkit-box"
            style={{ WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
            flex="1 1 auto"
          >
            {pattern.name}
          </Text>
          <Button
            {...dsOutlineButton}
            size="xs"
            h={7}
            minW={7}
            px={0}
            flex="0 0 auto"
            borderRadius="full"
            borderColor="transparent"
            bg="transparent"
            color={previewing ? dsColors.accent : dsColors.textMuted}
            onClick={handlePreviewButtonClick}
            _hover={{
              bg: dsColors.surfaceSubtle,
              color: previewing ? dsColors.accent : dsColors.text,
            }}
          >
            <Flex
              align="center"
              justify="center"
              w="100%"
              h="100%"
              aria-label={`${previewing ? "Stop" : "Play"} ${pattern.name} rhythm preview`}
            >
              {previewing ? <StopIcon size={11} /> : <PlayIcon size={11} />}
            </Flex>
          </Button>
        </Flex>

        <Flex gap={1.5} align="center">
          {previewSteps.map((active, index) => (
            <Box
              key={`${pattern.id}-step-${index}`}
              flex="0 0 auto"
              w="7px"
              h="7px"
              borderRadius="full"
              bg={active ? dsColors.accent : dsColors.outline}
              opacity={active ? 1 : 0.45}
              transform={
                activePreviewStepIndex === index ? "scale(1.4)" : "scale(1)"
              }
              boxShadow={
                activePreviewStepIndex === index
                  ? "0 0 0 2px color-mix(in srgb, var(--app-accent) 18%, transparent)"
                  : "none"
              }
              transition="transform 90ms ease, box-shadow 90ms ease, opacity 90ms ease"
            />
          ))}
        </Flex>
      </Flex>
    </Box>
  );
}
