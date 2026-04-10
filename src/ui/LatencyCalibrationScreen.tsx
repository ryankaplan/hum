import {
  Box,
  Button,
  Flex,
  Heading,
  NativeSelect,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useObservable } from "../observable";
import {
  MANUAL_SHIFT_MAX_SEC,
  MANUAL_SHIFT_MIN_SEC,
  manualShiftToCorrectionSec,
  runBestEffortAutoCalibration,
  shouldWarnDraggedRightEdgeBeat,
  startCalibrationPreview,
  type CalibrationPreviewSession,
  type SpeechCalibrationCapture,
} from "../recording/latencyCalibration";
import {
  acquireConfiguredMediaStream,
  getStreamAudioDeviceId,
} from "../recording/mediaStream";
import { model } from "../state/model";
import {
  dsColors,
  dsErrorBanner,
  dsOutlineButton,
  dsPanel,
  dsPrimaryButton,
  dsScreenShell,
} from "./designSystem";

type CalibrationTimelineProps = {
  capture: SpeechCalibrationCapture;
  manualShiftSec: number;
  onShiftChange: (nextShiftSec: number) => void;
};

function CaptureBeatStrip({ activeBeat }: { activeBeat: number }) {
  return (
    <Flex gap={1.5} justify="center">
      {Array.from({ length: 8 }).map((_, i) => {
        const isTarget = i >= 4;
        const isActive = i === activeBeat;
        const dotColor = isActive
          ? isTarget
            ? dsColors.accent
            : dsColors.accentForeground
          : isTarget
            ? dsColors.accentHover
            : dsColors.borderMuted;
        return (
          <Box
            key={i}
            w={4}
            h={4}
            display="flex"
            alignItems="center"
            justifyContent="center"
            flexShrink={0}
          >
            <Box
              w={3}
              h={3}
              borderRadius="full"
              bg={dotColor}
              opacity={isActive ? 1 : 0.9}
              transform={isActive ? "scale(1.33)" : "scale(1)"}
              transition="transform 0.06s linear, background-color 0.06s linear, opacity 0.06s linear"
            />
          </Box>
        );
      })}
    </Flex>
  );
}

