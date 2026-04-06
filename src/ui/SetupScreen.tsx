import {
  Box,
  Button,
  Field,
  Flex,
  Grid,
  Heading,
  Input,
  NativeSelect,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useRef, useState } from "react";
import { useObservable } from "../observable";
import { acquirePermissionsAndStart } from "../recording/permissions";
import type { Meter } from "../music/types";
import {
  playHarmonyPreview,
  progressionDurationSec,
  stopAllPlayback,
} from "../music/playback";
import type { PlaybackSession } from "../music/playback";
import type { ArrangementInfo } from "../state/model";
import { model } from "../state/model";
import {
  dsColors,
  dsFocusRing,
  dsInputControl,
  dsOutlineButton,
  dsPanel,
  dsPrimaryButton,
  dsScreenShell,
} from "./designSystem";

const NOTE_OPTIONS = [
  "C2",
  "D2",
  "E2",
  "F2",
  "G2",
  "A2",
  "B2",
  "C3",
  "D3",
  "E3",
  "F3",
  "G3",
  "A3",
  "B3",
  "C4",
  "D4",
  "E4",
  "F4",
  "G4",
  "A4",
  "B4",
  "C5",
  "D5",
  "E5",
  "F5",
  "G5",
  "A5",
  "B5",
];

const METER_OPTIONS: { label: string; value: Meter }[] = [
  { label: "4/4", value: [4, 4] },
  { label: "3/4", value: [3, 4] },
  { label: "6/8", value: [6, 8] },
];

type SetupCardProps = {
  arrangement: ArrangementInfo;
  meterLabel: string;
  previewing: boolean;
  starting: boolean;
  error: string | null;
  onChordsChange: (value: string) => void;
  onTempoChange: (value: number) => void;
  onMeterLabelChange: (label: string) => void;
  onRangeLowChange: (value: string) => void;
  onRangeHighChange: (value: string) => void;
  onPartCountChange: (value: "2" | "4") => void;
  onPreview: () => void;
  onStopPreview: () => void;
  onStart: () => void;
};

