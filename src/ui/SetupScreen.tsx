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
import { model } from "../state/model";

const NOTE_OPTIONS = [
  "C2", "D2", "E2", "F2", "G2", "A2", "B2",
  "C3", "D3", "E3", "F3", "G3", "A3", "B3",
  "C4", "D4", "E4", "F4", "G4", "A4", "B4",
  "C5", "D5", "E5", "F5", "G5", "A5", "B5",
];

const METER_OPTIONS: { label: string; value: Meter }[] = [
  { label: "4/4", value: [4, 4] },
  { label: "3/4", value: [3, 4] },
  { label: "6/8", value: [6, 8] },
];

export function SetupScreen() {
  const arrangement = useObservable(model.arrangementInfo);
  const { input, parsedChords: parsed, harmonyVoicing: voicing, isValid } = arrangement;
  const {
    chordsInput: chords,
    tempo,
    meter,
    vocalRangeLow: rangeLow,
    vocalRangeHigh: rangeHigh,
    totalParts,
  } = input;
  const error = useObservable(model.permissionError);

  const [previewing, setPreviewing] = useState(false);
  const previewSessionRef = useRef<PlaybackSession | null>(null);

  async function handlePreview() {
    if (voicing == null || parsed.length === 0) return;
    // Create or resume the AudioContext — a user gesture is in scope here.
    let ctx = model.audioContext.get();
    if (ctx == null) {
      ctx = new AudioContext();
      model.audioContext.set(ctx);
    }
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    setPreviewing(true);
    const session = playHarmonyPreview(ctx, parsed, voicing.lines, meter[0], tempo);
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

  function handleMeterChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const found = METER_OPTIONS.find((o) => o.label === e.target.value);
    if (found != null) {
      model.setArrangementInput({ meter: found.value });
    }
  }

  function handlePartCountChange(e: React.ChangeEvent<HTMLSelectElement>) {
    model.setArrangementInput({ totalParts: e.target.value === "2" ? 2 : 4 });
  }

  const meterLabel =
    METER_OPTIONS.find(
      (o) => o.value[0] === meter[0] && o.value[1] === meter[1],
    )?.label ?? "4/4";

  return (
    <Flex
      minH="100vh"
      align="center"
      justify="center"
      bg="gray.950"
      px={4}
    >
      <Box
        w="100%"
        maxW="520px"
        bg="gray.900"
        borderRadius="2xl"
        p={8}
        boxShadow="xl"
      >
        <Stack gap={6}>
          <Box>
            <Heading size="2xl" color="brand.300" letterSpacing="tight">
              hum
            </Heading>
            <Text color="gray.400" mt={1} fontSize="sm">
              {totalParts}-part harmony video creator
            </Text>
          </Box>

          <Stack gap={4}>
            <Field.Root>
              <Field.Label color="gray.300">Chord Progression</Field.Label>
              <Input
                value={chords}
                onChange={(e) => model.setArrangementInput({ chordsInput: e.target.value })}
                placeholder="A A F#m F#m D D E E"
                bg="gray.800"
                border="1px solid"
                borderColor="gray.700"
                color="white"
                _placeholder={{ color: "gray.500" }}
                _focus={{ borderColor: "brand.400", boxShadow: "none" }}
              />
              <Field.HelperText color="gray.500" fontSize="xs">
                One chord per bar, space separated — repeat a chord to hold it: "Am Am G F F E"
              </Field.HelperText>
            </Field.Root>

            <Grid templateColumns="1fr 1fr" gap={4}>
              <Field.Root>
                <Field.Label color="gray.300">Tempo (BPM)</Field.Label>
                <Input
                  type="number"
                  value={tempo}
                  min={40}
                  max={240}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v)) model.setArrangementInput({ tempo: v });
                  }}
                  bg="gray.800"
                  border="1px solid"
                  borderColor="gray.700"
                  color="white"
                  _focus={{ borderColor: "brand.400", boxShadow: "none" }}
                />
              </Field.Root>

              <Field.Root>
                <Field.Label color="gray.300">Meter</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    value={meterLabel}
                    onChange={handleMeterChange}
                    bg="gray.800"
                    border="1px solid"
                    borderColor="gray.700"
                    color="white"
                    _focus={{ borderColor: "brand.400", boxShadow: "none" }}
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
                <Field.Label color="gray.300">Lowest Note</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    value={rangeLow}
                    onChange={(e) => model.setArrangementInput({ vocalRangeLow: e.target.value })}
                    bg="gray.800"
                    border="1px solid"
                    borderColor="gray.700"
                    color="white"
                    _focus={{ borderColor: "brand.400", boxShadow: "none" }}
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
                <Field.Label color="gray.300">Highest Note</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    value={rangeHigh}
                    onChange={(e) => model.setArrangementInput({ vocalRangeHigh: e.target.value })}
                    bg="gray.800"
                    border="1px solid"
                    borderColor="gray.700"
                    color="white"
                    _focus={{ borderColor: "brand.400", boxShadow: "none" }}
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
              <Field.Label color="gray.300">Arrangement</Field.Label>
              <NativeSelect.Root>
                <NativeSelect.Field
                  value={String(totalParts)}
                  onChange={handlePartCountChange}
                  bg="gray.800"
                  border="1px solid"
                  borderColor="gray.700"
                  color="white"
                  _focus={{ borderColor: "brand.400", boxShadow: "none" }}
                >
                  <option value="4">4-part (3 harmony + melody)</option>
                  <option value="2">2-part (harmony + melody)</option>
                </NativeSelect.Field>
              </NativeSelect.Root>
            </Field.Root>
          </Stack>

          {parsed.length > 0 && (
            <Box bg="gray.800" borderRadius="lg" p={4}>
              <Text color="gray.400" fontSize="xs" mb={2} fontWeight="semibold">
                PARSED — {parsed.length} chord{parsed.length !== 1 ? "s" : ""}
              </Text>
              <Flex gap={2} flexWrap="wrap">
                {parsed.map((c, i) => (
                  <Box
                    key={i}
                    bg="gray.700"
                    borderRadius="md"
                    px={3}
                    py={1}
                    fontSize="sm"
                    color="white"
                  >
                    {c.root}
                    {c.quality === "minor" ? "m" : ""}
                    <Text as="span" color="gray.400" fontSize="xs" ml={1}>
                      {c.beats}b
                    </Text>
                  </Box>
                ))}
              </Flex>
            </Box>
          )}

          {isValid && (
            <Button
              variant="outline"
              size="md"
              borderColor={previewing ? "brand.600" : "gray.600"}
              color={previewing ? "brand.300" : "gray.300"}
              onClick={previewing ? handleStopPreview : handlePreview}
              w="100%"
            >
              {previewing ? "Stop Preview" : "Preview Harmony"}
            </Button>
          )}

          {error != null && (
            <Box
              bg="red.900"
              border="1px solid"
              borderColor="red.700"
              borderRadius="lg"
              p={4}
            >
              <Text color="red.300" fontSize="sm">
                {error}
              </Text>
            </Box>
          )}

          <Button
            colorPalette="brand"
            size="lg"
            onClick={acquirePermissionsAndStart}
            disabled={!isValid}
            w="100%"
          >
            Start Calibration
          </Button>

          {!isValid && parsed.length === 0 && (
            <Text color="gray.600" fontSize="xs" textAlign="center">
              Enter a valid chord progression to continue
            </Text>
          )}
        </Stack>
      </Box>
    </Flex>
  );
}
