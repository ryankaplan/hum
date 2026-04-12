import { Box, Flex, Stack, Text, Tooltip } from "@chakra-ui/react";
import { chordToneFormula } from "../../music/harmony";
import { chordPitchClassNames, formatChordSymbol } from "../../music/parse";
import { midiToNoteName } from "../../music/types";
import { dsColors } from "../designSystem";
import type { VoicingComparisonSectionProps } from "./types";

export function VoicingComparisonSection({
  title,
  parsed,
  voicing,
  measures,
}: VoicingComparisonSectionProps) {
  const slices = measures.flatMap((measure) => measure.slices);

  return (
    <Stack gap={2}>
      {title ? (
        <Text color={dsColors.textMuted} fontSize="xs" fontWeight="semibold">
          {title}
        </Text>
      ) : null}
      <Flex gap={2} flexWrap="wrap">
        {parsed.map((chord, index) => {
          const annotation = voicing.annotations[index];
          const degrees = annotation?.chordTones ?? chordToneFormula(chord);
          const pitchClasses = chordPitchClassNames(chord);
          const voicedNotes = voicing.lines
            .map((line) => line[index])
            .filter((note): note is number => note != null)
            .map((note) => midiToNoteName(note))
            .join(" ");
          const tooltipText = `${degrees} - ${pitchClasses} - ${voicedNotes}`;
          const previewSlices = slices.filter((slice) => slice.chordEventIndex === index);
          const previewItem = previewSlices[0];
          const isContinuation = previewSlices.length > 1;

          return (
            <Tooltip.Root
              key={`${title}-${index}`}
              openDelay={0}
              closeDelay={250}
              interactive
              positioning={{ gutter: 8 }}
            >
              <Tooltip.Trigger asChild>
                <Box
                  as="span"
                  bg={dsColors.surfaceSubtle}
                  borderRadius="2xl"
                  px={3}
                  py={2}
                  fontSize="sm"
                  color={dsColors.text}
                  display="inline-flex"
                  flexDirection="column"
                  alignItems="flex-start"
                  gap={0.5}
                  cursor="help"
                  userSelect="none"
                  border="1px solid"
                  borderColor="transparent"
                  _hover={{
                    borderColor: dsColors.borderMuted,
                    bg: dsColors.surfaceRaised,
                  }}
                  aria-label={tooltipText}
                  boxShadow={isContinuation ? "inset 0 0 0 1px rgba(77,68,227,0.22)" : undefined}
                >
                  <Text as="span" fontWeight="semibold">
                    {previewItem?.chordText ?? formatChordSymbol(chord)}
                  </Text>
                  {previewItem?.lyrics.trim() ? (
                    <Text
                      as="span"
                      fontSize="xs"
                      color={dsColors.textMuted}
                      fontWeight="medium"
                      whiteSpace="nowrap"
                    >
                      {previewItem.lyrics}
                    </Text>
                  ) : null}
                  <Text
                    as="span"
                    fontSize="10px"
                    color={dsColors.textSubtle}
                    whiteSpace="nowrap"
                  >
                    {voicedNotes}
                  </Text>
                </Box>
              </Tooltip.Trigger>
              <Tooltip.Positioner>
                <Tooltip.Content
                  px={3}
                  py={2}
                  borderRadius="md"
                  maxW="sm"
                  bg={dsColors.surfaceRaised}
                  color={dsColors.text}
                  borderWidth="1px"
                  borderColor={dsColors.border}
                  boxShadow="md"
                  fontSize="xs"
                >
                  {tooltipText}
                </Tooltip.Content>
              </Tooltip.Positioner>
            </Tooltip.Root>
          );
        })}
      </Flex>
    </Stack>
  );
}
