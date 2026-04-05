import {
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useObservable } from "../observable";
import { model } from "../state/model";
import type { PartState } from "../state/model";
import { getPartLabel } from "../music/types";
import { recordTake } from "../recording/recorder";
import { startRecordingPlayback, stopAllPlayback } from "../music/playback";
import type { PlaybackSession } from "../music/playback";
import {
  createMonitorPlayer,
  decodeMonitorTracks,
} from "../audio/monitorPlayer";
import type { MonitorPlayer } from "../audio/monitorPlayer";
import { CameraPreview } from "./CameraPreview";
import { NoteDisplay } from "./NoteDisplay";

// "listening" = playing guide tones without recording (pre-roll practice)
type RecordPhase =
  | "pre-roll"
  | "listening"
  | "counting-in"
  | "recording"
  | "review";

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
            bg={
              isActive ? (isDownbeat ? "brand.400" : "brand.300") : "gray.700"
            }
            w={isDownbeat ? 4 : 3}
            h={isDownbeat ? 4 : 3}
            transition="background 0.06s"
            style={
              isActive
                ? { boxShadow: "0 0 8px var(--chakra-colors-brand-400)" }
                : undefined
            }
          />
        );
      })}
    </Flex>
  );
}

function MuteIcon({ muted }: { muted: boolean }) {
  if (muted) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  );
}

type RecordingListProps = {
  stream: MediaStream;
  totalParts: number;
  partIndex: number;
  states: PartState[];
  phase: RecordPhase;
  reviewUrl: string | null;
  reviewVideoRef: RefObject<HTMLVideoElement | null>;
  mutedParts: boolean[];
  onToggleMute: (index: number) => void;
};

function RecordingList({
  stream,
  totalParts,
  partIndex,
  states,
  phase,
  reviewUrl,
  reviewVideoRef,
  mutedParts,
  onToggleMute,
}: RecordingListProps) {
  return (
    <Box
      borderRadius="xl"
      overflowX="auto"
      overflowY="hidden"
      bg="black"
      px={2}
      py={3}
    >
      <Flex gap={2} w="max-content">
        {Array.from({ length: totalParts }).map((_, i) => {
          const isCurrent = i === partIndex;
          const state = states[i];
          const isKept = state != null && state.status === "kept";
          const isFuture = i > partIndex;

          return (
            <Stack
              key={i}
              gap={1.5}
              w="100px"
              flexShrink={0}
              opacity={isCurrent ? 1 : 0.32}
              transition="opacity 0.2s"
            >
              <Box
                position="relative"
                overflow="hidden"
                bg="gray.950"
                borderRadius="lg"
                aspectRatio="9/16"
                borderWidth={isCurrent ? "1px" : "0px"}
                borderColor={isCurrent ? "brand.500" : "transparent"}
              >
                {isCurrent && phase !== "review" && (
                  <CameraPreview
                    stream={stream}
                    borderRadius="none"
                    maxH="none"
                  />
                )}

                {isCurrent && phase === "review" && reviewUrl != null && (
                  <video
                    ref={reviewVideoRef}
                    playsInline
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                )}

                {isKept && state.status === "kept" && (
                  <KeptCell
                    url={state.url}
                    muted={mutedParts[i] ?? false}
                    onToggleMute={() => onToggleMute(i)}
                  />
                )}

                {isFuture && (
                  <Flex
                    w="100%"
                    h="100%"
                    align="center"
                    justify="center"
                    bg="gray.950"
                  >
                    <Text color="gray.700" fontSize="xs" fontWeight="semibold">
                      {getPartLabel(i, totalParts)}
                    </Text>
                  </Flex>
                )}
              </Box>

              <Text
                fontSize="10px"
                color={isCurrent ? "gray.200" : "gray.600"}
                textAlign="center"
                fontWeight="semibold"
              >
                {getPartLabel(i, totalParts)}
              </Text>
            </Stack>
          );
        })}
      </Flex>
    </Box>
  );
}

type KeptCellProps = {
  url: string;
  muted: boolean;
  onToggleMute: () => void;
};

