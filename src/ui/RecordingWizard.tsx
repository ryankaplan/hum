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
import { flattenArrangementLyrics } from "../state/arrangementModel";
import { model } from "../state/model";
import { getPartLabel } from "../music/types";
import {
  isRecordingCancelledError,
  startRecordTake,
  type RecordingSession,
} from "../recording/recorder";
import {
  progressionDurationSec,
  startRecordingPlayback,
  stopAllPlayback,
} from "../music/playback";
import type { PlaybackSession } from "../music/playback";
import {
  createMonitorPlayer,
  decodeMonitorLanes,
} from "../audio/monitorPlayer";
import type {
  EncodedMonitorSegment,
  MonitorPlayer,
} from "../audio/monitorPlayer";
import { resolveRecordingHarmonyGuidance } from "../recording/harmonyGuidance";
import { CameraPreview } from "./CameraPreview";
import {
  dsColors,
  dsOutlineButton,
  dsPanel,
  dsPrimaryButton,
  dsScreenShell,
} from "./designSystem";
import { PlayIcon, StopIcon, VolumeOffIcon, VolumeOnIcon } from "./icons";
import { NoteDisplay } from "./NoteDisplay";
import {
  buildReferenceWaveform,
  type ReferenceWaveform,
} from "./waveformRendering";

// "listening" = playing guide tones without recording (pre-roll practice)
type RecordPhase =
  | "pre-roll"
  | "listening"
  | "counting-in"
  | "recording"
  | "review";

type RecordingListProps = {
  stream: MediaStream;
  totalParts: number;
  partIndex: number;
  keptUrls: (string | null)[];
  phase: RecordPhase;
  reviewUrl: string | null;
  reviewVideoRef: RefObject<HTMLVideoElement | null>;
  mutedParts: boolean[];
  onToggleMute: (index: number) => void;
  hideCurrentKeptPreview: boolean;
};