function SetupCard({
  arrangement,
  meterLabel,
  previewing,
  starting,
  error,
  onChordsChange,
  onTempoChange,
  onMeterLabelChange,
  onRangeLowChange,
  onRangeHighChange,
  onPartCountChange,
  onPreview,
  onStopPreview,
  onStart,
}: SetupCardProps) {
  const {
    input,
    parsedChords: parsed,
    harmonyVoicing: voicing,
    isValid,
  } = arrangement;
  const {
    chordsInput: chords,
    tempo,
    vocalRangeLow: rangeLow,
    vocalRangeHigh: rangeHigh,
    totalParts,
  } = input;

  const controlStyles = {
    ...dsInputControl,
    _focus: {
      borderColor: dsColors.focusRing,
      boxShadow: dsFocusRing,
    },
  };

  return (
    <Box w="100%" p={{ base: 6, md: 8 }} overflow="hidden" {...dsPanel}>
      <Stack gap={6}>
        <Box>
          <Heading
            color={dsColors.accent}
            fontSize={{ base: "3.1rem", md: "3.35rem" }}
            lineHeight="0.95"
            letterSpacing="-0.02em"
            fontFamily="'Quicksand', 'Manrope', 'Avenir Next', sans-serif"
            fontWeight="500"
          >
            hum
          </Heading>
        </Box>

        <Stack gap={4}>
          <Field.Root>
            <Field.Label color={dsColors.text}>
              Chord Progression
            </Field.Label>
            <Input
              value={chords}
              onChange={(e) => onChordsChange(e.target.value)}
              placeholder="A A F#m F#m D D E E"
              {...controlStyles}
            />
            <Field.HelperText color={dsColors.textMuted} fontSize="xs">
              One chord per bar, space separated - repeat a chord to hold it:
              "Am Am G F F E"
            </Field.HelperText>
          </Field.Root>

          <Grid templateColumns="1fr 1fr" gap={4}>
            <Field.Root>
              <Field.Label color={dsColors.text}>Tempo (BPM)</Field.Label>
              <Input
                type="number"
                value={tempo}
                min={40}
                max={240}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v)) onTempoChange(v);
                }}
                {...controlStyles}
              />
            </Field.Root>

            <Field.Root>
              <Field.Label color={dsColors.text}>Meter</Field.Label>
              <NativeSelect.Root>
                <NativeSelect.Field
                  value={meterLabel}
                  onChange={(e) => onMeterLabelChange(e.target.value)}
                  {...controlStyles}
                >
                  {METER_OPTIONS.map((o) => (
                    <option key={o.label} value={o.label}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect.Field>
              </NativeSelect.Root>
            </Field.Root>
          </Grid>

          <Grid templateColumns="1fr 1fr" gap={4}>
            <Field.Root>
              <Field.Label color={dsColors.text}>Lowest Note</Field.Label>
              <NativeSelect.Root>
                <NativeSelect.Field
                  value={rangeLow}
                  onChange={(e) => onRangeLowChange(e.target.value)}
                  {...controlStyles}
                >
                  {NOTE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </NativeSelect.Field>
              </NativeSelect.Root>
            </Field.Root>

            <Field.Root>
              <Field.Label color={dsColors.text}>Highest Note</Field.Label>
              <NativeSelect.Root>
                <NativeSelect.Field
                  value={rangeHigh}
                  onChange={(e) => onRangeHighChange(e.target.value)}
                  {...controlStyles}
                >
                  {NOTE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </NativeSelect.Field>
              </NativeSelect.Root>
            </Field.Root>
          </Grid>

          <Field.Root>
            <Field.Label color={dsColors.text}>Arrangement</Field.Label>
            <NativeSelect.Root>
              <NativeSelect.Field
                value={String(totalParts)}
                onChange={(e) =>
                  onPartCountChange(e.target.value === "2" ? "2" : "4")
                }
                {...controlStyles}
              >
                <option value="4">4-part (3 harmony + melody)</option>
                <option value="2">2-part (harmony + melody)</option>
              </NativeSelect.Field>
            </NativeSelect.Root>
          </Field.Root>
        </Stack>

        {parsed.length > 0 && voicing != null && (
          <Box bg={dsColors.surfaceRaised} borderRadius="xl" p={4}>
            <Flex justify="space-between" align="center" mb={2} gap={2}>
              <Text
                color={dsColors.textMuted}
                fontSize="xs"
                fontWeight="semibold"
              >
                ARRANGEMENT - {parsed.length} chord
                {parsed.length !== 1 ? "s" : ""}
              </Text>
              <Button
                {...dsOutlineButton}
                size="xs"
                h={7}
                px={2.5}
                borderRadius="full"
                borderColor={previewing ? dsColors.focusRing : dsColors.outline}
                color={previewing ? dsColors.accent : dsColors.textMuted}
                onClick={previewing ? onStopPreview : onPreview}
                aria-label={
                  previewing ? "Stop harmony preview" : "Play harmony preview"
                }
              >
                {previewing ? "■" : "▶"}
              </Button>
            </Flex>
            <Flex gap={2} flexWrap="wrap">
              {parsed.map((c, i) => (
                <Box
                  key={i}
                  bg={dsColors.surfaceSubtle}
                  borderRadius="full"
                  px={3}
                  py={1}
                  fontSize="sm"
                  color={dsColors.text}
                  display="inline-flex"
                  alignItems="center"
                >
                  {c.root}
                  {c.quality === "minor" ? "m" : ""}
                  {(() => {
                    const annotation = voicing.annotations[i];
                    const strategyLabel =
                      annotation?.strategy === "closed"
                        ? "Closed fallback"
                        : "Drop-2";
                    const badgeLabel =
                      annotation?.strategy === "closed" ? "C" : "2";
                    const tones =
                      annotation?.chordTones ??
                      (c.quality === "minor" ? "R b3 5" : "R 3 5");
                    const hoverText = `${strategyLabel} - tones: ${tones}`;
                    return (
                      <Box
                        as="span"
                        title={hoverText}
                        aria-label={hoverText}
                        ml={2}
                        w="20px"
                        h="20px"
                        borderRadius="full"
                        bg={dsColors.border}
                        color={dsColors.textMuted}
                        fontSize="xs"
                        fontWeight="bold"
                        lineHeight="20px"
                        textAlign="center"
                        cursor="help"
                        userSelect="none"
                      >
                        {badgeLabel}
                      </Box>
                    );
                  })()}
                </Box>
              ))}
            </Flex>
          </Box>
        )}

        {error != null && (
          <Box
            bg={dsColors.errorBg}
            border="1px solid"
            borderColor={dsColors.errorBorder}
            borderRadius="lg"
            p={4}
          >
            <Text color={dsColors.errorText} fontSize="sm">
              {error}
            </Text>
          </Box>
        )}

        <Button
          {...dsPrimaryButton}
          size="lg"
          onClick={onStart}
          disabled={!isValid || starting}
          w="100%"
        >
          {starting ? "Starting..." : "Start Calibration"}
        </Button>

        {!isValid && parsed.length === 0 && (
          <Text color={dsColors.textSubtle} fontSize="xs" textAlign="center">
            Enter a valid chord progression to continue
          </Text>
        )}
      </Stack>
    </Box>
  );
}

export function SetupScreen() {
  const arrangement = useObservable(model.arrangementInfo);
  const error = useObservable(model.permissionError);

  const [previewing, setPreviewing] = useState(false);
  const [starting, setStarting] = useState(false);
  const previewSessionRef = useRef<PlaybackSession | null>(null);

  const meter = arrangement.input.meter;
  const meterLabel =
    METER_OPTIONS.find(
      (o) => o.value[0] === meter[0] && o.value[1] === meter[1],
    )?.label ?? "4/4";

  async function handlePreview() {
    const parsed = arrangement.parsedChords;
    const voicing = arrangement.harmonyVoicing;
    const tempo = arrangement.input.tempo;

    if (voicing == null || parsed.length === 0) return;

    let ctx = model.audioContext.get();
    if (ctx == null) {
      ctx = new AudioContext();
      model.audioContext.set(ctx);
    }
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    setPreviewing(true);
    const session = playHarmonyPreview(
      ctx,
      parsed,
      voicing.lines,
      arrangement.input.meter[0],
      tempo,
    );
    previewSessionRef.current = session;

    const durationMs = progressionDurationSec(parsed, tempo) * 1000 + 400;
    setTimeout(() => {
      if (previewSessionRef.current === session) {
        session.stop();
        previewSessionRef.current = null;
        setPreviewing(false);
      }
    }, durationMs);
  }

  function handleStopPreview() {
    stopAllPlayback();
    previewSessionRef.current = null;
    setPreviewing(false);
  }

  function handleMeterLabelChange(label: string) {
    const found = METER_OPTIONS.find((o) => o.label === label);
    if (found != null) {
      model.setArrangementInput({ meter: found.value });
    }
  }

  function handlePartCountChange(value: "2" | "4") {
    model.setArrangementInput({ totalParts: value === "2" ? 2 : 4 });
  }

  async function handleStart() {
    if (starting) return;
    setStarting(true);
    try {
      await acquirePermissionsAndStart();
    } finally {
      setStarting(false);
    }
  }

  const sharedCardProps = {
    arrangement,
    meterLabel,
    previewing,
    starting,
    error,
    onChordsChange: (value: string) =>
      model.setArrangementInput({ chordsInput: value }),
    onTempoChange: (value: number) =>
      model.setArrangementInput({ tempo: value }),
    onMeterLabelChange: handleMeterLabelChange,
    onRangeLowChange: (value: string) =>
      model.setArrangementInput({ vocalRangeLow: value }),
    onRangeHighChange: (value: string) =>
      model.setArrangementInput({ vocalRangeHigh: value }),
    onPartCountChange: handlePartCountChange,
    onPreview: handlePreview,
    onStopPreview: handleStopPreview,
    onStart: handleStart,
  };

  return (
    <Flex
      {...dsScreenShell}
      py={8}
    >
      <Box w="100%" maxW="560px">
        <SetupCard {...sharedCardProps} />
      </Box>
    </Flex>
  );
}
