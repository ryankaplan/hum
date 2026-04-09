import { Box, Button, Flex, Text } from "@chakra-ui/react";
import { dsColors } from "./designSystem";
import { StopIcon } from "./icons";

type RecordingBeatIndicatorProps = {
  phase: "counting-in" | "listening" | "recording";
  activeBeatInBar: number;
  beatIsDownbeat: boolean;
  beatLabel: string;
  onStopRecording: () => void;
};

export function RecordingBeatIndicator({
  phase,
  activeBeatInBar,
  beatIsDownbeat,
  beatLabel,
  onStopRecording,
}: RecordingBeatIndicatorProps) {
  return (
    <Box bg={dsColors.surfaceRaised} borderRadius="xl" px={4} py={3}>
      <Flex align="center" justify="space-between" mb={2}>
        {phase === "counting-in" && (
          <Text color={dsColors.textMuted} fontSize="xs" fontWeight="semibold">
            COUNT-IN
          </Text>
        )}
        {phase === "listening" && (
          <Text color={dsColors.accent} fontSize="xs" fontWeight="semibold">
            LISTENING
          </Text>
        )}
        {phase === "recording" && (
          <>
            <Flex align="center" gap={2}>
              <Box
                w={2}
                h={2}
                borderRadius="full"
                bg={dsColors.errorBorder}
                animation="recPulse 1s ease-in-out infinite"
              />
              <Text color={dsColors.errorText} fontSize="xs" fontWeight="semibold">
                RECORDING
              </Text>
            </Flex>
            <Button
              variant="ghost"
              size="xs"
              minW="28px"
              h="28px"
              p={0}
              borderRadius="full"
              color={dsColors.errorText}
              border="1px solid"
              borderColor={dsColors.errorBorder}
              onClick={onStopRecording}
              aria-label="Stop recording"
              title="Stop recording"
              lineHeight={0}
            >
              <StopIcon size={16} strokeWidth={2.1} />
            </Button>
          </>
        )}
      </Flex>
      <Flex align="center" justify="space-between">
        <Flex align="center" gap={2}>
          <Box
            key={`beat-pulse-${phase}-${activeBeatInBar}`}
            w={beatIsDownbeat ? 2.5 : 2}
            h={beatIsDownbeat ? 2.5 : 2}
            borderRadius="full"
            bg={beatIsDownbeat ? dsColors.accent : dsColors.accentHover}
            opacity={activeBeatInBar >= 0 ? 1 : 0.45}
            animation={
              activeBeatInBar >= 0 ? "beatPulse 260ms ease-out 1" : undefined
            }
            style={
              beatIsDownbeat
                ? {
                    boxShadow:
                      "0 0 6px color-mix(in srgb, var(--app-accent) 42%, transparent)",
                  }
                : undefined
            }
          />
          <Text
            color={beatIsDownbeat ? dsColors.accent : dsColors.textMuted}
            fontSize="xs"
            fontWeight="semibold"
          >
            {beatLabel}
          </Text>
        </Flex>
      </Flex>
    </Box>
  );
}
