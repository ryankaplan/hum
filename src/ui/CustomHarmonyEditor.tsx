import { Box, Button, Flex, Heading, Stack, Text } from "@chakra-ui/react";
import {
  type ChangeEvent as ReactChangeEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  describeHarmonyNotesForChord,
  labelHarmonyNoteForChord,
} from "../music/harmonyShared";
import {
  playHarmonyPreview,
  playNotePreview,
  progressionDurationSec,
  stopAllPlayback,
} from "../music/playback";
import type { PlaybackSession } from "../music/playback";
import { formatChordSymbol } from "../music/parse";
import {
  getHarmonyLineNote,
  getPartLabel,
  midiToNoteName,
  noteNameToMidi,
  type Chord,
  type HarmonyLine,
  type MidiNote,
} from "../music/types";
import type { ArrangementInfo } from "../state/model";
import {
  dsColors,
  dsOutlineButton,
  dsPanel,
  dsPrimaryButton,
  dsScreenShell,
} from "./designSystem";

type Props = {
  arrangement: ArrangementInfo;
  draftLines: HarmonyLine[];
  ctx: AudioContext | null;
  onRequestAudioContext: () => Promise<AudioContext | null>;
  onCancel: () => void;
  onSave: (lines: HarmonyLine[]) => void;
};

type Selection = {
  chordIndex: number;
  voiceIndex: number;
};

type ChordSummary = {
  formula: string;
  noteNames: string[];
};

type NoteCluster = {
  chordIndex: number;
  midi: MidiNote;
  noteLabel: string;
  members: Array<{
    voiceIndex: number;
    color: string;
    label: string;
  }>;
};

type RestCluster = {
  chordIndex: number;
  members: Array<{
    voiceIndex: number;
    color: string;
    label: string;
  }>;
};

const CHORD_HEADER_HEIGHT_PX = 64;
const NOTE_ROW_HEIGHT_PX = 26;
const LYRIC_LANE_HEIGHT_PX = 40;
const REST_ROW_HEIGHT_PX = 34;
const NOTE_NAME_COL_WIDTH_PX = 84;
const NOTE_GRID_PAD_X_PX = 8;
const DEFAULT_BEAT_WIDTH_PX = 64;
const NOTE_PILL_HEIGHT_PX = 18;
const PITCH_PADDING = 1;
const VOICE_COLORS = ["#4d44e3", "#1f9d79", "#d06a32"] as const;