function RecordingList({
  stream,
  totalParts,
  partIndex,
  keptUrls,
  phase,
  reviewUrl,
  reviewVideoRef,
  mutedParts,
  onToggleMute,
  hideCurrentKeptPreview,
}: RecordingListProps) {
  return (
    <Box
      borderRadius="xl"
      overflowX="auto"
      overflowY="hidden"
      bg={dsColors.surfaceRaised}
      px={2}
      py={3}
    >
      <Flex gap={2} w="max-content">
        {Array.from({ length: totalParts }).map((_, i) => {
          const isCurrent = i === partIndex;
          const keptUrl = keptUrls[i] ?? null;
          const isKept = keptUrl != null;
          const isFuture = i > partIndex;
          const showKeptPreview =
            isKept && !(isCurrent && hideCurrentKeptPreview);

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
                bg={dsColors.mediaBg}
                borderRadius="lg"
                aspectRatio="9/16"
                borderWidth={isCurrent ? "1px" : "0px"}
                borderColor={isCurrent ? dsColors.accent : "transparent"}
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

                {showKeptPreview && keptUrl != null && (
                  <KeptCell
                    url={keptUrl}
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
                    bg={dsColors.mediaBg}
                  >
                    <Text
                      color={dsColors.textSubtle}
                      fontSize="xs"
                      fontWeight="semibold"
                    >
                      {getPartLabel(i, totalParts)}
                    </Text>
                  </Flex>
                )}
              </Box>

              <Text
                fontSize="10px"
                color={isCurrent ? dsColors.text : dsColors.textSubtle}
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
        bg={muted ? "rgba(12, 12, 14, 0.82)" : "rgba(12, 12, 14, 0.68)"}
        color={muted ? dsColors.textSubtle : dsColors.accentForeground}
        borderRadius="full"
        p="5px"
        display="flex"
        alignItems="center"
        justifyContent="center"
        onClick={onToggleMute}
        style={{ cursor: "pointer", border: "none", lineHeight: 0 }}
        _hover={{ bg: "rgba(12, 12, 14, 0.9)" }}
        aria-label={muted ? "Unmute track monitor" : "Mute track monitor"}
        title={muted ? "Unmute track monitor" : "Mute track monitor"}
      >
        {muted ? (
          <VolumeOffIcon size={16} strokeWidth={2} />
        ) : (
          <VolumeOnIcon size={16} strokeWidth={2} />
        )}
      </Box>
    </>
  );
}

export function RecordingWizard() {
  const stream = useObservable(model.mediaStream);
  const partIndex = useObservable(model.currentPartIndex);
  const returnToReviewAfterRecording = useObservable(
    model.returnToReviewAfterRecording,
  );
  const tracksDocument = useObservable(model.tracksDocument.document);
  const arrangement = useObservable(model.arrangementDocument);
  const arrangementInfo = useObservable(model.derivedArrangementInfo);
  const chords = arrangementInfo.parsedChords;
  const lyricsByChord = flattenArrangementLyrics(arrangementInfo.measures);
  const voicing = useObservable(model.effectiveHarmonyVoicing);
  const alignmentCorrectionSec = useObservable(model.latencyCorrectionSec);
  const recordingMonitorPreferences = useObservable(
    model.recordingMonitorPreferences,
  );

  const [phase, setPhase] = useState<RecordPhase>("pre-roll");
  const [activeChordIndex, setActiveChordIndex] = useState(0);
  const [countInBeat, setCountInBeat] = useState(0);
  const [currentAbsoluteBeat, setCurrentAbsoluteBeat] = useState(-1);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [guideToneEnabled, setGuideToneEnabled] = useState(true);
  const [mutedParts, setMutedParts] = useState<boolean[]>([]);
  const [referenceWaveform, setReferenceWaveform] =
    useState<ReferenceWaveform | null>(null);

  const reviewVideoRef = useRef<HTMLVideoElement>(null);
  const monitorPlayerRef = useRef<MonitorPlayer | null>(null);
  const beatGainRef = useRef<GainNode | null>(null);
  const guideToneGainRef = useRef<GainNode | null>(null);
  const monitorLanePartIndicesRef = useRef<number[]>([]);
  const currentBlobRef = useRef<Blob | null>(null);
  const currentAlignmentOffsetRef = useRef<number>(0);
  const listenSessionRef = useRef<PlaybackSession | null>(null);
  const recordSessionRef = useRef<RecordingSession | null>(null);
  // Incremented each time a new MonitorPlayer finishes decoding so the looping
  // effect can fire even though monitorPlayerRef is a ref (not state).
  const [monitorPlayerKey, setMonitorPlayerKey] = useState(0);

  const totalParts = tracksDocument.trackOrder.length;
  const harmonyPartCount = Math.max(1, totalParts - 1);
  const isLastPart = partIndex === totalParts - 1;
  const isMelodyPart = partIndex >= harmonyPartCount;
  const hasPriorHarmonyMonitorControl = partIndex > 0 && !isMelodyPart;
  const beatsPerBar = arrangement.meter[0];
  const arrangementDurationSec = progressionDurationSec(chords, arrangement.tempo);
  const guideToneVolume = recordingMonitorPreferences.guideToneVolume;
  const beatVolume = recordingMonitorPreferences.beatVolume;
  const priorHarmonyLevel = recordingMonitorPreferences.priorHarmonyVolume;
  const effectiveGuideToneLevel = guideToneEnabled ? guideToneVolume : 0;

  const { harmonyLine, countInCueMidi } = resolveRecordingHarmonyGuidance(
    voicing,
    partIndex,
    totalParts,
  );

  const ctx = useObservable(model.audioContext);
  const orderedTrackIds = tracksDocument.trackOrder;
  const currentTrackId = orderedTrackIds[partIndex] ?? null;
  const isRedoingCurrentPart = returnToReviewAfterRecording;
  const keptUrls = orderedTrackIds.map((trackId) => {
    const recordingId =
      model.tracksDocument.getPrimaryRecordingIdForTrack(trackId);
    return recordingId != null ? model.getRecordingUrl(recordingId) : null;
  });

  useEffect(() => {
    beatGainRef.current?.disconnect();
    guideToneGainRef.current?.disconnect();
    beatGainRef.current = null;
    guideToneGainRef.current = null;

    if (ctx == null) return;

    const beatGain = ctx.createGain();
    beatGain.gain.value = beatVolume;
    beatGain.connect(ctx.destination);
    beatGainRef.current = beatGain;

    const guideToneGain = ctx.createGain();
    guideToneGain.gain.value = effectiveGuideToneLevel;
    guideToneGain.connect(ctx.destination);
    guideToneGainRef.current = guideToneGain;

    return () => {
      beatGain.disconnect();
      guideToneGain.disconnect();
    };
  }, [ctx]);

  useEffect(() => {
    if (ctx == null) return;
    beatGainRef.current?.gain.setValueAtTime(beatVolume, ctx.currentTime);
  }, [beatVolume, ctx]);

  useEffect(() => {
    if (ctx == null) return;
    guideToneGainRef.current?.gain.setValueAtTime(
      effectiveGuideToneLevel,
      ctx.currentTime,
    );
  }, [effectiveGuideToneLevel, ctx]);

  // Rebuild the MonitorPlayer whenever we advance to a new part.
  // Decoding is async; we use a cancelled flag to discard stale results.
  useEffect(() => {
    monitorPlayerRef.current?.dispose();
    monitorPlayerRef.current = null;
    monitorLanePartIndicesRef.current = [];
    setReferenceWaveform(null);

    if (ctx == null || partIndex === 0) return;

    let cancelled = false;

    const encodedLanes: Array<{
      partIndex: number;
      segments: EncodedMonitorSegment[];
    }> = [];

    for (let i = 0; i < partIndex; i++) {
      const trackId = orderedTrackIds[i];
      if (trackId == null) continue;
      const clips = model.tracksDocument.getOrderedClipsForTrack(trackId);
      const segments: EncodedMonitorSegment[] = [];

      for (const clip of clips) {
        const blob = model.getRecordingBlob(clip.recordingId);
        if (blob == null) continue;
        segments.push({
          recordingId: clip.recordingId,
          blob,
          timelineStartSec: clip.timelineStartSec,
          sourceStartSec: clip.sourceStartSec,
          durationSec: clip.durationSec,
        });
      }

      if (segments.length === 0) continue;
      encodedLanes.push({ partIndex: i, segments });
    }

    if (encodedLanes.length === 0) return;

    void decodeMonitorLanes(ctx, encodedLanes).then((lanes) => {
      if (cancelled) return;

      monitorLanePartIndicesRef.current = encodedLanes.map((lane) => lane.partIndex);
      const referenceLane = lanes.find((lane) => lane.segments.length > 0) ?? null;
      setReferenceWaveform(
        referenceLane == null
          ? null
          : buildReferenceWaveform({
              segments: referenceLane.segments,
              maxDurationSec: arrangementDurationSec,
            }),
      );
      const player = createMonitorPlayer(ctx, lanes, arrangementDurationSec);
      // Apply current mute state
      for (let laneIndex = 0; laneIndex < encodedLanes.length; laneIndex++) {
        const lane = encodedLanes[laneIndex];
        if (lane == null) continue;
        player.setMuted(laneIndex, mutedParts[lane.partIndex] ?? false);
      }
      player.setLevel(priorHarmonyLevel);
      monitorPlayerRef.current = player;
      setMonitorPlayerKey((k) => k + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [arrangementDurationSec, ctx, orderedTrackIds, partIndex, tracksDocument]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync mute state onto the MonitorPlayer when mutedParts changes
  useEffect(() => {
    const player = monitorPlayerRef.current;
    if (player == null) return;
    const lanePartIndices = monitorLanePartIndicesRef.current;
    for (let laneIndex = 0; laneIndex < lanePartIndices.length; laneIndex++) {
      const partI = lanePartIndices[laneIndex];
      if (partI == null) continue;
      player.setMuted(laneIndex, mutedParts[partI] ?? false);
    }
  }, [mutedParts]);

  useEffect(() => {
    const player = monitorPlayerRef.current;
    if (player == null) return;
    player.setLevel(priorHarmonyLevel);
  }, [priorHarmonyLevel, monitorPlayerKey]);

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
    recordSessionRef.current?.stop();
    recordSessionRef.current = null;
    listenSessionRef.current = null;
    setPhase("pre-roll");
    setReviewUrl(null);
    setActiveChordIndex(0);
    setCurrentAbsoluteBeat(-1);
    setCountInBeat(0);
    currentBlobRef.current = null;
    currentAlignmentOffsetRef.current = 0;
  }, [partIndex]);

  // ─── Mute toggle ────────────────────────────────────────────────────────────

  function handleToggleMute(index: number) {
    setMutedParts((prev) => {
      const next = [...prev];
      next[index] = !(next[index] ?? false);
      return next;
    });
  }

  function stopTransportAudio() {
    listenSessionRef.current?.stop();
    listenSessionRef.current = null;
    recordSessionRef.current?.stop();
    recordSessionRef.current = null;
    monitorPlayerRef.current?.stop();
    stopAllPlayback();
  }

  // ─── Listen (no recording) ──────────────────────────────────────────────────

  function handleListen() {
    // Fully clear any previously scheduled transport audio before starting
    // a fresh listen pass so clicks cannot overlap.
    stopTransportAudio();

    setPhase("listening");
    setActiveChordIndex(0);
    setCurrentAbsoluteBeat(0);

    if (ctx == null) return;
    const session = startRecordingPlayback({
      ctx,
      chords,
      harmonyLine: guideToneEnabled ? harmonyLine : null,
      beatsPerBar,
      tempo: arrangement.tempo,
      beatLevel: 1,
      guideToneLevel: 1,
      beatDestination: beatGainRef.current,
      guideToneDestination: guideToneGainRef.current,
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
      chords.reduce((sum, c) => sum + c.beats, 0) *
        (60 / arrangement.tempo) *
        1000 +
      400;

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
    stopTransportAudio();
    setPhase("pre-roll");
    setActiveChordIndex(0);
    setCurrentAbsoluteBeat(-1);
  }

  // ─── Record ─────────────────────────────────────────────────────────────────

  async function handleRecord() {
    if (stream == null || recordSessionRef.current != null) return;

    // Fully clear any practice/listen playback so record starts from a clean
    // transport state with only one count-in/metronome.
    stopTransportAudio();

    setPhase("counting-in");
    setActiveChordIndex(0);
    setCountInBeat(0);

    if (ctx == null) return;

    let session: RecordingSession | null = null;
    try {
      session = startRecordTake({
        ctx,
        stream,
        chords,
        harmonyLine: guideToneEnabled ? harmonyLine : null,
        countInCueMidi,
        beatsPerBar,
        tempo: arrangement.tempo,
        latencyCorrectionSec: alignmentCorrectionSec,
        monitorPlayer: monitorPlayerRef.current,
        beatLevel: 1,
        guideToneLevel: 1,
        beatDestination: beatGainRef.current,
        guideToneDestination: guideToneGainRef.current,
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
      recordSessionRef.current = session;

      const result = await session.promise;

      currentBlobRef.current = result.blob;
      currentAlignmentOffsetRef.current = result.alignmentOffsetSec;
      setReviewUrl(result.url);
      setPhase("review");
    } catch (err) {
      if (isRecordingCancelledError(err)) {
        setPhase("pre-roll");
        setActiveChordIndex(0);
        setCurrentAbsoluteBeat(-1);
        setCountInBeat(0);
        return;
      }
      console.error("Recording failed", err);
      setPhase("pre-roll");
    } finally {
      if (session != null && recordSessionRef.current === session) {
        recordSessionRef.current = null;
      }
    }
  }

  function handleStopRecording() {
    const session = recordSessionRef.current;
    if (session == null) return;
    session.stop();
    recordSessionRef.current = null;
    setPhase("pre-roll");
    setActiveChordIndex(0);
    setCurrentAbsoluteBeat(-1);
    setCountInBeat(0);
  }

  function handleKeep() {
    const blob = currentBlobRef.current;
    const trackId = currentTrackId;
    if (blob == null || trackId == null) return;

    model.keepRecordedTake({
      trackId,
      blob,
      alignmentOffsetSec: currentAlignmentOffsetRef.current,
    });

    const nextIncompletePartIndex =
      model.getNextIncompletePartIndex(partIndex + 1) ??
      model.getNextIncompletePartIndex(0);

    if (nextIncompletePartIndex != null) {
      model.currentPartIndex.set(nextIncompletePartIndex);
      return;
    }

    model.appScreen.set("review");
  }

  function handleRedo() {
    stopTransportAudio();
    setPhase("pre-roll");
    setReviewUrl(null);
    currentBlobRef.current = null;
  }

  function handleBack() {
    stopTransportAudio();
    if (isRedoingCurrentPart) {
      model.cancelRedoPart();
      return;
    }
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
  const transportActive = phase === "listening" || phase === "recording";
  const activeBeatInBarRaw =
    phase === "counting-in"
      ? countInBeat - 1
      : currentAbsoluteBeat >= 0
        ? currentAbsoluteBeat % beatsPerBar
        : -1;
  const activeBeatInBar = activeBeatInBarRaw >= 0 ? activeBeatInBarRaw : -1;
  const beatLabel =
    activeBeatInBar >= 0
      ? `Beat ${activeBeatInBar + 1}/${beatsPerBar}`
      : `Beat -/${beatsPerBar}`;
  const beatIsDownbeat = activeBeatInBar === 0;
  const activeMicLabel =
    stream.getAudioTracks()[0]?.label ?? "Selected microphone";

  return (
    <Flex {...dsScreenShell}>
      <Box w="100%" maxW="420px" p={6} {...dsPanel}>
        <Stack gap={3}>
          {/* Header */}
          <Flex justify="space-between" align="center">
            <Button
              variant="ghost"
              size="sm"
              color={dsColors.textMuted}
              onClick={handleBack}
              disabled={busy}
            >
              {isRedoingCurrentPart ? "← Review" : "← Back"}
            </Button>
            <Text color={dsColors.textMuted} fontSize="sm">
              Part {partIndex + 1} of {totalParts}
            </Text>
          </Flex>

          {/* Title */}
          <Box>
            <Heading size="lg" color={dsColors.text}>
              {partLabel}
            </Heading>
            <Text color={dsColors.textMuted} fontSize="sm" mt={1}>
              {isMelodyPart
                ? "Sing the melody — harmonies play quietly in your headphones"
                : isRedoingCurrentPart
                  ? "Record a replacement take for this part"
                : partIndex === 0
                  ? "Listen first, then record when ready"
                  : "Prior parts play quietly in your headphones"}
            </Text>
          </Box>

          {/* Note display */}
          {phase !== "review" && ctx != null && (
            <NoteDisplay
              ctx={ctx}
              chords={chords}
              lyricsByChord={lyricsByChord}
              harmonyLine={harmonyLine}
              referenceWaveform={referenceWaveform}
              activeChordIndex={activeChordIndex}
              currentAbsoluteBeat={currentAbsoluteBeat}
              beatsPerBar={beatsPerBar}
              tempo={arrangement.tempo}
              transportActive={transportActive}
            />
          )}

          {/* Recording list / video */}
          <RecordingList
            stream={stream}
            totalParts={totalParts}
            partIndex={partIndex}
            keptUrls={keptUrls}
            phase={phase}
            reviewUrl={reviewUrl}
            reviewVideoRef={reviewVideoRef}
            mutedParts={mutedParts}
            onToggleMute={handleToggleMute}
            hideCurrentKeptPreview={isRedoingCurrentPart}
          />

          {phase !== "review" && (
            <Box bg={dsColors.surfaceRaised} borderRadius="xl" px={4} py={3}>
              <details>
                <summary style={{ cursor: "pointer" }}>
                  <Flex align="center" justify="space-between">
                    <Text
                      color={dsColors.textMuted}
                      fontSize="xs"
                      fontWeight="semibold"
                    >
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
                  {!isMelodyPart && (
                    <Box>
                      <Flex justify="space-between" align="center" mb={1.5}>
                        <Text
                          color={dsColors.textMuted}
                          fontSize="xs"
                          fontWeight="semibold"
                        >
                          GUIDE TONES VOLUME
                        </Text>
                        <Text
                          color={dsColors.text}
                          fontSize="xs"
                          fontWeight="semibold"
                        >
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
                          model.setRecordingMonitorPreferences({
                            guideToneVolume: Math.max(0, Math.min(1, next / 100)),
                          });
                          if (next > 0 && !guideToneEnabled) {
                            setGuideToneEnabled(true);
                          }
                        }}
                        style={{
                          width: "100%",
                          accentColor:
                            "var(--chakra-colors-appAccent, var(--chakra-colors-app-accent))",
                        }}
                      />
                    </Box>
                  )}

                  <Box>
                    <Flex justify="space-between" align="center" mb={1.5}>
                      <Text
                        color={dsColors.textMuted}
                        fontSize="xs"
                        fontWeight="semibold"
                      >
                        BEAT VOLUME
                      </Text>
                      <Text
                        color={dsColors.text}
                        fontSize="xs"
                        fontWeight="semibold"
                      >
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
                        model.setRecordingMonitorPreferences({
                          beatVolume: Math.max(0, Math.min(1, next / 100)),
                        });
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
                        <Text
                          color={dsColors.textMuted}
                          fontSize="xs"
                          fontWeight="semibold"
                        >
                          PREV HARMONIES VOLUME
                        </Text>
                        <Text
                          color={dsColors.text}
                          fontSize="xs"
                          fontWeight="semibold"
                        >
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
                          model.setRecordingMonitorPreferences({
                            priorHarmonyVolume: Math.max(0, Math.min(1, next / 100)),
                          });
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
          )}

          {/* Beat indicator — shown during count-in, listening, and recording */}
          {(phase === "counting-in" ||
            phase === "listening" ||
            phase === "recording") && (
            <Box bg={dsColors.surfaceRaised} borderRadius="xl" px={4} py={3}>
              <Flex align="center" justify="space-between" mb={2}>
                {phase === "counting-in" && (
                  <Text
                    color={dsColors.textMuted}
                    fontSize="xs"
                    fontWeight="semibold"
                  >
                    COUNT-IN
                  </Text>
                )}
                {phase === "listening" && (
                  <Text
                    color={dsColors.accent}
                    fontSize="xs"
                    fontWeight="semibold"
                  >
                    LISTENING
                  </Text>
                )}
                {phase === "recording" && (
                  <>
                    <Flex align="center" gap={2}>
                      <Box
                        w={2}
                        h={2}
                        borderRadius="full"
                        bg={dsColors.errorBorder}
                        animation="recPulse 1s ease-in-out infinite"
                      />
                      <Text
                        color={dsColors.errorText}
                        fontSize="xs"
                        fontWeight="semibold"
                      >
                        RECORDING
                      </Text>
                    </Flex>
                    <Button
                      variant="ghost"
                      size="xs"
                      minW="28px"
                      h="28px"
                      p={0}
                      borderRadius="full"
                      color={dsColors.errorText}
                      border="1px solid"
                      borderColor={dsColors.errorBorder}
                      onClick={handleStopRecording}
                      aria-label="Stop recording"
                      title="Stop recording"
                      lineHeight={0}
                    >
                      <StopIcon size={16} strokeWidth={2.1} />
                    </Button>
                  </>
                )}
              </Flex>
              <Flex align="center" justify="space-between">
                <Flex align="center" gap={2}>
                  <Box
                    key={`beat-pulse-${phase}-${activeBeatInBar}`}
                    w={beatIsDownbeat ? 2.5 : 2}
                    h={beatIsDownbeat ? 2.5 : 2}
                    borderRadius="full"
                    bg={beatIsDownbeat ? dsColors.accent : dsColors.accentHover}
                    opacity={activeBeatInBar >= 0 ? 1 : 0.45}
                    animation={
                      activeBeatInBar >= 0
                        ? "beatPulse 260ms ease-out 1"
                        : undefined
                    }
                    style={
                      beatIsDownbeat
                        ? {
                            boxShadow:
                              "0 0 6px color-mix(in srgb, var(--app-accent) 42%, transparent)",
                          }
                        : undefined
                    }
                  />
                  <Text
                    color={
                      beatIsDownbeat ? dsColors.accent : dsColors.textMuted
                    }
                    fontSize="xs"
                    fontWeight="semibold"
                  >
                    {beatLabel}
                  </Text>
                </Flex>
              </Flex>
            </Box>
          )}

          {/* Action buttons */}
          {(phase === "pre-roll" || isListening) && (
            <Stack gap={2}>
              <Grid templateColumns="1fr 1fr" gap={3}>
                <Button
                  {...dsOutlineButton}
                  size="lg"
                  borderColor={isListening ? dsColors.accent : dsColors.outline}
                  color={isListening ? dsColors.accent : dsColors.textMuted}
                  onClick={isListening ? handleStopListening : handleListen}
                  gap={2}
                >
                  {isListening ? (
                    <>
                      <StopIcon size={16} strokeWidth={2.1} />
                      Stop
                    </>
                  ) : (
                    <>
                      <PlayIcon size={16} strokeWidth={2} />
                      Listen
                    </>
                  )}
                </Button>
                <Button
                  {...dsPrimaryButton}
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
                    color={
                      guideToneEnabled ? dsColors.accent : dsColors.textSubtle
                    }
                    onClick={() => setGuideToneEnabled((v) => !v)}
                  >
                    Guide tones: {guideToneEnabled ? "on" : "off"}
                  </Button>
                )}
              </Flex>
            </Stack>
          )}

          {phase === "review" && (
            <Grid templateColumns="1fr 1fr" gap={3}>
              <Button {...dsOutlineButton} size="lg" onClick={handleRedo}>
                Redo
              </Button>
              <Button {...dsPrimaryButton} size="lg" onClick={handleKeep}>
                {isRedoingCurrentPart ? "Replace" : isLastPart ? "Finish" : "Keep"}
              </Button>
            </Grid>
          )}
        </Stack>
      </Box>
    </Flex>
  );
}
