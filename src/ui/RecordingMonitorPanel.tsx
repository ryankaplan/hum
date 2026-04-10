import { Box, Flex, Stack, Text } from "@chakra-ui/react";
import { dsColors } from "./designSystem";

type RecordingMonitorPanelProps = {
  guideLabel: string;
  hasPriorHarmonyMonitorControl: boolean;
  guideToneVolume: number;
  effectiveGuideToneLevel: number;
  beatVolume: number;
  priorHarmonyLevel: number;
  onGuideToneVolumeChange: (next: number) => void;
  onBeatVolumeChange: (next: number) => void;
  onPriorHarmonyVolumeChange: (next: number) => void;
};

function clampVolume(nextPercent: number) {
  return Math.max(0, Math.min(1, nextPercent / 100));
}

export function RecordingMonitorPanel({
  guideLabel,
  hasPriorHarmonyMonitorControl,
  guideToneVolume,
  effectiveGuideToneLevel,
  beatVolume,
  priorHarmonyLevel,
  onGuideToneVolumeChange,
  onBeatVolumeChange,
  onPriorHarmonyVolumeChange,
}: RecordingMonitorPanelProps) {
  return (
    <Box bg={dsColors.surfaceRaised} borderRadius="xl" px={4} py={3}>
      <details>
        <summary style={{ cursor: "pointer" }}>
          <Flex align="center" justify="space-between">
            <Text color={dsColors.textMuted} fontSize="xs" fontWeight="semibold">
              MONITORING
            </Text>
            <Text
              color={dsColors.textSubtle}
              fontSize="xs"
              fontWeight="semibold"
            >
              Expand
            </Text>
          </Flex>
        </summary>

        <Stack gap={3} mt={3}>
          <Box>
            <Flex justify="space-between" align="center" mb={1.5}>
              <Text color={dsColors.textMuted} fontSize="xs" fontWeight="semibold">
                {guideLabel}
              </Text>
              <Text color={dsColors.text} fontSize="xs" fontWeight="semibold">
                {Math.round(effectiveGuideToneLevel * 100)}%
              </Text>
            </Flex>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(guideToneVolume * 100)}
              onChange={(e) => {
                const next = Number.parseInt(e.currentTarget.value, 10);
                if (Number.isNaN(next)) return;
                onGuideToneVolumeChange(clampVolume(next));
              }}
              style={{
                width: "100%",
                accentColor:
                  "var(--chakra-colors-appAccent, var(--chakra-colors-app-accent))",
              }}
            />
          </Box>

          <Box>
            <Flex justify="space-between" align="center" mb={1.5}>
              <Text color={dsColors.textMuted} fontSize="xs" fontWeight="semibold">
                BEAT VOLUME
              </Text>
              <Text color={dsColors.text} fontSize="xs" fontWeight="semibold">
                {Math.round(beatVolume * 100)}%
              </Text>
            </Flex>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(beatVolume * 100)}
              onChange={(e) => {
                const next = Number.parseInt(e.currentTarget.value, 10);
                if (Number.isNaN(next)) return;
                onBeatVolumeChange(clampVolume(next));
              }}
              style={{
                width: "100%",
                accentColor:
                  "var(--chakra-colors-appAccent, var(--chakra-colors-app-accent))",
              }}
            />
          </Box>

          {hasPriorHarmonyMonitorControl && (
            <Box>
              <Flex justify="space-between" align="center" mb={1.5}>
                <Text color={dsColors.textMuted} fontSize="xs" fontWeight="semibold">
                  PREV HARMONIES VOLUME
                </Text>
                <Text color={dsColors.text} fontSize="xs" fontWeight="semibold">
                  {Math.round(priorHarmonyLevel * 100)}%
                </Text>
              </Flex>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(priorHarmonyLevel * 100)}
                onChange={(e) => {
                  const next = Number.parseInt(e.currentTarget.value, 10);
                  if (Number.isNaN(next)) return;
                  onPriorHarmonyVolumeChange(clampVolume(next));
                }}
                style={{
                  width: "100%",
                  accentColor:
                    "var(--chakra-colors-appAccent, var(--chakra-colors-app-accent))",
                }}
              />
            </Box>
          )}
        </Stack>
      </details>
    </Box>
  );
}
