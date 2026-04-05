import {
  Box,
  Button,
  Flex,
  Heading,
  NativeSelect,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { useObservable } from "../observable";
import { runClapCalibration } from "../recording/clapCalibration";
import { model } from "../state/model";

type CalibrationTimelineProps = {
  peaks: number[];
  durationSec: number;
  expectedTimesSec: number[];
  detectedTimesSec: number[];
};

function CalibrationTimeline({
  peaks,
  durationSec,
  expectedTimesSec,
  detectedTimesSec,
}: CalibrationTimelineProps) {
  const safeDurationSec = Math.max(0.01, durationSec);
  return (
    <Box>
      <Box
        position="relative"
        h="120px"
        bg="gray.950"
        border="1px solid"
        borderColor="gray.700"
        borderRadius="md"
        overflow="hidden"
      >
        <Flex align="end" h="100%" gap={0.5} px={1} pb={1}>
          {peaks.map((peak, i) => (
            <Box
              key={i}
              flex="1"
              bg="gray.600"
              borderRadius="1px"
              h={`${Math.max(3, Math.round(peak * 100))}%`}
              opacity={0.85}
            />
          ))}
        </Flex>

        {expectedTimesSec.map((sec, i) => {
          const leftPct = Math.max(0, Math.min(100, (sec / safeDurationSec) * 100));
          return (
            <Box
              key={`expected-${i}`}
              position="absolute"
              top={0}
              bottom={0}
              left={`${leftPct}%`}
              w="2px"
              bg="brand.400"
              opacity={0.75}
            />
          );
        })}

        {detectedTimesSec.map((sec, i) => {
          const leftPct = Math.max(0, Math.min(100, (sec / safeDurationSec) * 100));
          return (
            <Box
              key={`detected-${i}`}
              position="absolute"
              top={0}
              bottom={0}
              left={`${leftPct}%`}
              w="2px"
              bg="red.400"
              opacity={0.8}
            />
          );
        })}
      </Box>

      <Flex mt={2} justify="space-between" color="gray.500" fontSize="xs">
        <Text>0s</Text>
        <Text>{safeDurationSec.toFixed(2)}s</Text>
      </Flex>

      <Flex mt={2} gap={4} color="gray.400" fontSize="xs">
        <Flex align="center" gap={1.5}>
          <Box w={2} h={2} bg="brand.400" borderRadius="sm" />
          <Text>Expected beats</Text>
        </Flex>
        <Flex align="center" gap={1.5}>
          <Box w={2} h={2} bg="red.400" borderRadius="sm" />
          <Text>Detected claps</Text>
        </Flex>
      </Flex>
    </Box>
  );
}

export function ClapCalibrationScreen() {
  const stream = useObservable(model.mediaStream);
  const ctx = useObservable(model.audioContext);
  const tempo = useObservable(model.tempoInput);
  const result = useObservable(model.clapCalibrationResult);
  const confidence = useObservable(model.calibrationConfidence);
  const isCalibrated = useObservable(model.isCalibrated);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState("");

  const selectedMicLabel = useMemo(() => {
    if (selectedMicId === "") return "";
    return micDevices.find((d) => d.deviceId === selectedMicId)?.label ?? "";
  }, [micDevices, selectedMicId]);

  useEffect(() => {
    function enumerate() {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          setMicDevices(devices.filter((d) => d.kind === "audioinput"));
        })
        .catch(() => {});
    }
    enumerate();
    navigator.mediaDevices.addEventListener("devicechange", enumerate);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", enumerate);
    };
  }, []);

  useEffect(() => {
    if (stream == null) return;
    const track = stream.getAudioTracks()[0];
    if (track != null) {
      setSelectedMicId(track.getSettings().deviceId ?? "");
    }
  }, [stream]);

  async function handleMicChange(deviceId: string) {
    if (busy) return;
    if (stream == null || deviceId === selectedMicId) return;
    setError(null);
    try {
      const newAudioStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
      });
      const newAudioTrack = newAudioStream.getAudioTracks()[0];
      if (newAudioTrack == null) return;

      for (const track of stream.getAudioTracks()) {
        track.stop();
      }

      const nextStream = new MediaStream([
        ...stream.getVideoTracks(),
        newAudioTrack,
      ]);

      model.mediaStream.set(nextStream);
      setSelectedMicId(deviceId);
      model.clearClapCalibration();
    } catch (err) {
      console.error("Failed to switch microphone", err);
      setError("Could not switch microphone. Please try another input.");
    }
  }

  async function handleRunCalibration() {
    if (ctx == null || stream == null || selectedMicId === "") return;

    setBusy(true);
    setError(null);

    try {
      const nextResult = await runClapCalibration({
        ctx,
        stream,
        tempo,
      });
      model.setClapCalibrationResult(nextResult);
    } catch (err) {
      console.error("Calibration failed", err);
      setError("Calibration failed. Please try again in a quieter environment.");
      model.clearClapCalibration();
    } finally {
      setBusy(false);
    }
  }

  function handleContinue() {
    if (!isCalibrated) return;
    model.appScreen.set("recording");
  }

  function handleBack() {
    model.appScreen.set("setup");
  }

  return (
    <Flex minH="100vh" bg="gray.950" align="center" justify="center" px={4} py={8}>
      <Box w="100%" maxW="560px" bg="gray.900" borderRadius="2xl" p={6}>
        <Stack gap={5}>
          <Flex justify="space-between" align="center">
            <Button
              variant="ghost"
              size="sm"
              color="gray.500"
              onClick={handleBack}
              disabled={busy}
            >
              ← Back
            </Button>
            <Text color="gray.500" fontSize="sm">
              Calibration
            </Text>
          </Flex>

          <Box>
            <Heading size="lg" color="white">
              Clap Sync Calibration
            </Heading>
            <Text color="gray.400" fontSize="sm" mt={1}>
              Listen for the first bar, then clap on every beat of the second bar.
            </Text>
          </Box>

          <Box>
            <Text color="gray.400" fontSize="xs" mb={1.5}>
              Microphone
            </Text>
            <NativeSelect.Root
              size="sm"
              opacity={busy || micDevices.length === 0 ? 0.65 : 1}
              pointerEvents={busy || micDevices.length === 0 ? "none" : "auto"}
            >
              <NativeSelect.Field
                value={selectedMicId}
                onChange={(e) => handleMicChange(e.target.value)}
                bg="gray.800"
                border="1px solid"
                borderColor="gray.700"
                color="gray.200"
              >
                {micDevices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone ${i + 1}`}
                  </option>
                ))}
              </NativeSelect.Field>
            </NativeSelect.Root>
            <Text color="gray.500" fontSize="xs" mt={1}>
              This mic will be used for all takes in this session.
            </Text>
          </Box>

          {error != null && (
            <Box bg="red.950" border="1px solid" borderColor="red.700" borderRadius="md" p={3}>
              <Text color="red.300" fontSize="sm">
                {error}
              </Text>
            </Box>
          )}

          {result != null && (
            <Box bg="gray.800" borderRadius="xl" p={4}>
              <Flex justify="space-between" align="center" wrap="wrap" gap={2}>
                <Text color="gray.300" fontSize="sm" fontWeight="semibold">
                  Result
                </Text>
                <Text
                  color={confidence === "high" ? "green.300" : "orange.300"}
                  fontSize="xs"
                  fontWeight="bold"
                >
                  {confidence === "high" ? "HIGH CONFIDENCE" : "LOW CONFIDENCE"}
                </Text>
              </Flex>
              <Flex mt={2} gap={4} wrap="wrap">
                <Text color="gray.300" fontSize="sm">
                  Correction:{" "}
                  <Text as="span" color="white" fontWeight="semibold">
                    {Math.round(result.correctionSec * 1000)} ms
                  </Text>
                </Text>
                <Text color="gray.300" fontSize="sm">
                  Matched claps:{" "}
                  <Text as="span" color="white" fontWeight="semibold">
                    {result.matchedCount}/{result.expectedTimesSec.length}
                  </Text>
                </Text>
                <Text color="gray.300" fontSize="sm">
                  Timing score:{" "}
                  <Text as="span" color="white" fontWeight="semibold">
                    {result.timingScore}/100
                  </Text>
                </Text>
                <Text color="gray.300" fontSize="sm">
                  Mic:{" "}
                  <Text as="span" color="white" fontWeight="semibold">
                    {selectedMicLabel || "Selected input"}
                  </Text>
                </Text>
              </Flex>

              {confidence === "low" && (
                <Text mt={2} color="orange.300" fontSize="xs">
                  Confidence is low (often from uneven claps). You can continue, but re-running may improve sync.
                </Text>
              )}

              <Box mt={4}>
                <CalibrationTimeline
                  peaks={result.waveformPeaks}
                  durationSec={result.durationSec}
                  expectedTimesSec={result.expectedTimesSec}
                  detectedTimesSec={result.detectedTimesSec}
                />
              </Box>
            </Box>
          )}

          <Flex gap={3}>
            <Button
              flex={1}
              colorPalette="brand"
              size="lg"
              onClick={handleRunCalibration}
              disabled={busy || selectedMicId === ""}
              loading={busy}
              loadingText="Listening…"
            >
              {result == null ? "Start Calibration" : "Recalibrate"}
            </Button>
            <Button
              flex={1}
              size="lg"
              onClick={handleContinue}
              disabled={busy || !isCalibrated}
              colorPalette="green"
            >
              Continue to Recording
            </Button>
          </Flex>
        </Stack>
      </Box>
    </Flex>
  );
}