export function CustomHarmonyEditor({
  arrangement,
  draftLines,
  ctx,
  onRequestAudioContext,
  onCancel,
  onSave,
}: Props) {
  const harmonyPartCount = Math.max(1, arrangement.input.totalParts - 1);
  const [localLines, setLocalLines] = useState<HarmonyLine[]>(() =>
    draftLines.map((line) => [...line]),
  );
  const [selection, setSelection] = useState<Selection | null>(() =>
    getDefaultSelection(draftLines),
  );
  const [previewing, setPreviewing] = useState(false);
  const previewSessionRef = useRef<PlaybackSession | null>(null);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const beatsPerBar = Math.max(1, arrangement.input.meter[0]);
  const defaultMeasureWidthPx = beatsPerBar * DEFAULT_BEAT_WIDTH_PX;
  const minMeasureWidthPx = beatsPerBar * 10;
  const maxMeasureWidthPx = beatsPerBar * 96;
  const measureWidthStepPx = beatsPerBar * 4;
  const [measureWidthPx, setMeasureWidthPx] = useState(defaultMeasureWidthPx);
  const beatWidthPx = measureWidthPx / beatsPerBar;

  useEffect(() => {
    setLocalLines(draftLines.map((line) => [...line]));
  }, [draftLines]);

  useEffect(() => {
    setMeasureWidthPx(defaultMeasureWidthPx);
  }, [defaultMeasureWidthPx]);

  useEffect(() => {
    return () => {
      stopAllPlayback();
      previewSessionRef.current?.stop();
      previewSessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    setSelection((current: Selection | null) => {
      if (current == null) return getDefaultSelection(localLines);
      const line = localLines[current.voiceIndex];
      if (
        line == null ||
        current.chordIndex < 0 ||
        current.chordIndex >= line.length
      ) {
        return getDefaultSelection(localLines);
      }
      return current;
    });
  }, [localLines]);

  const range = useMemo(() => {
    try {
      return {
        low: noteNameToMidi(arrangement.input.vocalRangeLow),
        high: noteNameToMidi(arrangement.input.vocalRangeHigh),
      };
    } catch {
      return { low: 0, high: 127 };
    }
  }, [arrangement.input.vocalRangeHigh, arrangement.input.vocalRangeLow]);

  const chordSummaries = useMemo(
    () =>
      arrangement.parsedChords.map((chord, chordIndex) =>
        buildChordSummary(chord, localLines, chordIndex),
      ),
    [arrangement.parsedChords, localLines],
  );
  const chordPreviewItems = useMemo(
    () => arrangement.measures.flatMap((measure) => measure.chords),
    [arrangement.measures],
  );

  const visiblePitchBounds = useMemo(() => {
    let lowMidi = range.low;
    let highMidi = range.high;

    for (let voiceIndex = 0; voiceIndex < localLines.length; voiceIndex++) {
      const line = localLines[voiceIndex];
      if (line == null) continue;
      for (let chordIndex = 0; chordIndex < line.length; chordIndex++) {
        const midi = line[chordIndex];
        if (midi == null) continue;
        lowMidi = Math.min(lowMidi, midi);
        highMidi = Math.max(highMidi, midi);
      }
    }

    return {
      low: Math.max(0, lowMidi - PITCH_PADDING),
      high: Math.min(127, highMidi + PITCH_PADDING),
    };
  }, [localLines, range.high, range.low]);

  const lowMidi = visiblePitchBounds.low;
  const highMidi = visiblePitchBounds.high;
  const pitchRows = buildPitchRows(lowMidi, highMidi);

  const selectedMidi =
    selection == null
      ? null
      : getHarmonyLineNote(
          localLines[selection.voiceIndex],
          selection.chordIndex,
        );
  const selectedChord =
    selection == null
      ? null
      : (arrangement.parsedChords[selection.chordIndex] ?? null);
  const selectedChordSummary =
    selection == null ? null : (chordSummaries[selection.chordIndex] ?? null);
  const selectedCandidates =
    selection == null
      ? new Set<number>()
      : new Set(getEditableMidis(selectedMidi, range.low, range.high));

  const noteClusters = useMemo(
    () => groupNoteClusters(localLines, arrangement.parsedChords.length),
    [localLines, arrangement.parsedChords.length],
  );
  const restClusters = useMemo(
    () => groupRestClusters(localLines, arrangement.parsedChords.length),
    [localLines, arrangement.parsedChords.length],
  );

  const chordStarts = getChordStartBeats(arrangement.parsedChords);
  const totalBeats = arrangement.parsedChords.reduce(
    (sum, chord) => sum + chord.beats,
    0,
  );
  const gridWidthPx = Math.max(
    320,
    Math.ceil(totalBeats * beatWidthPx + NOTE_GRID_PAD_X_PX * 2),
  );
  const noteAreaHeightPx = pitchRows.length * NOTE_ROW_HEIGHT_PX;
  const totalHeightPx =
    CHORD_HEADER_HEIGHT_PX + noteAreaHeightPx + LYRIC_LANE_HEIGHT_PX;
  const scrollContentHeightPx = totalHeightPx + REST_ROW_HEIGHT_PX;

  useLayoutEffect(() => {
    const el = scrollViewportRef.current;
    if (el == null) return;
    el.scrollTop = 0;
  }, [highMidi, lowMidi, arrangement.parsedChords.length]);

  function focusViewport() {
    scrollViewportRef.current?.focus();
  }

  function handleMoveSelectedNote(nextMidi: MidiNote) {
    if (selection == null) return;
    if (!selectedCandidates.has(nextMidi)) return;
    const nextLines = localLines.map((line: HarmonyLine) => [...line]);
    nextLines[selection.voiceIndex]![selection.chordIndex] = nextMidi;
    setSelection({
      chordIndex: selection.chordIndex,
      voiceIndex: selection.voiceIndex,
    });
    if (ctx != null) {
      playNotePreview(ctx, nextMidi, 0.8);
    }
    setLocalLines(nextLines);
    focusViewport();
  }

  function handleRestSelectedNote() {
    if (selection == null) return;
    const nextLines = localLines.map((line: HarmonyLine) => [...line]);
    nextLines[selection.voiceIndex]![selection.chordIndex] = null;
    setSelection({
      chordIndex: selection.chordIndex,
      voiceIndex: selection.voiceIndex,
    });
    setLocalLines(nextLines);
    focusViewport();
  }

  function handleViewportKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      selection == null
    ) {
      return;
    }

    const direction =
      event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
    if (direction === 0) return;

    const nextMidi = getNextMidiForArrowMove(
      selectedMidi,
      direction,
      range.low,
      range.high,
    );
    if (nextMidi == null || nextMidi === selectedMidi) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    handleMoveSelectedNote(nextMidi);
  }

  async function handlePreview() {
    if (previewing) {
      stopAllPlayback();
      previewSessionRef.current?.stop();
      previewSessionRef.current = null;
      setPreviewing(false);
      return;
    }

    const nextCtx = ctx ?? (await onRequestAudioContext());
    if (nextCtx == null || arrangement.parsedChords.length === 0) return;

    stopAllPlayback();
    previewSessionRef.current?.stop();
    const session = playHarmonyPreview(
      nextCtx,
      arrangement.parsedChords,
      localLines,
      arrangement.input.meter[0],
      arrangement.input.tempo,
    );
    previewSessionRef.current = session;
    setPreviewing(true);

    const durationMs =
      progressionDurationSec(
        arrangement.parsedChords,
        arrangement.input.tempo,
      ) *
        1000 +
      400;

    window.setTimeout(() => {
      if (previewSessionRef.current === session) {
        session.stop();
        previewSessionRef.current = null;
        setPreviewing(false);
      }
    }, durationMs);
  }

  return (
    <Flex {...dsScreenShell} py={{ base: 4, md: 6 }} align="stretch">
      <Box
        w="100%"
        maxW="1360px"
        p={{ base: 4, md: 6 }}
        maxH="calc(100dvh - 2rem)"
        overflow="hidden"
        {...dsPanel}
      >
        <Stack gap={5}>
          <Flex
            justify="space-between"
            align={{ base: "flex-start", md: "center" }}
            gap={3}
            flexWrap="wrap"
          >
            <Box>
              <Text
                color={dsColors.textMuted}
                fontSize="xs"
                fontWeight="semibold"
                mb={1}
              >
                HARMONY EDITOR
              </Text>
              <Heading size="lg" color={dsColors.text}>
                Customize harmony
              </Heading>
              <Text color={dsColors.textMuted} fontSize="sm" mt={1}>
                Select a colored note, then click any pitch row to move it. Use
                the Rest footer to make the selected part stay silent for a
                chord.
              </Text>
            </Box>
            <Flex
              gap={3}
              align={{ base: "stretch", md: "center" }}
              flexWrap="wrap"
              justify="flex-end"
            >
              <Box minW={{ base: "100%", sm: "240px" }}>
                <Text
                  color={dsColors.textMuted}
                  fontSize="xs"
                  fontWeight="semibold"
                  mb={1}
                >
                  MEASURE WIDTH
                </Text>
                <Flex align="center" gap={3}>
                  <input
                    type="range"
                    min={minMeasureWidthPx}
                    max={maxMeasureWidthPx}
                    step={measureWidthStepPx}
                    value={measureWidthPx}
                    onChange={(event: ReactChangeEvent<HTMLInputElement>) =>
                      setMeasureWidthPx(Number(event.target.value))
                    }
                    style={{
                      flex: 1,
                      accentColor: "var(--app-accent)",
                      cursor: "pointer",
                    }}
                  />
                  <Text
                    color={dsColors.textMuted}
                    fontSize="xs"
                    fontWeight="semibold"
                    minW="52px"
                    textAlign="right"
                  >
                    {Math.round(measureWidthPx)} px
                  </Text>
                </Flex>
              </Box>
              <Flex gap={2} flexWrap="wrap">
                <Button {...dsOutlineButton} onClick={handlePreview}>
                  {previewing ? "Stop" : "Play"}
                </Button>
                <Button {...dsOutlineButton} onClick={onCancel}>
                  Cancel
                </Button>
                <Button
                  {...dsPrimaryButton}
                  onClick={() =>
                    onSave(localLines.map((line: HarmonyLine) => [...line]))
                  }
                >
                  Save custom harmony
                </Button>
              </Flex>
            </Flex>
          </Flex>

          <Box
            bg={dsColors.surfaceRaised}
            borderRadius="xl"
            px={4}
            py={3}
            border="1px solid"
            borderColor={dsColors.border}
          >
            <Flex
              justify="space-between"
              align={{ base: "flex-start", md: "center" }}
              gap={3}
              flexWrap="wrap"
            >
              <Box>
                <Text
                  color={dsColors.textMuted}
                  fontSize="xs"
                  fontWeight="semibold"
                >
                  SELECTED CHORD
                </Text>
                <Text color={dsColors.text} fontSize="lg" fontWeight="semibold">
                  {selection == null
                    ? "Pick a note to edit"
                    : formatSelectedChordLabel(
                        arrangement,
                        selection.chordIndex,
                      )}
                </Text>
                <Text color={dsColors.textMuted} fontSize="sm">
                  {selection == null
                    ? "Degree labels appear on the selected chord column."
                    : getChordSummaryText(selectedChordSummary)}
                </Text>
              </Box>
              {selection != null && (
                <Box minW={{ md: "220px" }}>
                  <Text
                    color={dsColors.textMuted}
                    fontSize="xs"
                    fontWeight="semibold"
                  >
                    SELECTED NOTE
                  </Text>
                  <Text
                    color={dsColors.text}
                    fontSize="sm"
                    fontWeight="semibold"
                  >
                    {getPartLabel(selection.voiceIndex, harmonyPartCount + 1)}:{" "}
                    {selectedMidi != null
                      ? midiToNoteName(selectedMidi)
                      : "Rest"}
                    {selectedMidi != null && selectedChord != null
                      ? ` • ${labelHarmonyNoteForChord(selectedChord, selectedMidi)}`
                      : ""}
                  </Text>
                  <Text color={dsColors.textMuted} fontSize="sm">
                    {chordPreviewItems[selection.chordIndex]?.lyrics ||
                      "No lyric on this chord"}
                  </Text>
                </Box>
              )}
            </Flex>
          </Box>

          <Box
            borderRadius="xl"
            overflow="hidden"
            border="1px solid"
            borderColor={dsColors.border}
            bg={dsColors.surfaceSubtle}
            minH={0}
          >
            <Box
              ref={scrollViewportRef}
              overflow="auto"
              maxH="calc(100dvh - 20rem)"
              tabIndex={0}
              onKeyDownCapture={handleViewportKeyDown}
            >
              <Flex
                align="stretch"
                w={`${NOTE_NAME_COL_WIDTH_PX + gridWidthPx}px`}
                minW="100%"
                h={`${scrollContentHeightPx}px`}
              >
                <Box
                  position="sticky"
                  left={0}
                  top={0}
                  zIndex={2}
                  flexShrink={0}
                  w={`${NOTE_NAME_COL_WIDTH_PX}px`}
                  borderRight="1px solid"
                  borderColor={dsColors.border}
                  bg={dsColors.surfaceRaised}
                >
                  <Box
                    h={`${CHORD_HEADER_HEIGHT_PX}px`}
                    borderBottom="1px solid"
                    borderColor={dsColors.border}
                    bg={dsColors.surfaceRaised}
                  />
                  {pitchRows.map((midi) => (
                    <Flex
                      key={`pitch-${midi}`}
                      h={`${NOTE_ROW_HEIGHT_PX}px`}
                      px={3}
                      align="center"
                      justify="flex-end"
                      borderBottom="1px solid"
                      borderColor="color-mix(in srgb, var(--app-border-muted) 20%, transparent)"
                    >
                      <Text
                        color={dsColors.textMuted}
                        fontSize="xs"
                        fontWeight="medium"
                      >
                        {midiToNoteName(midi)}
                      </Text>
                    </Flex>
                  ))}
                  <Flex
                    h={`${LYRIC_LANE_HEIGHT_PX}px`}
                    px={3}
                    align="center"
                    justify="flex-end"
                    borderTop="1px solid"
                    borderColor={dsColors.border}
                  >
                    <Text
                      color={dsColors.textMuted}
                      fontSize="xs"
                      fontWeight="semibold"
                    >
                      Lyrics
                    </Text>
                  </Flex>
                  <Flex
                    position="sticky"
                    bottom={0}
                    zIndex={3}
                    h={`${REST_ROW_HEIGHT_PX}px`}
                    px={3}
                    align="center"
                    justify="flex-end"
                    borderTop="1px solid"
                    borderColor={dsColors.border}
                    bg={dsColors.surfaceRaised}
                  >
                    <Text
                      color={dsColors.textMuted}
                      fontSize="xs"
                      fontWeight="semibold"
                    >
                      Rest
                    </Text>
                  </Flex>
                </Box>

                <Box flex="1" className="record-note-timeline">
                  <Box
                    position="relative"
                    w={`${gridWidthPx}px`}
                    h={`${totalHeightPx}px`}
                  >
                    {arrangement.parsedChords.map((chord, chordIndex) => {
                      const x =
                        NOTE_GRID_PAD_X_PX +
                        chordStarts[chordIndex]! * beatWidthPx;
                      const width = Math.max(44, chord.beats * beatWidthPx);
                      const isSelectedChord =
                        selection?.chordIndex === chordIndex;
                      const previewItem = chordPreviewItems[chordIndex];

                      return (
                        <Box
                          key={`chord-col-${chordIndex}`}
                          position="absolute"
                          top={0}
                          left={`${x}px`}
                          w={`${width}px`}
                          h={`${totalHeightPx}px`}
                          bg={
                            isSelectedChord
                              ? "color-mix(in srgb, var(--app-accent) 10%, transparent)"
                              : "transparent"
                          }
                        >
                          <Box
                            h={`${CHORD_HEADER_HEIGHT_PX}px`}
                            px={2}
                            py={1.5}
                            borderBottom="1px solid"
                            borderColor={dsColors.border}
                          >
                            <Text
                              color={dsColors.text}
                              fontSize="sm"
                              fontWeight="semibold"
                              whiteSpace="normal"
                              lineHeight="1.15"
                              overflow="hidden"
                            >
                              {previewItem?.chordText ??
                                formatChordSymbol(chord)}
                            </Text>
                            <Text
                              color={dsColors.textMuted}
                              fontSize="10px"
                              mt={0.5}
                              whiteSpace="normal"
                              lineHeight="1.15"
                              overflow="hidden"
                            >
                              {chordSummaries[chordIndex]?.formula}
                            </Text>
                          </Box>
                        </Box>
                      );
                    })}

                    {pitchRows.map((midi, rowIndex) => {
                      const y =
                        CHORD_HEADER_HEIGHT_PX + rowIndex * NOTE_ROW_HEIGHT_PX;
                      return (
                        <Box
                          key={`pitch-line-${midi}`}
                          position="absolute"
                          left={0}
                          right={0}
                          top={`${y}px`}
                          h={`${NOTE_ROW_HEIGHT_PX}px`}
                          borderBottom="1px solid"
                          borderColor="color-mix(in srgb, var(--app-border-muted) 20%, transparent)"
                        />
                      );
                    })}

                    {Array.from({ length: Math.ceil(totalBeats) + 1 }).map(
                      (_, beat) => (
                        <Box
                          key={`beat-guide-${beat}`}
                          position="absolute"
                          top={0}
                          bottom={0}
                          left={`${NOTE_GRID_PAD_X_PX + beat * beatWidthPx}px`}
                          w="1px"
                          bg="color-mix(in srgb, var(--app-border-muted) 16%, transparent)"
                        />
                      ),
                    )}

                    {arrangement.parsedChords.map((chord, chordIndex) => {
                      const x =
                        NOTE_GRID_PAD_X_PX +
                        chordStarts[chordIndex]! * beatWidthPx;
                      const width = Math.max(44, chord.beats * beatWidthPx);
                      return pitchRows.map((midi, rowIndex) => {
                        const y =
                          CHORD_HEADER_HEIGHT_PX +
                          rowIndex * NOTE_ROW_HEIGHT_PX;
                        const isCandidate =
                          selection?.chordIndex === chordIndex &&
                          selectedCandidates.has(midi);
                        const degreeLabel =
                          selection?.chordIndex === chordIndex
                            ? labelHarmonyNoteForChord(chord, midi)
                            : null;

                        return (
                          <Box
                            key={`cell-${chordIndex}-${midi}`}
                            as="button"
                            position="absolute"
                            top={`${y}px`}
                            left={`${x}px`}
                            w={`${width}px`}
                            h={`${NOTE_ROW_HEIGHT_PX}px`}
                            px={2}
                            bg={
                              isCandidate
                                ? "color-mix(in srgb, var(--app-accent) 10%, transparent)"
                                : "transparent"
                            }
                            onClick={() => handleMoveSelectedNote(midi)}
                            cursor={isCandidate ? "pointer" : "default"}
                            pointerEvents={isCandidate ? "auto" : "none"}
                            style={{ border: "none" }}
                          >
                            {degreeLabel != null && (
                              <Text
                                color={
                                  isCandidate
                                    ? dsColors.accent
                                    : dsColors.textSubtle
                                }
                                fontSize="10px"
                                fontWeight="bold"
                                position="absolute"
                                right="6px"
                                top="50%"
                                transform="translateY(-50%)"
                              >
                                {degreeLabel}
                              </Text>
                            )}
                          </Box>
                        );
                      });
                    })}

                    {noteClusters.map((cluster: NoteCluster) => {
                      const chord =
                        arrangement.parsedChords[cluster.chordIndex];
                      if (chord == null) return null;
                      const x =
                        NOTE_GRID_PAD_X_PX +
                        chordStarts[cluster.chordIndex]! * beatWidthPx +
                        6;
                      const width = Math.max(
                        30,
                        chord.beats * beatWidthPx - 12,
                      );
                      const rowIndex = highMidi - cluster.midi;
                      const baseY =
                        CHORD_HEADER_HEIGHT_PX +
                        rowIndex * NOTE_ROW_HEIGHT_PX +
                        Math.max(
                          3,
                          (NOTE_ROW_HEIGHT_PX - NOTE_PILL_HEIGHT_PX) / 2,
                        );

                      return (
                        <Box
                          key={`note-cluster-${cluster.chordIndex}-${cluster.midi}`}
                          position="absolute"
                          left={`${x}px`}
                          top={`${baseY}px`}
                          w={`${width}px`}
                          h={`${NOTE_PILL_HEIGHT_PX + Math.max(0, cluster.members.length - 1) * 7}px`}
                          pointerEvents="none"
                        >
                          {cluster.members.map(
                            (
                              member: NoteCluster["members"][number],
                              memberIndex: number,
                            ) => {
                              const isSelected =
                                selection?.voiceIndex === member.voiceIndex &&
                                selection?.chordIndex === cluster.chordIndex;
                              return (
                                <Box
                                  as="button"
                                  key={`${cluster.chordIndex}-${cluster.midi}-${member.voiceIndex}`}
                                  position="absolute"
                                  left={`${memberIndex * 6}px`}
                                  top={`${memberIndex * 7}px`}
                                  minW={`${Math.max(28, width - memberIndex * 6)}px`}
                                  h={`${NOTE_PILL_HEIGHT_PX}px`}
                                  px={2}
                                  borderRadius="md"
                                  bg={member.color}
                                  border="1px solid"
                                  borderColor={
                                    isSelected
                                      ? dsColors.accentForeground
                                      : "rgba(255,255,255,0.35)"
                                  }
                                  color="white"
                                  fontSize="11px"
                                  fontWeight="bold"
                                  display="flex"
                                  alignItems="center"
                                  justifyContent="space-between"
                                  gap={2}
                                  cursor="pointer"
                                  pointerEvents="auto"
                                  boxShadow={
                                    isSelected
                                      ? "0 0 0 2px color-mix(in srgb, var(--app-accent) 28%, transparent)"
                                      : "0 1px 3px rgba(0, 0, 0, 0.12)"
                                  }
                                  onClick={() => {
                                    setSelection({
                                      chordIndex: cluster.chordIndex,
                                      voiceIndex: member.voiceIndex,
                                    });
                                    focusViewport();
                                    if (ctx != null) {
                                      playNotePreview(ctx, cluster.midi, 0.8);
                                    }
                                  }}
                                >
                                  <Text fontSize="10px" fontWeight="bold">
                                    {member.label}
                                  </Text>
                                  <Text fontSize="10px" fontWeight="bold">
                                    {cluster.noteLabel}
                                  </Text>
                                </Box>
                              );
                            },
                          )}
                        </Box>
                      );
                    })}

                    {arrangement.parsedChords.map((chord, chordIndex) => {
                      const previewItem = chordPreviewItems[chordIndex];
                      const lyric = previewItem?.lyrics?.trim() ?? "";
                      const x =
                        NOTE_GRID_PAD_X_PX +
                        chordStarts[chordIndex]! * beatWidthPx;
                      const width = Math.max(44, chord.beats * beatWidthPx);
                      const y = CHORD_HEADER_HEIGHT_PX + noteAreaHeightPx;
                      return (
                        <Box
                          key={`lyric-${chordIndex}`}
                          position="absolute"
                          left={`${x}px`}
                          top={`${y}px`}
                          w={`${width}px`}
                          h={`${LYRIC_LANE_HEIGHT_PX}px`}
                          px={2}
                          py={2}
                          borderTop="1px solid"
                          borderColor={dsColors.border}
                          bg={
                            selection?.chordIndex === chordIndex
                              ? "color-mix(in srgb, var(--app-accent) 8%, transparent)"
                              : "transparent"
                          }
                        >
                          <Text
                            color={
                              lyric ? dsColors.textMuted : dsColors.textSubtle
                            }
                            fontSize="xs"
                            whiteSpace="nowrap"
                            overflow="hidden"
                            textOverflow="ellipsis"
                          >
                            {lyric || " "}
                          </Text>
                        </Box>
                      );
                    })}
                  </Box>

                  <RestFooter
                    chords={arrangement.parsedChords}
                    chordStarts={chordStarts}
                    beatWidthPx={beatWidthPx}
                    gridWidthPx={gridWidthPx}
                    restClusters={restClusters}
                    selection={selection}
                    onRestSelectedChord={handleRestSelectedNote}
                    onSelectRest={(voiceIndex, chordIndex) => {
                      setSelection({ voiceIndex, chordIndex });
                      focusViewport();
                    }}
                  />
                </Box>
              </Flex>
            </Box>
          </Box>
        </Stack>
      </Box>
    </Flex>
  );
}

