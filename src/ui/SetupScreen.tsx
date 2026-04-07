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
  Textarea,
  Tooltip,
} from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { useObservable } from "../observable";
import { acquirePermissionsAndStart } from "../recording/permissions";
import { flattenArrangementLyrics } from "../state/arrangementModel";
import { triadPitchClassNames } from "../music/parse";
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
import { InfoIcon, PlayIcon, StopIcon } from "./icons";

const METER_OPTIONS: { label: string; value: Meter }[] = [
  { label: "4/4", value: [4, 4] },
  { label: "3/4", value: [3, 4] },
  { label: "6/8", value: [6, 8] },
];

const RANGE_OPTIONS = [
  { label: "Bass", low: "F2", high: "D4" },
  { label: "Baritone", low: "A2", high: "F4" },
  { label: "Tenor", low: "C3", high: "A4" },
  { label: "Alto", low: "A3", high: "D5" },
  { label: "Soprano", low: "D4", high: "G5" },
] as const;

type SetupCardProps = {
  arrangement: ArrangementInfo;
  meterLabel: string;
  tempoInputValue: string;
  previewing: boolean;
  starting: boolean;
  error: string | null;
  onChordsChange: (value: string) => void;
  onTempoInputChange: (value: string) => void;
  onTempoInputBlur: () => void;
  onMeterLabelChange: (label: string) => void;
  onRangePresetChange: (value: string) => void;
  onPartCountChange: (value: "2" | "4") => void;
  onPreview: () => void;
  onStopPreview: () => void;
  onStart: () => void;
};