function KeptCell({ url, muted, onToggleMute }: KeptCellProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (el == null) return;
    el.src = url;
    el.loop = true;
    el.muted = true; // visual-only; audio is handled via monitorRefs
    el.play().catch(() => {});
    return () => {
      el.pause();
      el.src = "";
    };
  }, [url]);

  return (
    <>
      <video
        ref={videoRef}
        playsInline
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
        }}
      />
      <Box
        as="button"
        position="absolute"
        bottom="6px"
        right="6px"
        bg={muted ? "blackAlpha.800" : "blackAlpha.600"}
        color={muted ? "gray.400" : "white"}
        borderRadius="full"
        p="5px"
        display="flex"
        alignItems="center"
        justifyContent="center"
        onClick={onToggleMute}
        style={{ cursor: "pointer", border: "none", lineHeight: 0 }}
        _hover={{ bg: "blackAlpha.900" }}
      >
        <MuteIcon muted={muted} />
      </Box>
    </>
  );
}

export function RecordingWizard() {
  const stream = useObservable(model.mediaStream);
  const partIndex = useObservable(model.currentPartIndex);
  const states = useObservable(model.partStates);
  const chords = useObservable(model.parsedChords);
  const voicing = useObservable(model.harmonyVoicing);
  const tempo = useObservable(model.tempoInput);
  const meter = useObservable(model.meterInput);
  const latencyCorrectionSec = useObservable(model.latencyCorrectionSec);

  const [phase, setPhase] = useState<RecordPhase>("pre-roll");
  const [activeChordIndex, setActiveChordIndex] = useState(0);
  const [countInBeat, setCountInBeat] = useState(0);
  const [currentAbsoluteBeat, setCurrentAbsoluteBeat] = useState(-1);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [guideToneEnabled, setGuideToneEnabled] = useState(true);
  const [mutedParts, setMutedParts] = useState<boolean[]>([]);

  const reviewVideoRef = useRef<HTMLVideoElement>(null);
  const monitorPlayerRef = useRef<MonitorPlayer | null>(null);
  const currentBlobRef = useRef<Blob | null>(null);
  const currentTrimOffsetRef = useRef<number>(0);
  const listenSessionRef = useRef<PlaybackSession | null>(null);
  // Incremented each time a new MonitorPlayer finishes decoding so the looping
  // effect can fire even though monitorPlayerRef is a ref (not state).
  const [monitorPlayerKey, setMonitorPlayerKey] = useState(0);

  const totalParts = states.length;
  const harmonyPartCount = Math.max(1, totalParts - 1);
  const isLastPart = partIndex === totalParts - 1;
  const isMelodyPart = partIndex >= harmonyPartCount;
  const beatsPerBar = meter[0];

  const harmonyLine =
    voicing != null && partIndex < harmonyPartCount
      ? (voicing.lines[partIndex] ?? null)
      : null;

  const ctx = useObservable(model.audioContext);

  // Rebuild the MonitorPlayer whenever we advance to a new part.
  // Decoding is async; we use a cancelled flag to discard stale results.
  useEffect(() => {
    monitorPlayerRef.current?.dispose();
    monitorPlayerRef.current = null;

    if (ctx == null || partIndex === 0) return;

    let cancelled = false;

    const blobs: Blob[] = [];
    const trimOffsets: number[] = [];
    const partIndices: number[] = [];

    for (let i = 0; i < partIndex; i++) {
      const state = states[i];
      if (state != null && state.status === "kept") {
        blobs.push(state.blob);
        trimOffsets.push(state.trimOffsetSec);
        partIndices.push(i);
      }
    }

    if (blobs.length === 0) return;

    void decodeMonitorTracks(ctx, blobs, trimOffsets).then((tracks) => {
      if (cancelled) return;
      const player = createMonitorPlayer(ctx, tracks);
      // Apply current mute state
      for (let j = 0; j < partIndices.length; j++) {
        const partI = partIndices[j];
        if (partI != null) {
          player.setMuted(j, mutedParts[partI] ?? false);
        }
      }
      monitorPlayerRef.current = player;
      setMonitorPlayerKey((k) => k + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [partIndex, states, ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync mute state onto the MonitorPlayer when mutedParts changes
  useEffect(() => {
    const player = monitorPlayerRef.current;
    if (player == null) return;
    let audioIdx = 0;
    for (let i = 0; i < partIndex; i++) {
      const state = states[i];
      if (state != null && state.status === "kept") {
        player.setMuted(audioIdx, mutedParts[i] ?? false);
        audioIdx++;
      }
    }
  }, [mutedParts, partIndex, states]);

  useEffect(() => {
    setMutedParts((prev) =>
      Array.from({ length: totalParts }, (_, i) => prev[i] ?? false),
    );
  }, [totalParts]);

  // Auto-play looping audio preview during pre-roll so kept parts are audible
  // while the user decides whether to listen or record. Fires when the phase
  // becomes "pre-roll" OR when a newly decoded MonitorPlayer becomes available
  // (monitorPlayerKey bumps on each successful decode).
  useEffect(() => {
    if (phase !== "pre-roll") return;
    const player = monitorPlayerRef.current;
    if (player == null) return;
    player.startLooping();
    return () => {
      player.stop();
    };
  }, [phase, monitorPlayerKey]);

  useEffect(() => {
    if (
      phase === "review" &&
      reviewVideoRef.current != null &&
      reviewUrl != null
    ) {
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
    setCurrentAbsoluteBeat(-1);
    setCountInBeat(0);
    currentBlobRef.current = null;
    currentTrimOffsetRef.current = 0;
  }, [partIndex]);

  // ─── Mute toggle ────────────────────────────────────────────────────────────

  function handleToggleMute(index: number) {
    setMutedParts((prev) => {
      const next = [...prev];
      next[index] = !(next[index] ?? false);
      return next;
    });
  }

  // ─── Listen (no recording) ──────────────────────────────────────────────────

  function handleListen() {
    // Stop preview loop and any ongoing listen session first
    monitorPlayerRef.current?.stop();
    listenSessionRef.current?.stop();

    setPhase("listening");
    setActiveChordIndex(0);
    setCurrentAbsoluteBeat(0);

    if (ctx == null) return;
    const session = startRecordingPlayback({
      ctx,
      chords,
      harmonyLine: guideToneEnabled ? harmonyLine : null,
      beatsPerBar,
      tempo,
      monitorPlayer: monitorPlayerRef.current,
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

    // Stop preview loop and any ongoing listen session before recording
    monitorPlayerRef.current?.stop();
    listenSessionRef.current?.stop();
    listenSessionRef.current = null;

    setPhase("counting-in");
    setActiveChordIndex(0);
    setCountInBeat(0);

    if (ctx == null) return;

    try {
      const result = await recordTake({
        ctx,
        stream,
        chords,
        harmonyLine: guideToneEnabled ? harmonyLine : null,
        beatsPerBar,
        tempo,
        latencyCorrectionSec,
        monitorPlayer: monitorPlayerRef.current,
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
      currentTrimOffsetRef.current = result.trimOffsetSec;
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

    model.keepRecordedTake({
      laneIndex: partIndex,
      blob,
      url,
      trimOffsetSec: currentTrimOffsetRef.current,
    });

    if (!isLastPart) {
      model.currentPartIndex.set(partIndex + 1);
    } else {
      model.appScreen.set("review");
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
      model.currentPartIndex.set(partIndex - 1);
    } else {
      model.appScreen.set("calibration");
    }
  }

  if (stream == null) return null;

  const partLabel = getPartLabel(partIndex, totalParts);
  const busy = phase === "counting-in" || phase === "recording";
  const isListening = phase === "listening";
  const activeMicLabel = stream.getAudioTracks()[0]?.label ?? "Selected microphone";

  return (
    <Flex
      minH="100vh"
      bg="gray.950"
      align="center"
      justify="center"
      px={4}
      py={6}
    >
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
              Part {partIndex + 1} of {totalParts}
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

          {/* Recording list */}
          <RecordingList
            stream={stream}
            totalParts={totalParts}
            partIndex={partIndex}
            states={states}
            phase={phase}
            reviewUrl={reviewUrl}
            reviewVideoRef={reviewVideoRef}
            mutedParts={mutedParts}
            onToggleMute={handleToggleMute}
          />

          {/* Note display */}
          {phase !== "review" && ctx != null && (
            <NoteDisplay
              ctx={ctx}
              chords={chords}
              harmonyLine={harmonyLine}
              activeChordIndex={activeChordIndex}
            />
          )}

          {/* Beat indicator — shown during count-in, listening, and recording */}
          {(phase === "counting-in" ||
            phase === "listening" ||
            phase === "recording") && (
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
              </Flex>
              <Text color="gray.600" fontSize="xs" textAlign="center">
                Mic locked from calibration: {activeMicLabel}
              </Text>

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
