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
import { useObservable } from "../observable";
import { acquirePermissionsAndStart } from "../recording/permissions";
import {
  chordsInput,
  harmonyVoicing,
  meterInput,
  parsedChords,
  permissionError,
  tempoInput,
  vocalRangeHigh,
  vocalRangeLow,
} from "../state/appState";
import type { Meter } from "../music/types";

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
  const chords = useObservable(chordsInput);
  const tempo = useObservable(tempoInput);
  const meter = useObservable(meterInput);
  const rangeLow = useObservable(vocalRangeLow);
  const rangeHigh = useObservable(vocalRangeHigh);
  const parsed = useObservable(parsedChords);
  const voicing = useObservable(harmonyVoicing);
  const error = useObservable(permissionError);

  const isValid = parsed.length > 0 && voicing != null;

  function handleMeterChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const found = METER_OPTIONS.find((o) => o.label === e.target.value);
    if (found != null) {
      meterInput.set(found.value);
    }
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
              4-part harmony video creator
            </Text>
          </Box>

          <Stack gap={4}>
            <Field.Root>
              <Field.Label color="gray.300">Chord Progression</Field.Label>
              <Input
                value={chords}
                onChange={(e) => chordsInput.set(e.target.value)}
                placeholder="A x2, F#m x2, D x2, E x2"
                bg="gray.800"
                border="1px solid"
                borderColor="gray.700"
                color="white"
                _placeholder={{ color: "gray.500" }}
                _focus={{ borderColor: "brand.400", boxShadow: "none" }}
              />
              <Field.HelperText color="gray.500" fontSize="xs">
                Chord name + optional repeat, e.g. "Am x2, G, F x2, E"
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
                    if (!isNaN(v)) tempoInput.set(v);
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
                    onChange={(e) => vocalRangeLow.set(e.target.value)}
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
                    onChange={(e) => vocalRangeHigh.set(e.target.value)}
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
            Start Recording
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