type RestFooterProps = {
  chords: Chord[];
  chordStarts: number[];
  beatWidthPx: number;
  gridWidthPx: number;
  restClusters: RestCluster[];
  selection: Selection | null;
  onRestSelectedChord: () => void;
  onSelectRest: (voiceIndex: number, chordIndex: number) => void;
};

function RestFooter({
  chords,
  chordStarts,
  beatWidthPx,
  gridWidthPx,
  restClusters,
  selection,
  onRestSelectedChord,
  onSelectRest,
}: RestFooterProps) {
  return (
    <Box
      position="sticky"
      bottom={0}
      zIndex={1}
      w={`${gridWidthPx}px`}
      h={`${REST_ROW_HEIGHT_PX}px`}
      borderTop="1px solid"
      borderColor={dsColors.border}
      bg={dsColors.surfaceRaised}
    >
      <Box
        position="relative"
        w={`${gridWidthPx}px`}
        h={`${REST_ROW_HEIGHT_PX}px`}
      >
        {chords.map((chord, chordIndex) => {
          const x = NOTE_GRID_PAD_X_PX + chordStarts[chordIndex]! * beatWidthPx;
          const width = Math.max(44, chord.beats * beatWidthPx);
          const isSelectedChord = selection?.chordIndex === chordIndex;

          return (
            <Box
              key={`rest-cell-${chordIndex}`}
              as="button"
              position="absolute"
              top={0}
              left={`${x}px`}
              w={`${width}px`}
              h={`${REST_ROW_HEIGHT_PX}px`}
              px={2}
              borderRight="1px solid"
              borderColor="color-mix(in srgb, var(--app-border-muted) 20%, transparent)"
              bg={
                isSelectedChord
                  ? "color-mix(in srgb, var(--app-accent) 14%, var(--app-surface-raised) 86%)"
                  : dsColors.surfaceSubtle
              }
              onClick={() => {
                if (isSelectedChord) {
                  onRestSelectedChord();
                }
              }}
              cursor={isSelectedChord ? "pointer" : "default"}
              pointerEvents={isSelectedChord ? "auto" : "none"}
              style={{
                borderBottom: "none",
                borderLeft: "none",
                borderTop: "none",
              }}
            />
          );
        })}

        {restClusters.map((cluster: RestCluster) => {
          const chord = chords[cluster.chordIndex];
          if (chord == null) return null;
          const x =
            NOTE_GRID_PAD_X_PX +
            chordStarts[cluster.chordIndex]! * beatWidthPx +
            6;
          const width = Math.max(30, chord.beats * beatWidthPx - 12);

          return (
            <Box
              key={`rest-cluster-${cluster.chordIndex}`}
              position="absolute"
              left={`${x}px`}
              top="6px"
              w={`${width}px`}
              h={`${NOTE_PILL_HEIGHT_PX + Math.max(0, cluster.members.length - 1) * 7}px`}
              pointerEvents="none"
            >
              {cluster.members.map((member, memberIndex) => {
                const isSelected =
                  selection?.voiceIndex === member.voiceIndex &&
                  selection?.chordIndex === cluster.chordIndex;

                return (
                  <Box
                    as="button"
                    key={`rest-${cluster.chordIndex}-${member.voiceIndex}`}
                    position="absolute"
                    left={`${memberIndex * 6}px`}
                    top={`${memberIndex * 7}px`}
                    minW={`${Math.max(32, width - memberIndex * 6)}px`}
                    h={`${NOTE_PILL_HEIGHT_PX}px`}
                    px={2}
                    borderRadius="md"
                    bg="color-mix(in srgb, var(--app-surface-raised) 78%, white 22%)"
                    border="1px dashed"
                    borderColor={isSelected ? dsColors.accent : dsColors.border}
                    color={isSelected ? dsColors.accent : dsColors.textMuted}
                    fontSize="11px"
                    fontWeight="bold"
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                    gap={2}
                    cursor="pointer"
                    pointerEvents="auto"
                    boxShadow={
                      isSelected
                        ? "0 0 0 2px color-mix(in srgb, var(--app-accent) 24%, transparent)"
                        : "0 1px 2px rgba(0, 0, 0, 0.08)"
                    }
                    onClick={() => {
                      onSelectRest(member.voiceIndex, cluster.chordIndex);
                    }}
                  >
                    <Text fontSize="10px" fontWeight="bold">
                      {member.label}
                    </Text>
                    <Text fontSize="10px" fontWeight="bold">
                      Rest
                    </Text>
                  </Box>
                );
              })}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function getDefaultSelection(lines: HarmonyLine[]): Selection | null {
  for (let voiceIndex = 0; voiceIndex < lines.length; voiceIndex++) {
    const line = lines[voiceIndex];
    if (line == null) continue;
    for (let chordIndex = 0; chordIndex < line.length; chordIndex++) {
      if (line[chordIndex] != null) {
        return { voiceIndex, chordIndex };
      }
    }
  }
  const chordCount = lines[0]?.length ?? 0;
  if (lines.length > 0 && chordCount > 0) {
    return { voiceIndex: 0, chordIndex: 0 };
  }
  return null;
}

function buildPitchRows(lowMidi: number, highMidi: number): number[] {
  const rows: number[] = [];
  for (let midi = highMidi; midi >= lowMidi; midi--) {
    rows.push(midi);
  }
  return rows;
}

function getChordStartBeats(chords: Chord[]): number[] {
  const starts: number[] = [];
  let total = 0;
  for (const chord of chords) {
    starts.push(total);
    total += chord.beats;
  }
  return starts;
}

function getEditableMidis(
  currentMidi: MidiNote | null,
  rangeLow: number,
  rangeHigh: number,
): MidiNote[] {
  const candidates: MidiNote[] = [];
  for (let midi = rangeLow; midi <= rangeHigh; midi++) {
    candidates.push(midi);
  }
  if (
    currentMidi != null &&
    (currentMidi < rangeLow || currentMidi > rangeHigh)
  ) {
    candidates.push(currentMidi);
  }
  return candidates;
}

export function getNextMidiForArrowMove(
  currentMidi: MidiNote | null,
  direction: -1 | 1,
  rangeLow: number,
  rangeHigh: number,
): MidiNote | null {
  if (currentMidi == null) return null;
  if (currentMidi < rangeLow) {
    return direction > 0 ? rangeLow : null;
  }
  if (currentMidi > rangeHigh) {
    return direction < 0 ? rangeHigh : null;
  }

  const nextMidi = currentMidi + direction;
  if (nextMidi < rangeLow || nextMidi > rangeHigh) {
    return null;
  }
  return nextMidi;
}

function groupNoteClusters(
  lines: HarmonyLine[],
  chordCount: number,
): NoteCluster[] {
  const clusters: NoteCluster[] = [];

  for (let chordIndex = 0; chordIndex < chordCount; chordIndex++) {
    const byMidi = new Map<number, NoteCluster>();
    for (let voiceIndex = 0; voiceIndex < lines.length; voiceIndex++) {
      const midi = getHarmonyLineNote(lines[voiceIndex], chordIndex);
      if (midi == null) continue;
      const existing = byMidi.get(midi);
      const member = {
        voiceIndex,
        color: VOICE_COLORS[voiceIndex] ?? "#4d44e3",
        label: shortVoiceLabel(voiceIndex, lines.length + 1),
      };
      if (existing == null) {
        byMidi.set(midi, {
          chordIndex,
          midi,
          noteLabel: midiToNoteName(midi),
          members: [member],
        });
      } else {
        existing.members.push(member);
      }
    }
    clusters.push(...byMidi.values());
  }

  return clusters;
}

function groupRestClusters(
  lines: HarmonyLine[],
  chordCount: number,
): RestCluster[] {
  const clusters: RestCluster[] = [];

  for (let chordIndex = 0; chordIndex < chordCount; chordIndex++) {
    const members: RestCluster["members"] = [];
    for (let voiceIndex = 0; voiceIndex < lines.length; voiceIndex++) {
      if (getHarmonyLineNote(lines[voiceIndex], chordIndex) != null) continue;
      members.push({
        voiceIndex,
        color: VOICE_COLORS[voiceIndex] ?? "#4d44e3",
        label: shortVoiceLabel(voiceIndex, lines.length + 1),
      });
    }
    if (members.length > 0) {
      clusters.push({ chordIndex, members });
    }
  }

  return clusters;
}

function shortVoiceLabel(index: number, totalParts: number): string {
  const full = getPartLabel(index, totalParts);
  if (full === "Harmony Low") return "L";
  if (full === "Harmony Mid") return "M";
  if (full === "Harmony High") return "H";
  if (full === "Harmony") return "H";
  return full.slice(0, 1).toUpperCase();
}

function formatSelectedChordLabel(
  arrangement: ArrangementInfo,
  chordIndex: number,
): string {
  const previewItem = arrangement.measures.flatMap((measure) => measure.chords)[
    chordIndex
  ];
  const chord = arrangement.parsedChords[chordIndex];
  if (previewItem != null) return previewItem.chordText;
  return chord != null ? formatChordSymbol(chord) : "Selected chord";
}

function buildChordSummary(
  chord: Chord,
  lines: HarmonyLine[],
  chordIndex: number,
): ChordSummary {
  const notes = getChordNotesAtIndex(lines, chordIndex);
  return {
    formula: describeHarmonyNotesForChord(chord, notes),
    noteNames: summarizePitchClasses(notes),
  };
}

function getChordSummaryText(summary: ChordSummary | null): string {
  if (summary == null) return "Chord tones unavailable";
  if (summary.noteNames.length === 0) return summary.formula;
  return `${summary.formula}  •  ${summary.noteNames.join(" ")}`;
}

function getChordNotesAtIndex(
  lines: HarmonyLine[],
  chordIndex: number,
): MidiNote[] {
  const notes: MidiNote[] = [];
  for (let voiceIndex = 0; voiceIndex < lines.length; voiceIndex++) {
    const midi = getHarmonyLineNote(lines[voiceIndex], chordIndex);
    if (midi != null) {
      notes.push(midi);
    }
  }
  return notes;
}

function summarizePitchClasses(notes: readonly MidiNote[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const note of notes) {
    const name = midiToNoteName(note).replace(/\d+$/, "");
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}
