import { Box, Button, Flex, Heading, Stack, Text } from "@chakra-ui/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  playHarmonyPreview,
  playNotePreview,
  progressionDurationSec,
  stopAllPlayback,
} from "../music/playback";
import type { PlaybackSession } from "../music/playback";
import {
  chordSemitones,
  formatChordSymbol,
  rootSemitone,
} from "../music/parse";
import {
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

type DegreeMarker = {
  label: string;
  pitchClass: number;
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

const CHORD_HEADER_HEIGHT_PX = 54;
const NOTE_ROW_HEIGHT_PX = 26;
const LYRIC_LANE_HEIGHT_PX = 40;
const NOTE_NAME_COL_WIDTH_PX = 72;
const NOTE_GRID_PAD_X_PX = 8;
const CHORD_WIDTH_PER_BEAT_PX = 24;
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
  const effectiveVoicing = arrangement.effectiveHarmonyVoicing;
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

  useEffect(() => {
    setLocalLines(draftLines.map((line) => [...line]));
  }, [draftLines]);

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
      if (line == null || line[current.chordIndex] == null) {
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

  const degreeMarkersByChord = useMemo(
    () =>
      arrangement.parsedChords.map((chord, chordIndex) =>
        getDegreeMarkers(
          chord,
          effectiveVoicing?.annotations[chordIndex]?.chordTones ?? null,
        ),
      ),
    [arrangement.parsedChords, effectiveVoicing],
  );
  const chordPreviewItems = useMemo(
    () => arrangement.measures.flatMap((measure) => measure.chords),
    [arrangement.measures],
  );

  const allVisibleMidis = useMemo(() => {
    const values = new Set<number>();
    for (let voiceIndex = 0; voiceIndex < localLines.length; voiceIndex++) {
      const line = localLines[voiceIndex];
      if (line == null) continue;
      for (let chordIndex = 0; chordIndex < line.length; chordIndex++) {
        const midi = line[chordIndex];
        const chord = arrangement.parsedChords[chordIndex];
        if (midi == null || chord == null) continue;
        values.add(midi);
        for (const candidate of getCandidateMidis(chord, midi, range.low, range.high)) {
          values.add(candidate);
        }
      }
    }
    return [...values].sort((a, b) => a - b);
  }, [arrangement.parsedChords, localLines, range.high, range.low]);

  const lowMidi = Math.max(
    0,
    (allVisibleMidis[0] ?? range.low ?? 48) - PITCH_PADDING,
  );
  const highMidi = Math.min(127, allVisibleMidis[allVisibleMidis.length - 1] ?? range.high ?? 72);
  const pitchRows = buildPitchRows(lowMidi, highMidi);

  const selectedMidi =
    selection == null
      ? null
      : (localLines[selection.voiceIndex]?.[selection.chordIndex] ?? null);
  const selectedChord =
    selection == null
      ? null
      : (arrangement.parsedChords[selection.chordIndex] ?? null);
  const selectedDegreeMarkers =
    selection == null
      ? []
      : (degreeMarkersByChord[selection.chordIndex] ?? []);
  const selectedCandidates =
    selection == null || selectedMidi == null || selectedChord == null
      ? new Set<number>()
      : new Set(
          getCandidateMidis(selectedChord, selectedMidi, range.low, range.high),
        );

  const noteClusters = useMemo(
    () => groupNoteClusters(localLines, arrangement.parsedChords.length),
    [localLines, arrangement.parsedChords.length],
  );

  const chordStarts = getChordStartBeats(arrangement.parsedChords);
  const totalBeats = arrangement.parsedChords.reduce(
    (sum, chord) => sum + chord.beats,
    0,
  );
  const gridWidthPx = Math.max(
    320,
    Math.ceil(totalBeats * CHORD_WIDTH_PER_BEAT_PX + NOTE_GRID_PAD_X_PX * 2),
  );
  const noteAreaHeightPx = pitchRows.length * NOTE_ROW_HEIGHT_PX;
  const totalHeightPx =
    CHORD_HEADER_HEIGHT_PX + noteAreaHeightPx + LYRIC_LANE_HEIGHT_PX;

  useLayoutEffect(() => {
    const el = scrollViewportRef.current;
    if (el == null) return;
    el.scrollTop = 0;
  }, [highMidi, lowMidi, arrangement.parsedChords.length]);

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
        maxW="1120px"
        p={{ base: 4, md: 6 }}
        maxH="calc(100dvh - 2rem)"
        overflow="hidden"
        {...dsPanel}
      >
        <Stack gap={5}>
          <Flex justify="space-between" align={{ base: "flex-start", md: "center" }} gap={3} flexWrap="wrap">
            <Box>
              <Text color={dsColors.textMuted} fontSize="xs" fontWeight="semibold" mb={1}>
                HARMONY EDITOR
              </Text>
              <Heading size="lg" color={dsColors.text}>
                Customize harmony
              </Heading>
              <Text color={dsColors.textMuted} fontSize="sm" mt={1}>
                Select a colored note, then click a chord-tone row to move it. Timing and lyrics stay fixed.
              </Text>
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

          <Box
            bg={dsColors.surfaceRaised}
            borderRadius="xl"
            px={4}
            py={3}
            border="1px solid"
            borderColor={dsColors.border}
          >
            <Flex justify="space-between" align={{ base: "flex-start", md: "center" }} gap={3} flexWrap="wrap">
              <Box>
                <Text color={dsColors.textMuted} fontSize="xs" fontWeight="semibold">
                  SELECTED CHORD
                </Text>
                <Text color={dsColors.text} fontSize="lg" fontWeight="semibold">
                  {selection == null
                    ? "Pick a note to edit"
                    : formatSelectedChordLabel(arrangement, selection.chordIndex)}
                </Text>
                <Text color={dsColors.textMuted} fontSize="sm">
                  {selection == null
                    ? "Chord tones will appear inline on the grid."
                    : getChordSummaryText(
                        arrangement,
                        selection.chordIndex,
                        selectedDegreeMarkers,
                      )}
                </Text>
              </Box>
              {selection != null && (
                <Box minW={{ md: "220px" }}>
                  <Text color={dsColors.textMuted} fontSize="xs" fontWeight="semibold">
                    SELECTED NOTE
                  </Text>
                  <Text color={dsColors.text} fontSize="sm" fontWeight="semibold">
                    {getPartLabel(selection.voiceIndex, harmonyPartCount + 1)}:{" "}
                    {selectedMidi != null ? midiToNoteName(selectedMidi) : "—"}
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
            >
              <Flex
                align="stretch"
                w={`${NOTE_NAME_COL_WIDTH_PX + gridWidthPx}px`}
                minW="100%"
                h={`${totalHeightPx}px`}
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
                    <Text color={dsColors.textMuted} fontSize="xs" fontWeight="medium">
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
                  <Text color={dsColors.textMuted} fontSize="xs" fontWeight="semibold">
                    Lyrics
                  </Text>
                </Flex>
              </Box>

              <Box
                flex="1"
                className="record-note-timeline"
              >
                <Box position="relative" w={`${gridWidthPx}px`} h={`${totalHeightPx}px`}>
                  {arrangement.parsedChords.map((chord, chordIndex) => {
                    const x = NOTE_GRID_PAD_X_PX + chordStarts[chordIndex]! * CHORD_WIDTH_PER_BEAT_PX;
                    const width = Math.max(44, chord.beats * CHORD_WIDTH_PER_BEAT_PX);
                    const isSelectedChord = selection?.chordIndex === chordIndex;
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
                          py={2}
                          borderBottom="1px solid"
                          borderColor={dsColors.border}
                        >
                          <Text color={dsColors.text} fontSize="sm" fontWeight="semibold" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis">
                            {previewItem?.chordText ?? formatChordSymbol(chord)}
                          </Text>
                          <Text color={dsColors.textMuted} fontSize="10px" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis">
                            {degreeMarkersByChord[chordIndex]
                              ?.map((marker: DegreeMarker) => marker.label)
                              .join(" ")}
                          </Text>
                        </Box>
                      </Box>
                    );
                  })}

                  {pitchRows.map((midi, rowIndex) => {
                    const y = CHORD_HEADER_HEIGHT_PX + rowIndex * NOTE_ROW_HEIGHT_PX;
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

                  {Array.from({ length: Math.ceil(totalBeats) + 1 }).map((_, beat) => (
                    <Box
                      key={`beat-guide-${beat}`}
                      position="absolute"
                      top={0}
                      bottom={0}
                      left={`${NOTE_GRID_PAD_X_PX + beat * CHORD_WIDTH_PER_BEAT_PX}px`}
                      w="1px"
                      bg="color-mix(in srgb, var(--app-border-muted) 16%, transparent)"
                    />
                  ))}

                  {arrangement.parsedChords.map((chord, chordIndex) => {
                    const x = NOTE_GRID_PAD_X_PX + chordStarts[chordIndex]! * CHORD_WIDTH_PER_BEAT_PX;
                    const width = Math.max(44, chord.beats * CHORD_WIDTH_PER_BEAT_PX);
                    const chordMarkers = degreeMarkersByChord[chordIndex] ?? [];
                    return pitchRows.map((midi, rowIndex) => {
                      const y = CHORD_HEADER_HEIGHT_PX + rowIndex * NOTE_ROW_HEIGHT_PX;
                      const marker = chordMarkers.find(
                        (entry: DegreeMarker) =>
                          entry.pitchClass === positiveMod(midi, 12),
                      );
                      const isCandidate =
                        selection?.chordIndex === chordIndex &&
                        selectedCandidates.has(midi);

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
                          {marker != null && (
                            <Text
                              color={
                                selection?.chordIndex === chordIndex
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
                              {marker.label}
                            </Text>
                          )}
                        </Box>
                      );
                    });
                  })}

                  {noteClusters.map((cluster: NoteCluster) => {
                    const chord = arrangement.parsedChords[cluster.chordIndex];
                    if (chord == null) return null;
                    const x =
                      NOTE_GRID_PAD_X_PX +
                      chordStarts[cluster.chordIndex]! * CHORD_WIDTH_PER_BEAT_PX +
                      6;
                    const width = Math.max(30, chord.beats * CHORD_WIDTH_PER_BEAT_PX - 12);
                    const rowIndex = highMidi - cluster.midi;
                    const baseY =
                      CHORD_HEADER_HEIGHT_PX +
                      rowIndex * NOTE_ROW_HEIGHT_PX +
                      Math.max(3, (NOTE_ROW_HEIGHT_PX - NOTE_PILL_HEIGHT_PX) / 2);

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
                                isSelected ? dsColors.accentForeground : "rgba(255,255,255,0.35)"
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
                    const x = NOTE_GRID_PAD_X_PX + chordStarts[chordIndex]! * CHORD_WIDTH_PER_BEAT_PX;
                    const width = Math.max(44, chord.beats * CHORD_WIDTH_PER_BEAT_PX);
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
                        <Text color={lyric ? dsColors.textMuted : dsColors.textSubtle} fontSize="xs" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis">
                          {lyric || " "}
                        </Text>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
              </Flex>
            </Box>
          </Box>

          <Text color={dsColors.textSubtle} fontSize="xs">
            Chord columns keep their current duration. Duplicate notes across voices are supported.
          </Text>
        </Stack>
      </Box>
    </Flex>
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

function getDegreeMarkers(
  chord: Chord,
  formula: string | null,
): DegreeMarker[] {
  const labels = (formula ?? getFallbackFormula(chord))
    .split(/\s+/)
    .filter((entry) => entry.length > 0 && DEGREE_INTERVALS[entry] != null);
  const root = rootSemitone(chord.root);
  return labels.map((label) => {
    const interval = DEGREE_INTERVALS[label] ?? 0;
    return {
      label,
      pitchClass: positiveMod(root + interval, 12),
    };
  });
}

function getFallbackFormula(chord: Chord): string {
  switch (chord.quality) {
    case "minor":
      return "R b3 5";
    case "diminished":
      return "R b3 b5";
    case "major6":
      return "R 3 6";
    case "minor6":
      return "R b3 6";
    case "dominant7":
    case "dominant9":
    case "dominant7Flat9":
      return "R 3 b7";
    case "minor7":
    case "minor9":
    case "minor7Flat9":
      return "R b3 b7";
    case "major7":
      return "R 3 7";
    case "sus2":
    case "dominant9Sus2":
      return "R 2 5";
    case "sus4":
    case "dominant9Sus4":
      return "R 4 5";
    default:
      return "R 3 5";
  }
}

const DEGREE_INTERVALS: Record<string, number> = {
  R: 0,
  "2": 2,
  b3: 3,
  "3": 4,
  "4": 5,
  b5: 6,
  "5": 7,
  "6": 9,
  b7: 10,
  "7": 11,
  b9: 13,
  "9": 14,
};

function getCandidateMidis(
  chord: Chord,
  currentMidi: MidiNote,
  rangeLow: number,
  rangeHigh: number,
): MidiNote[] {
  const tonePitchClasses = chordSemitones(chord.root, chord.quality).map((value) =>
    positiveMod(value, 12),
  );
  const candidates = new Set<number>([currentMidi]);
  const low = Math.min(rangeLow, currentMidi - 12);
  const high = Math.max(rangeHigh, currentMidi + 12);

  for (let midi = low; midi <= high; midi++) {
    if (!tonePitchClasses.includes(positiveMod(midi, 12))) continue;
    if (midi < rangeLow || midi > rangeHigh) {
      if (midi !== currentMidi) continue;
    }
    if (Math.abs(midi - currentMidi) > 12 && midi !== currentMidi) continue;
    candidates.add(midi);
  }

  return [...candidates].sort((a, b) => {
    const distanceDiff = Math.abs(a - currentMidi) - Math.abs(b - currentMidi);
    return distanceDiff === 0 ? a - b : distanceDiff;
  });
}

function positiveMod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function groupNoteClusters(
  lines: HarmonyLine[],
  chordCount: number,
): NoteCluster[] {
  const clusters: NoteCluster[] = [];

  for (let chordIndex = 0; chordIndex < chordCount; chordIndex++) {
    const byMidi = new Map<number, NoteCluster>();
    for (let voiceIndex = 0; voiceIndex < lines.length; voiceIndex++) {
      const midi = lines[voiceIndex]?.[chordIndex];
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
  const previewItem = arrangement.measures.flatMap((measure) => measure.chords)[chordIndex];
  const chord = arrangement.parsedChords[chordIndex];
  if (previewItem != null) return previewItem.chordText;
  return chord != null ? formatChordSymbol(chord) : "Selected chord";
}

function getChordSummaryText(
  arrangement: ArrangementInfo,
  chordIndex: number,
  markers: DegreeMarker[],
): string {
  const chord = arrangement.parsedChords[chordIndex];
  if (chord == null) return "Chord tones unavailable";
  const noteNames = chordSemitones(chord.root, chord.quality)
    .map((value) => midiToNoteName(60 + positiveMod(value, 12)).replace(/\d+$/, ""))
    .join(" ");
  return `${markers.map((marker) => marker.label).join(" ")}  •  ${noteNames}`;
}