function SetupCard({
  arrangement,
  meterLabel,
  tempoInputValue,
  previewing,
  starting,
  error,
  onChordsChange,
  onTempoInputChange,
  onTempoInputBlur,
  onMeterLabelChange,
  onRangePresetChange,
  onPartCountChange,
  onPreview,
  onStopPreview,
  onStart,
}: SetupCardProps) {
  const {
    input,
    measures,
    parsedChords: parsed,
    invalidChordIds,
    parseIssues,
    harmonyVoicing: voicing,
    isValid,
  } = arrangement;
  const {
    chordsInput,
    vocalRangeLow: rangeLow,
    vocalRangeHigh: rangeHigh,
    totalParts,
  } = input;
  const lyricsByChord = flattenArrangementLyrics(measures);
  const selectedRangeValue =
    RANGE_OPTIONS.find(
      (option) => option.low === rangeLow && option.high === rangeHigh,
    )?.label ?? "";

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
                    Spaces separate full-measure chords. Add `.` for half a
                    measure, `..` for a quarter measure, and place lyric lines
                    directly under chord lines in monospaced text.
                  </Tooltip.Content>
                </Tooltip.Positioner>
              </Tooltip.Root>
            </Flex>
            <Textarea
              rows={6}
              value={chordsInput}
              onChange={(e) => onChordsChange(e.target.value)}
              placeholder={"A Bm C\n\nA. Bm. C\n\nA          E    F#m     D      A    E\nWhere are we?   What the hell is going on?"}
              fontFamily="'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', monospace"
              lineHeight="1.45"
              spellCheck={false}
              resize="vertical"
              {...controlStyles}
            />
          </Box>

          <Grid templateColumns={{ base: "1fr", md: "1fr 1fr 1fr" }} gap={4}>
            <Field.Root>
              <Field.Label color={dsColors.text}>Tempo (BPM)</Field.Label>
              <Input
                type="number"
                value={tempoInputValue}
                min={40}
                max={240}
                onChange={(e) => onTempoInputChange(e.target.value)}
                onBlur={onTempoInputBlur}
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

            <Field.Root>
              <Field.Label color={dsColors.text}>Range</Field.Label>
              <NativeSelect.Root>
                <NativeSelect.Field
                  value={selectedRangeValue}
                  onChange={(e) => onRangePresetChange(e.target.value)}
                  {...controlStyles}
                >
                  <option value="" disabled>
                    Select range
                  </option>
                  {RANGE_OPTIONS.map((option) => (
                    <option key={option.label} value={option.label}>
                      {option.label}: {option.low}-{option.high}
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
                ARRANGEMENT - {measures.length} measure
                {measures.length !== 1 ? "s" : ""}, {parsed.length} chord
                {parsed.length !== 1 ? "s" : ""}
              </Text>
              <Button
                {...dsOutlineButton}
                size="xs"
                h={7}
                px={2.5}
                borderRadius="full"
                borderColor="transparent"
                color={previewing ? dsColors.accent : dsColors.textMuted}
                _hover={{
                  bg: dsColors.surfaceSubtle,
                  color: previewing ? dsColors.accent : dsColors.text,
                }}
                onClick={previewing ? onStopPreview : onPreview}
                aria-label={
                  previewing ? "Stop harmony preview" : "Play harmony preview"
                }
                lineHeight={0}
              >
                {previewing ? (
                  <StopIcon size={16} strokeWidth={2.1} />
                ) : (
                  <PlayIcon size={16} strokeWidth={2.1} />
                )}
              </Button>
            </Flex>
            <Stack gap={3}>
              <Flex gap={2} flexWrap="wrap">
                {parsed.map((c, i) => {
                  const annotation = voicing.annotations[i];
                  const voicingKind = annotation?.strategy ?? "closed";
                  const voicingLabel =
                    voicingKind === "closed" ? "Closed" : "Drop 2";
                  const degrees =
                    annotation?.chordTones ??
                    (c.quality === "minor" ? "R b3 5" : "R 3 5");
                  const notes = triadPitchClassNames(c);
                  const tooltipText = `${degrees} - ${notes}`;
                  return (
                    <Tooltip.Root
                      key={i}
                      openDelay={0}
                      closeDelay={250}
                      interactive
                      positioning={{ gutter: 8 }}
                    >
                      <Tooltip.Trigger asChild>
                        <Box
                          as="span"
                          bg={dsColors.surfaceSubtle}
                          borderRadius="full"
                          px={3}
                          py={1}
                          fontSize="sm"
                          color={dsColors.text}
                          display="inline-flex"
                          alignItems="baseline"
                          gap={2}
                          cursor="help"
                          userSelect="none"
                          border="1px solid"
                          borderColor="transparent"
                          _hover={{
                            borderColor: dsColors.borderMuted,
                            bg: dsColors.surfaceRaised,
                          }}
                          aria-label={tooltipText}
                        >
                          <Text as="span" fontWeight="semibold">
                            {c.root}
                            {c.quality === "minor" ? "m" : ""}
                          </Text>
                          <Text
                            as="span"
                            fontSize="xs"
                            color={dsColors.textMuted}
                            fontWeight="medium"
                            whiteSpace="nowrap"
                          >
                            {voicingLabel}
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
              {lyricsByChord.some((lyrics) => lyrics.trim().length > 0) && (
                <Flex gap={2} flexWrap="wrap">
                  {lyricsByChord.map((lyrics, index) => (
                    <Box
                      key={`lyrics-preview-${index}`}
                      px={3}
                      py={1}
                      borderRadius="full"
                      bg={dsColors.surface}
                      color={dsColors.textMuted}
                      fontSize="xs"
                      border="1px solid"
                      borderColor={dsColors.border}
                    >
                      {lyrics || " "}
                    </Box>
                  ))}
                </Flex>
              )}
            </Stack>
          </Box>
        )}

        {(invalidChordIds.length > 0 || parseIssues.length > 0) && (
          <Box
            bg={dsColors.errorBg}
            border="1px solid"
            borderColor={dsColors.errorBorder}
            borderRadius="lg"
            p={4}
          >
            <Text color={dsColors.errorText} fontSize="sm">
              {invalidChordIds.length > 0
                ? "Some chord tokens are unsupported right now. Use supported chord spellings before continuing."
                : parseIssues[0]}
            </Text>
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
          {starting ? "Starting..." : "Calibrate Microphone"}
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
  const arrangement = useObservable(model.derivedArrangementInfo);
  const error = useObservable(model.permissionError);

  const [previewing, setPreviewing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [tempoInputValue, setTempoInputValue] = useState(
    String(arrangement.input.tempo),
  );
  const previewSessionRef = useRef<PlaybackSession | null>(null);

  const meter = arrangement.input.meter;
  const meterLabel =
    METER_OPTIONS.find(
      (o) => o.value[0] === meter[0] && o.value[1] === meter[1],
    )?.label ?? "4/4";

  useEffect(() => {
    setTempoInputValue(String(arrangement.input.tempo));
  }, [arrangement.input.tempo]);

  async function handlePreview() {
    const parsed = arrangement.parsedChords;
    const voicing = arrangement.harmonyVoicing;
    const tempo = arrangement.input.tempo;

    if (voicing == null || parsed.length === 0) return;

    const ctx = await model.ensureAudioContext();
    if (ctx == null) return;

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

  function handleTempoInputChange(value: string) {
    setTempoInputValue(value);
    if (value.trim() === "") return;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return;
    model.setArrangementInput({ tempo: parsed });
  }

  function handleTempoInputBlur() {
    const raw = tempoInputValue.trim();
    if (raw === "") {
      setTempoInputValue(String(arrangement.input.tempo));
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      setTempoInputValue(String(arrangement.input.tempo));
      return;
    }
    const clamped = Math.min(240, Math.max(40, parsed));
    if (clamped !== arrangement.input.tempo) {
      model.setArrangementInput({ tempo: clamped });
    }
    setTempoInputValue(String(clamped));
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
    tempoInputValue,
    previewing,
    starting,
    error,
    onChordsChange: (value: string) =>
      model.setArrangementInput({ chordsInput: value }),
    onTempoInputChange: handleTempoInputChange,
    onTempoInputBlur: handleTempoInputBlur,
    onMeterLabelChange: handleMeterLabelChange,
    onRangePresetChange: (value: string) => {
      const range = RANGE_OPTIONS.find((option) => option.label === value);
      if (range == null) return;
      model.setArrangementInput({
        vocalRangeLow: range.low,
        vocalRangeHigh: range.high,
      });
    },
    onPartCountChange: handlePartCountChange,
    onPreview: handlePreview,
    onStopPreview: handleStopPreview,
    onStart: handleStart,
  };

  return (
    <Flex {...dsScreenShell} py={8}>
      <Box w="100%" maxW="560px">
        <SetupCard {...sharedCardProps} />
      </Box>
    </Flex>
  );
}
