import {
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  NativeSelect,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { useObservable } from "../observable";
import {
  appScreen,
  currentPartIndex,
  harmonyVoicing,
  mediaStream,
  meterInput,
  parsedChords,
  partStates,
  tempoInput,
  updatePartState,
} from "../state/appState";
import type { PartIndex } from "../music/types";
import { PART_LABELS } from "../music/types";
import { recordTake } from "../recording/recorder";
import {
  startRecordingPlayback,
  stopAllPlayback,
} from "../music/playback";
import type { PlaybackSession } from "../music/playback";
import { CameraPreview } from "./CameraPreview";
import { NoteDisplay } from "./NoteDisplay";

const TOTAL_PARTS = 4;

// "listening" = playing guide tones without recording (pre-roll practice)
type RecordPhase = "pre-roll" | "listening" | "counting-in" | "recording" | "review";

type BeatDotsProps = {
  beatsPerBar: number;
  // 0-indexed active beat within the bar; -1 = none lit
  activeBeat: number;
};

function BeatDots({ beatsPerBar, activeBeat }: BeatDotsProps) {
  return (
    <Flex gap={2} justify="center">
      {Array.from({ length: beatsPerBar }).map((_, i) => {
        const isDownbeat = i === 0;
        const isActive = i === activeBeat;
        return (
          <Box
            key={i}
            borderRadius="full"
            bg={isActive ? (isDownbeat ? "brand.400" : "brand.300") : "gray.700"}
            w={isDownbeat ? 4 : 3}
            h={isDownbeat ? 4 : 3}
            transition="background 0.06s"
            style={isActive ? { boxShadow: "0 0 8px var(--chakra-colors-brand-400)" } : undefined}
          />
        );
      })}
    </Flex>
  );
}

export function RecordingWizard() {
  const stream = useObservable(mediaStream);
  const partIndex = useObservable(currentPartIndex);
  const states = useObservable(partStates);
  const chords = useObservable(parsedChords);
  const voicing = useObservable(harmonyVoicing);
  const tempo = useObservable(tempoInput);
  const meter = useObservable(meterInput);

  const [phase, setPhase] = useState<RecordPhase>("pre-roll");
  const [activeChordIndex, setActiveChordIndex] = useState(0);
  const [countInBeat, setCountInBeat] = useState(0);
  const [currentAbsoluteBeat, setCurrentAbsoluteBeat] = useState(-1);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [guideToneEnabled, setGuideToneEnabled] = useState(true);
  const [priorTakesEnabled, setPriorTakesEnabled] = useState(true);
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState("");

  const reviewVideoRef = useRef<HTMLVideoElement>(null);
  const monitorRefs = useRef<HTMLAudioElement[]>([]);
  const currentBlobRef = useRef<Blob | null>(null);
  const listenSessionRef = useRef<PlaybackSession | null>(null);

  const isLastPart = partIndex === TOTAL_PARTS - 1;
  const isMelodyPart = partIndex === 3;
  const beatsPerBar = meter[0];

  const harmonyLine =
    voicing != null && partIndex < 3
      ? voicing.lines[partIndex as 0 | 1 | 2]
      : null;

  // Rebuild monitor audio elements whenever we advance to a new part
  useEffect(() => {
    const elements: HTMLAudioElement[] = [];
    for (let i = 0; i < partIndex; i++) {
      const state = states[i];
      if (state != null && state.status === "kept") {
        const el = new Audio(state.url);
        el.preload = "auto";
        elements.push(el);
      }
    }
    monitorRefs.current = elements;
  }, [partIndex, states]);

  useEffect(() => {
    if (phase === "review" && reviewVideoRef.current != null && reviewUrl != null) {
      reviewVideoRef.current.src = reviewUrl;
      reviewVideoRef.current.play().catch(() => {});
    }
  }, [phase, reviewUrl]);

  // Enumerate audio input devices; re-enumerate when devices change (e.g.
  // headphones plugged in). Labels are only populated after permissions are
  // granted, which has already happened by the time we reach this screen.
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

  // Keep selectedMicId in sync with the active stream's audio track
  useEffect(() => {
    if (stream == null) return;
    const track = stream.getAudioTracks()[0];
    if (track != null) {
      setSelectedMicId(track.getSettings().deviceId ?? "");
    }
  }, [stream]);

  // Reset local phase state when partIndex changes (e.g. after keep)
  useEffect(() => {
    stopAllPlayback();
    listenSessionRef.current = null;
    setPhase("pre-roll");
    setReviewUrl(null);
    setActiveChordIndex(0);
    setCurrentAbsoluteBeat(-1);
    setCountInBeat(0);
    currentBlobRef.current = null;
  }, [partIndex]);

  // ─── Listen (no recording) ──────────────────────────────────────────────────

  function handleListen() {
    // Stop any ongoing listen session first
    listenSessionRef.current?.stop();

    setPhase("listening");
    setActiveChordIndex(0);
    setCurrentAbsoluteBeat(0);

    const session = startRecordingPlayback({
      chords,
      harmonyLine: guideToneEnabled ? harmonyLine : null,
      beatsPerBar,
      tempo,
      monitorElements: priorTakesEnabled ? monitorRefs.current : [],
      onBeat: (beat) => {
        setCurrentAbsoluteBeat(beat);
        let remaining = beat;
        for (let i = 0; i < chords.length; i++) {
          const chord = chords[i]!;
          if (remaining < chord.beats) {
            setActiveChordIndex(i);
            break;
          }
          remaining -= chord.beats;
        }
      },
      onChordChange: (i) => setActiveChordIndex(i),
    });

    listenSessionRef.current = session;

    // Auto-stop after progression ends
    const durationMs =
      chords.reduce((sum, c) => sum + c.beats, 0) * (60 / tempo) * 1000 + 400;

    setTimeout(() => {
      // Only stop if we're still in the listening phase from this call
      if (listenSessionRef.current === session) {
        session.stop();
        listenSessionRef.current = null;
        setPhase("pre-roll");
        setActiveChordIndex(0);
      }
    }, durationMs);
  }

  function handleStopListening() {
    listenSessionRef.current?.stop();
    listenSessionRef.current = null;
    setPhase("pre-roll");
    setActiveChordIndex(0);
    setCurrentAbsoluteBeat(-1);
  }

  // ─── Record ─────────────────────────────────────────────────────────────────

  async function handleRecord() {
    if (stream == null) return;

    // Stop any ongoing listen session before recording
    listenSessionRef.current?.stop();
    listenSessionRef.current = null;

    setPhase("counting-in");
    setActiveChordIndex(0);
    setCountInBeat(0);

    try {
      const result = await recordTake({
        stream,
        chords,
        harmonyLine: guideToneEnabled ? harmonyLine : null,
        beatsPerBar,
        tempo,
        monitorElements: priorTakesEnabled ? monitorRefs.current : [],
        callbacks: {
          onCountInBeat: (beat) => setCountInBeat(beat + 1),
          onRecordingStart: () => {
            setPhase("recording");
            setActiveChordIndex(0);
            setCurrentAbsoluteBeat(0);
          },
          onBeat: (beat) => {
            setCurrentAbsoluteBeat(beat);
            let remaining = beat;
            for (let i = 0; i < chords.length; i++) {
              const chord = chords[i]!;
              if (remaining < chord.beats) {
                setActiveChordIndex(i);
                break;
              }
              remaining -= chord.beats;
            }
          },
        },
      });

      currentBlobRef.current = result.blob;
      setReviewUrl(result.url);
      setPhase("review");
    } catch (err) {
      console.error("Recording failed", err);
      setPhase("pre-roll");
    }
  }

  function handleKeep() {
    const blob = currentBlobRef.current;
    const url = reviewUrl;
    if (blob == null || url == null) return;

    updatePartState(partIndex, { status: "kept", blob, url });

    if (!isLastPart) {
      currentPartIndex.set((partIndex + 1) as PartIndex);
    } else {
      appScreen.set("review");
    }
  }

  function handleRedo() {
    stopAllPlayback();
    setPhase("pre-roll");
    setReviewUrl(null);
    currentBlobRef.current = null;
  }

  function handleBack() {
    stopAllPlayback();
    listenSessionRef.current = null;
    if (partIndex > 0) {
      currentPartIndex.set((partIndex - 1) as PartIndex);
    } else {
      appScreen.set("setup");
    }
  }

  async function handleMicChange(deviceId: string) {
    if (stream == null || deviceId === selectedMicId) return;
    try {
      const newAudioStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
      });
      const newAudioTrack = newAudioStream.getAudioTracks()[0];
      if (newAudioTrack == null) return;
      for (const track of stream.getAudioTracks()) {
        track.stop();
      }
      const newStream = new MediaStream([
        ...stream.getVideoTracks(),
        newAudioTrack,
      ]);
      mediaStream.set(newStream);
      setSelectedMicId(deviceId);
    } catch (err) {
      console.error("Failed to switch microphone", err);
    }
  }

  if (stream == null) return null;

  const partLabel = PART_LABELS[partIndex as PartIndex] ?? `Part ${partIndex + 1}`;
  const busy = phase === "counting-in" || phase === "recording";
  const isListening = phase === "listening";

  return (
    <Flex minH="100vh" bg="gray.950" align="center" justify="center" px={4} py={6}>
      <Box w="100%" maxW="420px">
        <Stack gap={3}>
          {/* Header */}
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
            <Text color="gray.400" fontSize="sm">
              Part {partIndex + 1} of {TOTAL_PARTS}
            </Text>
          </Flex>

          {/* Title */}
          <Box>
            <Heading size="lg" color="white">
              {partLabel}
            </Heading>
            <Text color="gray.500" fontSize="sm" mt={1}>
              {isMelodyPart
                ? "Sing the melody — harmonies play quietly in your headphones"
                : partIndex === 0
                ? "Listen first, then record when ready"
                : "Prior parts play quietly in your headphones"}
            </Text>
          </Box>

          {/* Camera or review video */}
          {phase !== "review" ? (
            <CameraPreview stream={stream} />
          ) : (
            <Box
              borderRadius="xl"
              overflow="hidden"
              bg="black"
              w="min(100%, calc(52vh * 9 / 16))"
              aspectRatio="9/16"
              mx="auto"
            >
              <video
                ref={reviewVideoRef}
                controls
                playsInline
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                }}
              />
            </Box>
          )}

          {/* Note display */}
          {phase !== "review" && (
            <NoteDisplay
              chords={chords}
              harmonyLine={harmonyLine}
              activeChordIndex={activeChordIndex}
            />
          )}

          {/* Beat indicator — shown during count-in, listening, and recording */}
          {(phase === "counting-in" || phase === "listening" || phase === "recording") && (
            <Box bg="gray.900" borderRadius="xl" px={4} py={3}>
              <Flex align="center" justify="space-between" mb={2}>
                {phase === "counting-in" && (
                  <Text color="gray.400" fontSize="xs" fontWeight="semibold">
                    COUNT-IN
                  </Text>
                )}
                {phase === "listening" && (
                  <Text color="brand.400" fontSize="xs" fontWeight="semibold">
                    LISTENING
                  </Text>
                )}
                {phase === "recording" && (
                  <Flex align="center" gap={2}>
                    <Box
                      w={2}
                      h={2}
                      borderRadius="full"
                      bg="red.400"
                      style={{ animation: "recPulse 1s ease-in-out infinite" }}
                    />
                    <Text color="red.300" fontSize="xs" fontWeight="semibold">
                      RECORDING
                    </Text>
                  </Flex>
                )}
              </Flex>
              <BeatDots
                beatsPerBar={beatsPerBar}
                activeBeat={
                  phase === "counting-in"
                    ? countInBeat - 1
                    : currentAbsoluteBeat % beatsPerBar
                }
              />
            </Box>
          )}

          {/* Progress dots */}
          <Flex justify="center" gap={2}>
            {Array.from({ length: TOTAL_PARTS }).map((_, i) => {
              const s = states[i];
              const isKept = s != null && s.status === "kept";
              const isCurrent = i === partIndex;
              return (
                <Box
                  key={i}
                  w={2.5}
                  h={2.5}
                  borderRadius="full"
                  bg={isKept ? "brand.400" : isCurrent ? "white" : "gray.700"}
                />
              );
            })}
          </Flex>

          {/* Action buttons */}
          {(phase === "pre-roll" || isListening) && (
            <Stack gap={2}>
              <Grid templateColumns="1fr 1fr" gap={3}>
                <Button
                  variant="outline"
                  size="lg"
                  borderColor={isListening ? "brand.600" : "gray.600"}
                  color={isListening ? "brand.300" : "gray.300"}
                  onClick={isListening ? handleStopListening : handleListen}
                >
                  {isListening ? "Stop" : "Listen"}
                </Button>
                <Button
                  colorPalette="brand"
                  size="lg"
                  onClick={handleRecord}
                  disabled={isListening}
                >
                  Record
                </Button>
              </Grid>
              {/* Per-source monitoring toggles */}
              <Flex gap={2} justify="center">
                {!isMelodyPart && (
                  <Button
                    variant="ghost"
                    size="xs"
                    color={guideToneEnabled ? "brand.300" : "gray.600"}
                    onClick={() => setGuideToneEnabled((v) => !v)}
                  >
                    Guide tones: {guideToneEnabled ? "on" : "off"}
                  </Button>
                )}
                {partIndex > 0 && (
                  <Button
                    variant="ghost"
                    size="xs"
                    color={priorTakesEnabled ? "brand.300" : "gray.600"}
                    onClick={() => setPriorTakesEnabled((v) => !v)}
                  >
                    Prior takes: {priorTakesEnabled ? "on" : "off"}
                  </Button>
                )}
              </Flex>

              {/* Microphone selector */}
              {micDevices.length > 0 && (
                <Flex align="center" gap={2}>
                  <Text color="gray.500" fontSize="xs" flexShrink={0}>
                    Mic
                  </Text>
                  <NativeSelect.Root size="xs" flex={1} minW={0}>
                    <NativeSelect.Field
                      value={selectedMicId}
                      onChange={(e) => handleMicChange(e.target.value)}
                      bg="gray.800"
                      border="1px solid"
                      borderColor="gray.700"
                      color="gray.300"
                      fontSize="xs"
                    >
                      {micDevices.map((d, i) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Microphone ${i + 1}`}
                        </option>
                      ))}
                    </NativeSelect.Field>
                  </NativeSelect.Root>
                </Flex>
              )}
            </Stack>
          )}

          {phase === "review" && (
            <Grid templateColumns="1fr 1fr" gap={3}>
              <Button
                variant="outline"
                size="lg"
                onClick={handleRedo}
                borderColor="gray.600"
                color="gray.300"
              >
                Redo
              </Button>
              <Button colorPalette="brand" size="lg" onClick={handleKeep}>
                {isLastPart ? "Finish" : "Keep"}
              </Button>
            </Grid>
          )}
        </Stack>
      </Box>

      <style>{`
        @keyframes recPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.25; }
        }
      `}</style>
    </Flex>
  );
}
