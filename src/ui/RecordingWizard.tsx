import {
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useEffect, useRef } from "react";
import { useObservable } from "../observable";
import { flattenArrangementLyrics } from "../state/arrangementModel";
import { model } from "../state/model";
import { getPartLabel } from "../music/types";
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
import { RecordingBeatIndicator } from "./RecordingBeatIndicator";
import { RecordingMonitorPanel } from "./RecordingMonitorPanel";
import {
  type RecordPhase,
  selectMonitorTrackIndices,
  useRecordingTransportController,
} from "./RecordingTransportController";

type RecordingListProps = {
  stream: MediaStream;
  totalParts: number;
  partIndex: number;
  keptUrls: (string | null)[];
  phase: RecordPhase;
  reviewUrl: string | null;
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
                  <ReviewCell url={reviewUrl} />
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

type ReviewCellProps = {
  url: string;
};

function ReviewCell({ url }: ReviewCellProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (el == null) return;
    el.src = url;
    el.play().catch(() => {});
    return () => {
      el.pause();
      el.src = "";
    };
  }, [url]);

  return (
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
  const recordingTargetTrackId = useObservable(model.recordingTargetTrackId);
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
  const arrangementVoices =
    arrangementInfo.effectiveCustomArrangement?.voices ?? [];
  const orderedTrackIds = tracksDocument.trackOrder;
  const partIndex =
    recordingTargetTrackId == null
      ? -1
      : orderedTrackIds.indexOf(recordingTargetTrackId);
  const resolvedPartIndex = partIndex >= 0 ? partIndex : 0;
  const currentTrackId =
    partIndex >= 0 ? orderedTrackIds[partIndex] ?? null : null;
  const totalParts = tracksDocument.trackOrder.length;
  const harmonyPartCount = Math.max(1, totalParts - 1);
  const isMelodyPart = resolvedPartIndex >= harmonyPartCount;
  const beatsPerBar = arrangement.meter[0];
  const guideToneVolume = recordingMonitorPreferences.guideToneVolume;
  const beatVolume = recordingMonitorPreferences.beatVolume;
  const priorHarmonyLevel = recordingMonitorPreferences.priorHarmonyVolume;
  const currentTrackIdForMonitor =
    partIndex >= 0 ? orderedTrackIds[partIndex] ?? null : null;
  const hasRecordedMonitorTracks = selectMonitorTrackIndices(
    orderedTrackIds,
    currentTrackIdForMonitor,
  ).some((index) => {
    const trackId = orderedTrackIds[index];
    return (
      trackId != null &&
      model.tracksDocument.getPrimaryRecordingIdForTrack(trackId) != null
    );
  });
  const guideMonitorLabel = isMelodyPart
    ? "ARRANGEMENT GUIDE VOLUME"
    : "GUIDE TONES VOLUME";
  const guideToggleLabel = isMelodyPart ? "Arrangement guide" : "Guide tones";

  const { harmonyLine, arrangementVoice, countInCueMidi } =
    resolveRecordingHarmonyGuidance(
      voicing,
      arrangementVoices,
      resolvedPartIndex,
      totalParts,
    );

  const ctx = useObservable(model.audioContext);
  const hasExistingTake =
    currentTrackId != null
      ? model.tracksDocument.getPrimaryRecordingIdForTrack(currentTrackId) != null
      : false;
  const melodyBackingLines = isMelodyPart ? (voicing?.lines ?? []) : [];
  const backingArrangementVoices = isMelodyPart ? arrangementVoices : [];
  const keptUrls = orderedTrackIds.map((trackId) => {
    const recordingId =
      model.tracksDocument.getPrimaryRecordingIdForTrack(trackId);
    return recordingId != null ? model.getRecordingUrl(recordingId) : null;
  });
  const { controller, snapshot } = useRecordingTransportController({
    ctx,
    stream,
    partIndex: resolvedPartIndex,
    totalParts,
    orderedTrackIds,
    tracksRevision: tracksDocument,
    chords,
    harmonyLine,
    arrangementVoice,
    melodyBackingLines,
    backingArrangementVoices,
    countInCueMidi,
    beatsPerBar,
    tempo: arrangement.tempo,
    alignmentCorrectionSec,
    guideToneVolume,
    beatVolume,
    priorHarmonyLevel,
  });

  const phase = snapshot.phase;
  const activeChordIndex = snapshot.activeChordIndex;
  const countInBeat = snapshot.countInBeat;
  const currentAbsoluteBeat = snapshot.currentAbsoluteBeat;
  const reviewUrl = snapshot.reviewUrl;
  const reviewScores = snapshot.reviewScores;
  const guideToneEnabled = snapshot.guideToneEnabled;
  const mutedParts = snapshot.mutedParts;
  const referenceWaveform = snapshot.referenceWaveform;
  const effectiveGuideToneLevel = guideToneEnabled ? guideToneVolume : 0;

  useEffect(() => {
    if (currentTrackId != null) return;
    model.clearRecordingTarget();
    model.appScreen.set(
      Object.keys(tracksDocument.recordingsById).length > 0 ? "review" : "setup",
    );
  }, [currentTrackId, tracksDocument.recordingsById]);

  function handleKeep() {
    const pendingTake = controller.getPendingTake();
    const trackId = currentTrackId;
    if (pendingTake == null || trackId == null) return;

    model.keepRecordedTake({
      trackId,
      blob: pendingTake.blob,
      alignmentOffsetSec: pendingTake.alignmentOffsetSec,
    });
    model.appScreen.set("review");
  }

  function handleRedo() {
    controller.discardTake();
  }

  function handleBack() {
    controller.stopTransport();
    model.clearRecordingTarget();
    model.appScreen.set("review");
  }

  if (stream == null || currentTrackId == null || partIndex < 0) return null;

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
              ← Review
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
                : hasExistingTake
                  ? "Record a replacement take for this part"
                : !hasRecordedMonitorTracks
                  ? "Listen first, then record when ready"
                  : "Recorded tracks play quietly in your headphones"}
            </Text>
          </Box>

          {/* Note display */}
          {ctx != null && (
            <NoteDisplay
              ctx={ctx}
              chords={chords}
              lyricsByChord={lyricsByChord}
              harmonyLine={harmonyLine}
              referenceWaveform={referenceWaveform}
              stream={stream}
              activeChordIndex={activeChordIndex}
              currentAbsoluteBeat={currentAbsoluteBeat}
              beatsPerBar={beatsPerBar}
              tempo={arrangement.tempo}
              transportActive={transportActive}
              recordingActive={phase === "recording"}
              reviewScores={reviewScores}
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
            mutedParts={mutedParts}
            onToggleMute={(index) => controller.toggleMute(index)}
            hideCurrentKeptPreview
          />

          {phase !== "review" && (
            <RecordingMonitorPanel
              guideLabel={guideMonitorLabel}
              hasPriorHarmonyMonitorControl={hasRecordedMonitorTracks}
              guideToneVolume={guideToneVolume}
              effectiveGuideToneLevel={effectiveGuideToneLevel}
              beatVolume={beatVolume}
              priorHarmonyLevel={priorHarmonyLevel}
              onGuideToneVolumeChange={(next) => {
                model.setRecordingMonitorPreferences({ guideToneVolume: next });
                if (next > 0 && !guideToneEnabled) {
                  controller.setGuideToneEnabled(true);
                }
              }}
              onBeatVolumeChange={(next) => {
                model.setRecordingMonitorPreferences({ beatVolume: next });
              }}
              onPriorHarmonyVolumeChange={(next) => {
                model.setRecordingMonitorPreferences({
                  priorHarmonyVolume: next,
                });
              }}
            />
          )}

          {/* Beat indicator — shown during count-in, listening, and recording */}
          {(phase === "counting-in" ||
            phase === "listening" ||
            phase === "recording") && (
            <RecordingBeatIndicator
              phase={phase}
              activeBeatInBar={activeBeatInBar}
              beatIsDownbeat={beatIsDownbeat}
              beatLabel={beatLabel}
              onStopRecording={controller.stopRecording}
            />
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
                  onClick={
                    isListening
                      ? controller.stopListening
                      : () => {
                          controller.listen();
                        }
                  }
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
                  onClick={() => {
                    void controller.record();
                  }}
                  disabled={isListening}
                >
                  Record
                </Button>
              </Grid>
              {/* Per-source monitoring toggles */}
              <Flex gap={2} justify="center">
                <Button
                  variant="ghost"
                  size="xs"
                  color={
                    guideToneEnabled ? dsColors.accent : dsColors.textSubtle
                  }
                  onClick={controller.toggleGuideToneEnabled}
                >
                  {guideToggleLabel}: {guideToneEnabled ? "on" : "off"}
                </Button>
              </Flex>
            </Stack>
          )}

          {phase === "review" && (
            <Grid templateColumns="1fr 1fr" gap={3}>
              <Button {...dsOutlineButton} size="lg" onClick={handleRedo}>
                Redo
              </Button>
              <Button {...dsPrimaryButton} size="lg" onClick={handleKeep}>
                {hasExistingTake ? "Replace" : "Keep"}
              </Button>
            </Grid>
          )}
        </Stack>
      </Box>
    </Flex>
  );
}