function CalibrationTimeline({
  capture,
  manualShiftSec,
  onShiftChange,
}: CalibrationTimelineProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [timelineWidthPx, setTimelineWidthPx] = useState(0);

  useEffect(() => {
    const el = timelineRef.current;
    if (el == null) return;
    const update = () => setTimelineWidthPx(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const maxBeatTime =
    capture.beatTimesSec[capture.beatTimesSec.length - 1] ?? 0;
  const visibleDurationSec = Math.max(
    capture.durationSec,
    maxBeatTime + capture.secPerBeat,
  );
  const pxPerSec =
    timelineWidthPx > 0
      ? timelineWidthPx / Math.max(0.01, visibleDurationSec)
      : 0;
  const waveformTranslatePx = manualShiftSec * pxPerSec;
  const targetBeats = useMemo(
    () => new Set(capture.targetBeatIndices),
    [capture.targetBeatIndices],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas == null || timelineWidthPx <= 0) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssWidth = timelineWidthPx;
    const cssHeight = 140;
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const ctx2d = canvas.getContext("2d");
    if (ctx2d == null) return;
    const ctx = ctx2d;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, cssWidth, cssHeight);
    const rootStyles = getComputedStyle(document.documentElement);
    const waveformColor =
      rootStyles.getPropertyValue("--chakra-colors-app-text-muted").trim() ||
      rootStyles.getPropertyValue("--chakra-colors-appTextMuted").trim() ||
      rootStyles.getPropertyValue("--chakra-colors-app-text").trim() ||
      rootStyles.getPropertyValue("--chakra-colors-appText").trim() ||
      "#5b5e74";
    ctx.fillStyle = waveformColor;
    ctx.globalAlpha = 0.9;

    const peaks = capture.waveformPeaks;
    if (peaks.length === 0) return;
    const peakW = cssWidth / peaks.length;
    const midY = cssHeight / 2;
    const maxHalfHeight = cssHeight * 0.48;

    for (let i = 0; i < peaks.length; i++) {
      const peak = peaks[i] ?? 0;
      const x = i * peakW + waveformTranslatePx;
      const h = Math.max(1, peak * maxHalfHeight);
      if (x + peakW < 0 || x > cssWidth) continue;
      ctx.fillRect(x, midY - h, Math.max(1, peakW), h * 2);
    }
    ctx.globalAlpha = 1;
  }, [capture.waveformPeaks, timelineWidthPx, waveformTranslatePx]);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (pxPerSec <= 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startShiftSec = manualShiftSec;

    const onMove = (ev: PointerEvent) => {
      const deltaPx = ev.clientX - startX;
      const deltaSec = deltaPx / pxPerSec;
      onShiftChange(
        clamp(
          startShiftSec + deltaSec,
          MANUAL_SHIFT_MIN_SEC,
          MANUAL_SHIFT_MAX_SEC,
        ),
      );
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <Box>
      <Box
        ref={timelineRef}
        position="relative"
        h="140px"
        bg={dsColors.surfaceSubtle}
        border="1px solid"
        borderColor={dsColors.borderMuted}
        borderRadius="md"
        overflow="hidden"
        onPointerDown={handlePointerDown}
        style={{ cursor: "grab" }}
      >
        {capture.beatTimesSec.map((sec, i) => {
          const leftPct = Math.max(
            0,
            Math.min(100, (sec / visibleDurationSec) * 100),
          );
          const target = targetBeats.has(i);
          const targetColor = "#00d8ff";
          return (
            <Box
              key={`beat-${i}`}
              position="absolute"
              top={0}
              bottom={0}
              left={`${leftPct}%`}
              w={target ? "3px" : "2px"}
              bg={target ? targetColor : dsColors.borderMuted}
              opacity={target ? 1 : 0.75}
              boxShadow={
                target
                  ? `0 0 0 1px rgba(255,255,255,0.2), 0 0 14px ${targetColor}`
                  : undefined
              }
              zIndex={3}
              pointerEvents="none"
            />
          );
        })}

        <Box
          position="absolute"
          inset={0}
          transition="opacity 0.1s linear"
          pointerEvents="none"
          zIndex={1}
        >
          <canvas ref={canvasRef} />
        </Box>
      </Box>

      <Flex mt={2} gap={4} color={dsColors.textMuted} fontSize="xs" wrap="wrap">
        <Flex align="center" gap={1.5}>
          <Box w={2} h={2} bg={dsColors.accent} borderRadius="sm" />
          <Text>Target beats</Text>
        </Flex>
        <Flex align="center" gap={1.5}>
          <Box w={2} h={2} bg={dsColors.textSubtle} borderRadius="sm" />
          <Text>Recorded speech waveform</Text>
        </Flex>
      </Flex>
    </Box>
  );
}

export function LatencyCalibrationScreen() {
  const stream = useObservable(model.mediaStream);
  const ctx = useObservable(model.audioContext);
  const arrangement = useObservable(model.arrangementDocument);
  const persistedSelectedMicId = useObservable(model.selectedMicId);
  const recordingTargetTrackId = useObservable(model.recordingTargetTrackId);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState("");
  const [capture, setCapture] = useState<SpeechCalibrationCapture | null>(null);
  const [manualShiftSec, setManualShiftSec] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [captureBeat, setCaptureBeat] = useState(-1);

  const previewSessionRef = useRef<CalibrationPreviewSession | null>(null);

  const selectedMicLabel = useMemo(() => {
    if (selectedMicId === "") return "";
    return micDevices.find((d) => d.deviceId === selectedMicId)?.label ?? "";
  }, [micDevices, selectedMicId]);

  const correctionSec = manualShiftToCorrectionSec(manualShiftSec);
  const launchedFromReview = recordingTargetTrackId != null;
  const rightEdgeWarning = useMemo(() => {
    if (capture == null) return false;
    return shouldWarnDraggedRightEdgeBeat(capture, manualShiftSec);
  }, [capture, manualShiftSec]);
  const canContinue = capture != null && !busy;

  useEffect(() => {
    const activeMicId = getStreamAudioDeviceId(stream);
    const nextSelectedMicId = activeMicId ?? persistedSelectedMicId ?? "";
    if (nextSelectedMicId !== "" && nextSelectedMicId !== selectedMicId) {
      setSelectedMicId(nextSelectedMicId);
    }
  }, [persistedSelectedMicId, selectedMicId, stream]);

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
    return () => {
      previewSessionRef.current?.stop();
      previewSessionRef.current = null;
    };
  }, []);

  function stopPreview() {
    previewSessionRef.current?.stop();
    previewSessionRef.current = null;
    setPreviewPlaying(false);
  }

  function startPreview() {
    if (capture == null || ctx == null) return;
    previewSessionRef.current?.stop();
    previewSessionRef.current = startCalibrationPreview({
      ctx,
      audioBuffer: capture.audioBuffer,
      sourceStartSec: capture.sourceStartSec,
      durationSec: capture.durationSec,
      tempo: arrangement.tempo,
      manualShiftSec,
      previewSpeechGain: capture.previewSpeechGain,
      previewClickGain: capture.previewClickGain,
    });
    setPreviewPlaying(true);
  }

  useEffect(() => {
    if (previewSessionRef.current == null) return;
    startPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrangement.tempo, manualShiftSec]);

  async function handleMicChange(deviceId: string) {
    if (busy) return;
    if (stream == null || deviceId === selectedMicId) return;
    setError(null);
    try {
      const newAudioStream = await acquireConfiguredMediaStream({
        audioDeviceId: deviceId,
        includeVideo: false,
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

      stopPreview();
      setCapture(null);
      setManualShiftSec(0);
      setCaptureBeat(-1);
      model.clearCalibration();
      model.mediaStream.set(nextStream);
      model.setSelectedMicId(getStreamAudioDeviceId(nextStream) ?? deviceId);
      setSelectedMicId(getStreamAudioDeviceId(nextStream) ?? deviceId);
    } catch (err) {
      console.error("Failed to switch microphone", err);
      setError("Could not switch microphone. Please try another input.");
    }
  }

  async function handleRunCalibration() {
    if (ctx == null || stream == null || selectedMicId === "") return;
    stopPreview();
    setBusy(true);
    setError(null);
    setCaptureBeat(-1);

    try {
      const { capture: nextCapture, estimate } =
        await runBestEffortAutoCalibration({
          ctx,
          stream,
          tempo: arrangement.tempo,
          onBeat: (beat) => setCaptureBeat(beat),
        });
      setCaptureBeat(-1);
      model.clearCalibration();

      setCapture(nextCapture);
      setManualShiftSec(
        clamp(
          estimate?.manualShiftSec ?? 0,
          MANUAL_SHIFT_MIN_SEC,
          MANUAL_SHIFT_MAX_SEC,
        ),
      );
    } catch (err) {
      console.error("Calibration capture failed", err);
      setError("Capture failed. Please try again in a quieter environment.");
      setCapture(null);
      setManualShiftSec(0);
      setCaptureBeat(-1);
      model.clearCalibration();
    } finally {
      setBusy(false);
      setCaptureBeat(-1);
    }
  }

  function handleTogglePreview() {
    if (capture == null || ctx == null) return;
    if (previewSessionRef.current != null) {
      stopPreview();
      return;
    }
    startPreview();
  }

  function handleContinue() {
    if (capture == null) return;
    stopPreview();
    model.setCalibrationOffset(correctionSec);
    model.appScreen.set(launchedFromReview ? "recording" : "review");
  }

  function handleBack() {
    stopPreview();
    if (launchedFromReview) {
      model.clearRecordingTarget();
      model.appScreen.set("review");
      return;
    }
    model.appScreen.set("setup");
  }

  return (
    <Flex {...dsScreenShell} py={8}>
      <Box w="100%" maxW="640px" p={6} {...dsPanel}>
        <Stack gap={5}>
          <Flex justify="space-between" align="center">
            <Button
              variant="ghost"
              size="sm"
              color={dsColors.textMuted}
              onClick={handleBack}
              disabled={busy}
            >
              {launchedFromReview ? "← Review" : "← Back"}
            </Button>
            <Text color={dsColors.textMuted} fontSize="sm">
              Calibration
            </Text>
          </Flex>

          <Box>
            <Heading size="lg" color={dsColors.text}>
              Speech Sync Calibration
            </Heading>
            <Text color={dsColors.textMuted} fontSize="sm" mt={1}>
              Choose your mic, then press Record. You'll hear 2 measures worth
              of beats: listen during measure 1, then count along to measure 2.
            </Text>
          </Box>

          <Box
            role="note"
            bg={dsColors.surfaceSubtle}
            border="1px solid"
            borderColor={dsColors.borderMuted}
            borderRadius="xl"
            px={4}
            py={3}
          >
            <Text
              color={dsColors.text}
              fontSize="xs"
              fontWeight="semibold"
              letterSpacing="0.02em"
              textTransform="uppercase"
              mb={2}
            >
              Don't use AirPods for your mic
            </Text>
            <Text
              color={dsColors.textMuted}
              fontSize="sm"
              lineHeight="tall"
              mt={2}
            >
              AirPods (and some other fancy microphones) have built-in
              processing that is optimized for speech. When you hold a note
              while singing, they start to think it's background noise and cut
              it out.
              <br /> <br />
              Using your airpods to listen while you sing into another mic is
              fine.
            </Text>
          </Box>

          <Box>
            <Text color={dsColors.textMuted} fontSize="xs" mb={1.5}>
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
                bg={dsColors.surfaceSubtle}
                border="1px solid"
                borderColor="transparent"
                color={dsColors.text}
                borderRadius="xl"
                _focus={{ borderColor: dsColors.focusRing }}
              >
                <option value="" disabled>
                  Select microphone...
                </option>
                {micDevices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone ${i + 1}`}
                  </option>
                ))}
              </NativeSelect.Field>
            </NativeSelect.Root>
          </Box>

          {error != null && (
            <Box p={3} {...dsErrorBanner}>
              <Text color={dsColors.errorText} fontSize="sm">
                {error}
              </Text>
            </Box>
          )}

          {busy && (
            <Box bg={dsColors.surfaceRaised} borderRadius="xl" p={4}>
              <Flex justify="space-between" align="center" mb={2}>
                <Text color={dsColors.text} fontSize="sm" fontWeight="semibold">
                  Capturing 2 bars
                </Text>
                <Text
                  color={
                    captureBeat >= 4 ? dsColors.accent : dsColors.textMuted
                  }
                  fontSize="xs"
                  fontWeight="bold"
                >
                  {captureBeat >= 4 ? "SPEAK (BAR 2)" : "LISTEN (BAR 1)"}
                </Text>
              </Flex>
              <CaptureBeatStrip activeBeat={captureBeat} />
            </Box>
          )}

          {capture != null && (
            <Box bg={dsColors.surfaceRaised} borderRadius="xl" p={4}>
              <Flex justify="space-between" align="center" wrap="wrap" gap={2}>
                <Text color={dsColors.text} fontSize="sm" fontWeight="semibold">
                  Align Your Speech
                </Text>
              </Flex>

              <Flex mt={2} gap={4} wrap="wrap">
                <Text color={dsColors.text} fontSize="sm">
                  Shift:{" "}
                  <Text as="span" color={dsColors.text} fontWeight="semibold">
                    {Math.round(manualShiftSec * 1000)} ms
                  </Text>
                </Text>
                <Text color={dsColors.text} fontSize="sm">
                  Applied correction:{" "}
                  <Text as="span" color={dsColors.text} fontWeight="semibold">
                    {Math.round(correctionSec * 1000)} ms
                  </Text>
                </Text>
                <Text color={dsColors.text} fontSize="sm">
                  Mic:{" "}
                  <Text as="span" color={dsColors.text} fontWeight="semibold">
                    {selectedMicLabel || "Selected input"}
                  </Text>
                </Text>
              </Flex>

              <Text mt={3} color={dsColors.textMuted} fontSize="xs">
                Drag waveform to align with beats, and then press play to
                preview.
              </Text>

              <Box mt={4}>
                <CalibrationTimeline
                  capture={capture}
                  manualShiftSec={manualShiftSec}
                  onShiftChange={setManualShiftSec}
                />
              </Box>

              {rightEdgeWarning && (
                <Box
                  mt={3}
                  px={3}
                  py={2.5}
                  borderRadius="lg"
                  bg={dsColors.surfaceSubtle}
                  border="1px solid"
                  borderColor={dsColors.warning}
                >
                  <Text color={dsColors.text} fontSize="sm" fontWeight="semibold">
                    That drag may have pushed a clear beat past the right edge.
                  </Text>
                  <Text color={dsColors.textMuted} fontSize="xs" mt={1}>
                    Try nudging the waveform back left so the last spoken beat
                    stays inside the bar.
                  </Text>
                </Box>
              )}
            </Box>
          )}

          <Flex gap={3} wrap="wrap">
            <Button
              {...dsPrimaryButton}
              flex={1}
              minW="220px"
              size="lg"
              onClick={handleRunCalibration}
              disabled={busy || selectedMicId === ""}
              loading={busy}
              loadingText="Recording…"
            >
              {capture == null ? "Record" : "Record Again"}
            </Button>
            <Button
              {...dsOutlineButton}
              flex={1}
              minW="220px"
              size="lg"
              variant={previewPlaying ? "solid" : "outline"}
              bg={previewPlaying ? dsColors.errorBg : undefined}
              color={previewPlaying ? dsColors.errorText : dsColors.textMuted}
              borderColor={
                previewPlaying ? dsColors.errorBorder : dsColors.outline
              }
              onClick={handleTogglePreview}
              disabled={busy || capture == null}
            >
              {previewPlaying ? "Stop Preview" : "Play Preview Loop"}
            </Button>
            <Button
              {...dsOutlineButton}
              flex={1}
              minW="220px"
              size="lg"
              onClick={handleContinue}
              disabled={!canContinue}
              color={dsColors.success}
              borderColor={dsColors.success}
            >
              Continue to Recording
            </Button>
          </Flex>
        </Stack>
      </Box>
    </Flex>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
