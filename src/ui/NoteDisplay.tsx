import { Box, Flex, Text } from "@chakra-ui/react";
import { midiToNoteName } from "../music/types";
import type { Chord, HarmonyLine, MidiNote } from "../music/types";
import { playNotePreview } from "../music/playback";

type Props = {
  chords: Chord[];
  harmonyLine: HarmonyLine | null; // null for melody part
  activeChordIndex: number;
};

export function NoteDisplay({ chords, harmonyLine, activeChordIndex }: Props) {
  if (harmonyLine == null) {
    return (
      <Box bg="gray.800" borderRadius="xl" p={4}>
        <Text color="gray.400" fontSize="sm" textAlign="center">
          Melody — sing freely over the harmonies
        </Text>
      </Box>
    );
  }

  function handleNoteClick(midi: MidiNote | undefined) {
    if (midi == null) return;
    playNotePreview(midi);
  }

  return (
    <Box bg="gray.800" borderRadius="xl" p={4}>
      <Text color="gray.500" fontSize="xs" mb={3} fontWeight="semibold">
        YOUR NOTES — tap to hear
      </Text>
      <Flex gap={2} flexWrap="wrap">
        {chords.map((chord, i) => {
          const midi: MidiNote | undefined = harmonyLine[i];
          const noteName = midi != null ? midiToNoteName(midi) : "?";
          const isActive = i === activeChordIndex;
          return (
            <Box
              key={i}
              bg={isActive ? "brand.500" : "gray.700"}
              borderRadius="lg"
              px={3}
              py={2}
              textAlign="center"
              minW="60px"
              transition="background 0.15s"
              cursor="pointer"
              _hover={{ bg: isActive ? "brand.400" : "gray.600" }}
              _active={{ transform: "scale(0.95)" }}
              onClick={() => handleNoteClick(midi)}
              userSelect="none"
            >
              <Text
                color={isActive ? "white" : "gray.300"}
                fontSize="lg"
                fontWeight="bold"
                lineHeight="1"
              >
                {noteName}
              </Text>
              <Text
                color={isActive ? "brand.200" : "gray.500"}
                fontSize="xs"
                mt={0.5}
              >
                {chord.root}
                {chord.quality === "minor" ? "m" : ""}
              </Text>
            </Box>
          );
        })}
      </Flex>
    </Box>
  );
}
