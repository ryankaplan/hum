import {
  Box,
  Button,
  Flex,
  Grid,
  Heading,
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
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);

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

  // Reset local phase state when partIndex changes (e.g. after keep)
  useEffect(() => {
    stopAllPlayback();
    listenSessionRef.current = null;
    setPhase("pre-roll");
    setReviewUrl(null);
    setActiveChordIndex(0);
    currentBlobRef.current = null;
  }, [partIndex]);

  // ─── Listen (no recording) ──────────────────────────────────────────────────

  function handleListen() {
    // Stop any ongoing listen session first
    listenSessionRef.current?.stop();

    setPhase("listening");
    setActiveChordIndex(0);

    const session = startRecordingPlayback({
      chords,
      harmonyLine,
      beatsPerBar,
      tempo,
      monitorElements: monitorRefs.current,
      onBeat: (beat) => {
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
        harmonyLine,
        beatsPerBar,
        tempo,
        monitorElements: monitorRefs.current,
        callbacks: {
          onCountInBeat: (beat) => setCountInBeat(beat + 1),
          onRecordingStart: () => {
            setPhase("recording");
            setActiveChordIndex(0);
          },
          onBeat: (beat) => {
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
              w="100%"
              aspectRatio="9/16"
              maxH="52vh"
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

          {/* Count-in indicator */}
          {phase === "counting-in" && (
            <Box bg="gray.800" borderRadius="xl" p={3} textAlign="center">
              <Text color="brand.300" fontSize="5xl" fontWeight="bold" lineHeight="1">
                {Math.max(beatsPerBar - countInBeat, 1)}
              </Text>
              <Text color="gray.500" fontSize="xs" mt={1}>
                Count-in
              </Text>
            </Box>
          )}

          {/* Recording indicator */}
          {phase === "recording" && (
            <Flex align="center" gap={3} bg="red.900" borderRadius="xl" px={4} py={3}>
              <Box
                w={3}
                h={3}
                borderRadius="full"
                bg="red.400"
                style={{ animation: "recPulse 1s ease-in-out infinite" }}
              />
              <Text color="red.300" fontSize="sm" fontWeight="semibold">
                RECORDING
              </Text>
            </Flex>
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
