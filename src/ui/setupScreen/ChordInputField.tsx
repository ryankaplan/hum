import { Box, Flex, Text, Textarea, Tooltip } from "@chakra-ui/react";
import { dsColors, dsFocusRing, dsInputControl } from "../designSystem";
import { InfoIcon } from "../icons";

type ChordInputFieldProps = {
  chordsInput: string;
  onChordsChange: (value: string) => void;
};

const controlStyles = {
  ...dsInputControl,
  _focus: {
    borderColor: dsColors.focusRing,
    boxShadow: dsFocusRing,
  },
};

export function ChordInputField({
  chordsInput,
  onChordsChange,
}: ChordInputFieldProps) {
  return (
    <Box>
      <Flex align="center" justify="space-between" gap={3} mb={2}>
        <Text color={dsColors.text} fontSize="sm" fontWeight="medium">
          Chord progression
        </Text>
        <Tooltip.Root
          openDelay={0}
          closeDelay={250}
          interactive
          positioning={{ gutter: 8 }}
        >
          <Tooltip.Trigger asChild>
            <Box
              aria-label="Chord progression help"
              display="inline-flex"
              alignItems="center"
              justifyContent="center"
              color={dsColors.textMuted}
              cursor="help"
              _hover={{
                color: dsColors.text,
              }}
            >
              <InfoIcon size={20} strokeWidth={1.9} />
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
              Spaces separate full-measure chords. Add `.` for half a measure,
              `..` for a quarter measure, and place lyric lines directly under
              chord lines in monospaced text.
            </Tooltip.Content>
          </Tooltip.Positioner>
        </Tooltip.Root>
      </Flex>
      <Textarea
        rows={6}
        value={chordsInput}
        onChange={(e) => onChordsChange(e.target.value)}
        placeholder={
          "A Bm C\n\nA. Bm. C\n\nA          E    F#m     D      A    E\nWhere are we?   What the hell is going on?"
        }
        fontFamily="'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', monospace"
        lineHeight="1.45"
        resize="vertical"
        {...controlStyles}
        spellCheck={false}
      />
    </Box>
  );
}
