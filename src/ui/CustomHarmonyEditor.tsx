import { Box, Button, Flex, Text } from "@chakra-ui/react";
import {
  type ChangeEvent as ReactChangeEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ARRANGEMENT_TICKS_PER_BEAT,
  arrangementTicksToBeats,
  describeArrangementEvent,
  formatBeatCount,
  sampleLinesAtTicks,
  type CustomArrangement,
} from "../music/arrangementScore";
import {
  describeHarmonyNotesForChord,
  labelHarmonyNoteForChord,
} from "../music/harmony";
import {
  playHarmonyPreview,
  playNotePreview,
  progressionDurationSec,
  stopAllPlayback,
} from "../music/playback";
import type { PlaybackSession } from "../music/playback";
import { formatChordSymbol } from "../music/parse";
import {
  getPartLabel,
  midiToNoteName,
  noteNameToMidi,
  type Chord,
  type HarmonyLine,
  type MidiNote,
} from "../music/types";
import type { ArrangementEditorSpan, ArrangementInfo } from "../state/model";
import {
  canMergeWithNext,
  cloneArrangement,
  eventFitsWithinSpan,
  getArrangementSelectionItems,
  getNextSelectionInArrangementOrder,
  getSafeSelection,
  getSelectedEvent,
  mergeSelectedEventWithNext,
  splitSelectedEventInHalf,
  splitSelectedEventToBeats,
  type HarmonyEditorSelection,
  updateSelectedEventMidi,
} from "./customHarmonyEditorState";
import {
  dsColors,
  dsOutlineButton,
  dsPanel,
  dsPrimaryButton,
  dsScreenShell,
} from "./designSystem";
import { PlayIcon, StopIcon } from "./icons";

type Props = {
  arrangement: ArrangementInfo;
  draftArrangement: CustomArrangement | null;
  ctx: AudioContext | null;
  onRequestAudioContext: () => Promise<AudioContext | null>;
  onCancel: () => void;
  onSave: (arrangement: CustomArrangement) => void;
};

export type { HarmonyEditorSelection } from "./customHarmonyEditorState";

type Selection = HarmonyEditorSelection;

type ChordSummary = {
  formula: string;
  noteNames: string[];
};

type NoteDragState = {
  pointerId: number;
  selection: Selection;
  startClientY: number;
  originMidi: MidiNote;
  lastMidi: MidiNote;
  dragged: boolean;
};

const CHORD_HEADER_HEIGHT_PX = 64;
const NOTE_ROW_HEIGHT_PX = 26;
const LYRIC_LANE_HEIGHT_PX = 40;
const REST_ROW_HEIGHT_PX = 34;
const NOTE_NAME_COL_WIDTH_PX = 84;
const NOTE_GRID_PAD_X_PX = 8;
const DEFAULT_MEASURE_WIDTH_PX = 120;
const NOTE_BLOCK_HEIGHT_PX = 18;
const PITCH_PADDING = 1;
const VOICE_COLORS = ["#4d44e3", "#1f9d79", "#d06a32"] as const;
const TYPED_PITCH_BUFFER_TIMEOUT_MS = 1000;

export function CustomHarmonyEditor({
  arrangement,
  draftArrangement,
  ctx,
  onRequestAudioContext,
  onCancel,
  onSave,
}: Props) {
  const previewSessionRef = useRef<PlaybackSession | null>(null);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const typedPitchBufferRef = useRef("");
  const typedPitchBufferTimeoutRef = useRef<number | null>(null);
  const noteDragStateRef = useRef<NoteDragState | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [measureWidthPx, setMeasureWidthPx] = useState(DEFAULT_MEASURE_WIDTH_PX);
  const [selection, setSelection] = useState<Selection | null>(null);

  const baseArrangement = useMemo(
    () =>
      draftArrangement == null
        ? arrangement.effectiveCustomArrangement
        : cloneArrangement(draftArrangement),
    [arrangement.effectiveCustomArrangement, draftArrangement],
  );
  const [localArrangement, setLocalArrangement] = useState<CustomArrangement | null>(
    baseArrangement == null ? null : cloneArrangement(baseArrangement),
  );

  useEffect(() => {
    setLocalArrangement(baseArrangement == null ? null : cloneArrangement(baseArrangement));
  }, [baseArrangement]);

  useEffect(() => {
    return () => {
      stopAllPlayback();
      previewSessionRef.current?.stop();
      previewSessionRef.current = null;
      if (typedPitchBufferTimeoutRef.current != null) {
        window.clearTimeout(typedPitchBufferTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setSelection((current: Selection | null) =>
      getSafeSelection(localArrangement, current),
    );
  }, [localArrangement]);

  const beatsPerBar = Math.max(1, arrangement.input.meter[0]);
  const minMeasureWidthPx = beatsPerBar * 10;
  const maxMeasureWidthPx = beatsPerBar * 96;
  const measureWidthStepPx = beatsPerBar * 4;
  const beatWidthPx = measureWidthPx / beatsPerBar;

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

  const chordTicks = arrangement.editorSpans.map((span) => span.startTick);
  const sampledLines = useMemo(
    () =>
      localArrangement == null
        ? []
        : sampleLinesAtTicks(localArrangement, chordTicks),
    [chordTicks, localArrangement],
  );

  const chordSummaries = useMemo(
    () =>
      arrangement.parsedChords.map((chord, chordIndex) =>
        buildChordSummary(chord, sampledLines, chordIndex),
      ),
    [arrangement.parsedChords, sampledLines],
  );

  const selectedEvent = getSelectedEvent(localArrangement, selection);
  const selectedSpan =
    selectedEvent == null
      ? null
      : findSpanForTick(arrangement.editorSpans, selectedEvent.startTick);
  const selectedMidi = selectedEvent?.midi ?? null;
  const selectedCandidates = new Set(
    getEditableMidis(selectedMidi, range.low, range.high),
  );

  const visiblePitchBounds = useMemo(() => {
    let lowMidi = range.low;
    let highMidi = range.high;
    for (const voice of localArrangement?.voices ?? []) {
      for (const event of voice.events) {
        if (event.midi == null) continue;
        lowMidi = Math.min(lowMidi, event.midi);
        highMidi = Math.max(highMidi, event.midi);
      }
    }
    return {
      low: Math.max(0, lowMidi - PITCH_PADDING),
      high: Math.min(127, highMidi + PITCH_PADDING),
    };
  }, [localArrangement, range.high, range.low]);

  const lowMidi = visiblePitchBounds.low;
  const highMidi = visiblePitchBounds.high;
  const pitchRows = buildPitchRows(lowMidi, highMidi);
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

  const referenceArrangement = draftArrangement;
  const visualSelectionItems = useMemo(
    () => getArrangementSelectionItems(localArrangement),
    [localArrangement],
  );

  useLayoutEffect(() => {
    const el = scrollViewportRef.current;
    if (el == null) return;
    el.scrollTop = 0;
  }, [highMidi, lowMidi, localArrangement?.voices.length]);

  const selectedChordLabel =
    selectedSpan == null
      ? "Pick a note to edit"
      : selectedSpan.chordText || formatChordSymbol(selectedSpan.chord);
  const selectedChordDetails =
    selectedSpan == null
      ? "Pitch labels appear over the selected event."
      : getChordSummaryText(
          chordSummaries[arrangement.editorSpans.indexOf(selectedSpan)] ?? null,
        );
  const selectedEventLabel =
    selection == null || selectedEvent == null
      ? "No note selected"
      : `${getPartLabel(selection.voiceIndex, (localArrangement?.voices.length ?? 0) + 1)}: ${describeArrangementEvent(
          selectedEvent,
          ARRANGEMENT_TICKS_PER_BEAT,
        )}${
          selectedEvent.midi != null && selectedSpan != null
            ? ` • ${labelHarmonyNoteForChord(selectedSpan.chord, selectedEvent.midi)}`
            : ""
        }`;
  const selectedLyric =
    selectedSpan == null
      ? "Select a note to inspect its lyric."
      : selectedSpan.lyrics.trim() || "No lyric on this chord";

  const canSplitToBeats =
    selectedEvent != null &&
    selectedSpan != null &&
    eventFitsWithinSpan(selectedEvent, selectedSpan) &&
    selectedEvent.durationTicks > ARRANGEMENT_TICKS_PER_BEAT;
  const canSplitHalf =
    selectedEvent != null &&
    selectedEvent.durationTicks > 1 &&
    selectedEvent.durationTicks % 2 === 0;
  const canMergeNext =
    selection != null &&
    localArrangement != null &&
    canMergeWithNext(localArrangement.voices[selection.voiceIndex], selectedEvent);

  function focusViewport() {
    scrollViewportRef.current?.focus();
  }

  function clearTypedPitchBuffer() {
    typedPitchBufferRef.current = "";
    if (typedPitchBufferTimeoutRef.current != null) {
      window.clearTimeout(typedPitchBufferTimeoutRef.current);
      typedPitchBufferTimeoutRef.current = null;
    }
  }

  function restartTypedPitchBufferTimeout(nextBuffer: string) {
    if (typedPitchBufferTimeoutRef.current != null) {
      window.clearTimeout(typedPitchBufferTimeoutRef.current);
      typedPitchBufferTimeoutRef.current = null;
    }
    if (nextBuffer.length === 0) return;
    typedPitchBufferTimeoutRef.current = window.setTimeout(() => {
      typedPitchBufferRef.current = "";
      typedPitchBufferTimeoutRef.current = null;
    }, TYPED_PITCH_BUFFER_TIMEOUT_MS);
  }

  function updateLocalArrangement(
    updater: (current: CustomArrangement) => {
      arrangement: CustomArrangement;
      selection?: Selection | null;
    },
  ) {
    setLocalArrangement((current: CustomArrangement | null) => {
      if (current == null) return current;
      const next = updater(current);
      setSelection(
        next.selection === undefined
          ? getSafeSelection(next.arrangement, selection)
          : next.selection,
      );
      return next.arrangement;
    });
    focusViewport();
  }

  function applySelectedValue(nextMidi: MidiNote | null) {
    if (selection == null || selectedEvent == null) return;
    applyValueToSelection(selection, nextMidi, { preview: true });
  }

  function applyValueToSelection(
    targetSelection: Selection,
    nextMidi: MidiNote | null,
    options?: { preview?: boolean },
  ) {
    updateLocalArrangement((current) => ({
      arrangement: updateSelectedEventMidi(current, targetSelection, nextMidi),
      selection: targetSelection,
    }));
    if (options?.preview !== false && nextMidi != null && ctx != null) {
      playNotePreview(ctx, nextMidi, 0.8);
    }
  }

  function handleNotePointerDown(
    event: ReactPointerEvent<HTMLElement>,
    voiceIndex: number,
    eventId: string,
    midi: MidiNote,
  ) {
    if (event.button !== 0) return;
    const nextSelection = { voiceIndex, eventId };
    noteDragStateRef.current = {
      pointerId: event.pointerId,
      selection: nextSelection,
      startClientY: event.clientY,
      originMidi: midi,
      lastMidi: midi,
      dragged: false,
    };
    setSelection(nextSelection);
    focusViewport();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handleNotePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const dragState = noteDragStateRef.current;
    if (dragState == null || dragState.pointerId !== event.pointerId) return;
    const semitoneOffset = Math.round(
      (dragState.startClientY - event.clientY) / NOTE_ROW_HEIGHT_PX,
    );
    const nextMidi = clampMidi(
      dragState.originMidi + semitoneOffset,
      range.low,
      range.high,
    );
    if (nextMidi === dragState.lastMidi) return;
    dragState.lastMidi = nextMidi;
    dragState.dragged = true;
    applyValueToSelection(dragState.selection, nextMidi, { preview: false });
  }

  function finishNoteDrag(pointerId: number) {
    const dragState = noteDragStateRef.current;
    if (dragState == null || dragState.pointerId !== pointerId) return;
    noteDragStateRef.current = null;
    if (dragState.dragged && ctx != null) {
      playNotePreview(ctx, dragState.lastMidi, 0.8);
    }
  }

  function handleSplitToBeats() {
    if (selection == null || selectedEvent == null || !canSplitToBeats) return;
    updateLocalArrangement((current) => {
      const nextArrangement = splitSelectedEventToBeats(current, selection);
      return {
        arrangement: nextArrangement.arrangement,
        selection: nextArrangement.selection,
      };
    });
  }

  function handleSplitInHalf() {
    if (selection == null || selectedEvent == null || !canSplitHalf) return;
    updateLocalArrangement((current) => {
      const nextArrangement = splitSelectedEventInHalf(current, selection);
      return {
        arrangement: nextArrangement.arrangement,
        selection: nextArrangement.selection,
      };
    });
  }

  function handleMergeNext() {
    if (selection == null || !canMergeNext) return;
    updateLocalArrangement((current) => {
      const nextArrangement = mergeSelectedEventWithNext(current, selection);
      return {
        arrangement: nextArrangement.arrangement,
        selection: nextArrangement.selection,
      };
    });
  }

  function handleViewportKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey || selection == null) {
      return;
    }

    if (event.key === "Escape") {
      if (typedPitchBufferRef.current.length > 0) {
        event.preventDefault();
        clearTypedPitchBuffer();
      }
      return;
    }

    if (event.key === "Tab") {
      const nextSelection = getNextSelectionInArrangementOrder(
        visualSelectionItems,
        selection,
        event.shiftKey ? -1 : 1,
      );
      event.preventDefault();
      clearTypedPitchBuffer();
      if (nextSelection != null) {
        setSelection(nextSelection);
        focusViewport();
      }
      return;
    }

    if (event.key.toLowerCase() === "b") {
      event.preventDefault();
      clearTypedPitchBuffer();
      handleSplitToBeats();
      return;
    }

    const direction =
      !event.shiftKey && event.key === "ArrowUp"
        ? 1
        : !event.shiftKey && event.key === "ArrowDown"
          ? -1
          : 0;
    if (direction !== 0) {
      const nextMidi = getNextMidiForArrowMove(
        selectedMidi,
        direction,
        range.low,
        range.high,
      );
      event.preventDefault();
      clearTypedPitchBuffer();
      if (nextMidi != null && nextMidi !== selectedMidi) {
        applySelectedValue(nextMidi);
      }
      return;
    }

    const typedPitchResult = reduceTypedPitchBuffer(
      typedPitchBufferRef.current,
      event.key,
      selectedCandidates,
    );
    if (typedPitchResult == null) {
      return;
    }

    typedPitchBufferRef.current = typedPitchResult.nextBuffer;
    if (typedPitchResult.commit === "rest") {
      event.preventDefault();
      clearTypedPitchBuffer();
      applySelectedValue(null);
      return;
    }
    event.preventDefault();
    if (typedPitchResult.commit === "note") {
      clearTypedPitchBuffer();
      applySelectedValue(typedPitchResult.midi);
      return;
    }
    restartTypedPitchBufferTimeout(typedPitchResult.nextBuffer);
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
    if (
      nextCtx == null ||
      arrangement.parsedChords.length === 0 ||
      localArrangement == null
    ) {
      return;
    }

    stopAllPlayback();
    previewSessionRef.current?.stop();
    const session = playHarmonyPreview(
      nextCtx,
      arrangement.parsedChords,
      arrangement.input.meter[0],
      arrangement.input.tempo,
      {
        arrangementVoices: localArrangement.voices,
      },
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

  if (localArrangement == null) {
    return (
      <Flex {...dsScreenShell}>
        <Box w="100%" maxW="720px" p={6} {...dsPanel}>
          <Text color={dsColors.text}>
            No editable arrangement is available for this progression yet.
          </Text>
        </Box>
      </Flex>
    );
  }

  return (
    <Flex
      {...dsScreenShell}
      h="100dvh"
      minH="100dvh"
      py={0}
      px={0}
      align="stretch"
      justify="stretch"
      overflow="hidden"
    >
      <Box
        w="100%"
        h="100dvh"
        p={0}
        overflow="hidden"
        {...dsPanel}
        borderRadius="none"
        borderLeftWidth="0"
        borderRightWidth="0"
        borderTopWidth="0"
        boxShadow="none"
      >
        <Flex direction="column" h="100%" minH={0}>
          <Box
            px={{ base: 2.5, md: 3 }}
            py={{ base: 2, md: 2.5 }}
            borderBottom="1px solid"
            borderColor={dsColors.border}
            bg={dsColors.surface}
          >
            <Flex justify="space-between" align="center" gap={3} wrap="wrap">
              <Flex align="center" gap={3} wrap="wrap">
                <Text
                  color={dsColors.text}
                  fontSize="lg"
                  fontWeight="semibold"
                  lineHeight="1"
                  letterSpacing="-0.01em"
                >
                  Hum
                </Text>
                <Box
                  w="1px"
                  h="20px"
                  bg="color-mix(in srgb, var(--app-border-muted) 55%, transparent)"
                />
                <Text
                  color={dsColors.textMuted}
                  fontSize="xs"
                  fontWeight="semibold"
                  letterSpacing="0.08em"
                >
                  HARMONY EDITOR
                </Text>
              </Flex>

              <Flex gap={2} align="center" wrap="wrap" justify="flex-end">
                <Button
                  {...dsOutlineButton}
                  size="sm"
                  minW="34px"
                  w="34px"
                  h="34px"
                  p={0}
                  onClick={handlePreview}
                  aria-label={previewing ? "Stop preview" : "Play preview"}
                >
                  {previewing ? <StopIcon size={15} /> : <PlayIcon size={15} />}
                </Button>
                <Button
                  {...dsOutlineButton}
                  size="sm"
                  onClick={handleSplitToBeats}
                  disabled={!canSplitToBeats}
                >
                  Split Beats
                </Button>
                <Button
                  {...dsOutlineButton}
                  size="sm"
                  onClick={handleSplitInHalf}
                  disabled={!canSplitHalf}
                >
                  Split Half
                </Button>
                <Button
                  {...dsOutlineButton}
                  size="sm"
                  onClick={handleMergeNext}
                  disabled={!canMergeNext}
                >
                  Merge Next
                </Button>
                <Button {...dsOutlineButton} size="sm" onClick={onCancel}>
                  Cancel
                </Button>
                <Button
                  {...dsPrimaryButton}
                  size="sm"
                  onClick={() => onSave(cloneArrangement(localArrangement))}
                >
                  Save
                </Button>
              </Flex>
            </Flex>

            <Flex
              mt={2.5}
              pt={2.5}
              gap={3}
              flexWrap="wrap"
              align={{ base: "stretch", xl: "center" }}
              borderTop="1px solid"
              borderColor="color-mix(in srgb, var(--app-border-muted) 28%, transparent)"
            >
              <InfoBlock label="Selected Chord" value={selectedChordLabel} hint={selectedChordDetails} />
              <InfoBlock label="Selected Note" value={selectedEventLabel} hint={selectedLyric} />
              <Box minW={{ base: "100%", lg: "320px" }} flex="1.15 1 320px">
                <Text color={dsColors.textMuted} fontSize="xs" fontWeight="semibold" mb={1}>
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
                    style={{ flex: 1, accentColor: "var(--app-accent)", cursor: "pointer" }}
                  />
                  <Text color={dsColors.textMuted} fontSize="xs" fontWeight="semibold" minW="52px" textAlign="right">
                    {Math.round(measureWidthPx)} px
                  </Text>
                </Flex>
              </Box>
            </Flex>
          </Box>

          <Box flex="1" minH={0} overflow="hidden" bg={dsColors.surfaceSubtle}>
            <Box
              ref={scrollViewportRef}
              overflow="auto"
              h="100%"
              tabIndex={0}
              onKeyDownCapture={handleViewportKeyDown}
            >
              <Flex
                align="stretch"
                w={`${NOTE_NAME_COL_WIDTH_PX + gridWidthPx}px`}
                minW="100%"
                h={`${scrollContentHeightPx}px`}
              >
                <PitchSidebar pitchRows={pitchRows} />

                <Box flex="1" className="record-note-timeline">
                  <Box position="relative" w={`${gridWidthPx}px`} h={`${totalHeightPx}px`}>
                    {arrangement.editorSpans.map((span, chordIndex) => {
                      const x =
                        NOTE_GRID_PAD_X_PX +
                        arrangementTicksToBeats(span.startTick) * beatWidthPx;
                      const width = Math.max(
                        44,
                        arrangementTicksToBeats(span.durationTicks) * beatWidthPx,
                      );
                      const isSelectedChord = selectedSpan?.id === span.id;
                      return (
                        <Box
                          key={span.id}
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
                            <Text color={dsColors.text} fontSize="sm" fontWeight="semibold" lineHeight="1.15">
                              {span.chordText || formatChordSymbol(span.chord)}
                            </Text>
                            <Text color={dsColors.textMuted} fontSize="10px" mt={0.5} lineHeight="1.15">
                              {chordSummaries[chordIndex]?.formula}
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
                        left={`${NOTE_GRID_PAD_X_PX + beat * beatWidthPx}px`}
                        w="1px"
                        bg="color-mix(in srgb, var(--app-border-muted) 16%, transparent)"
                      />
                    ))}

                    {selectedEvent != null &&
                      selectedSpan != null &&
                      pitchRows.map((midi, rowIndex) => {
                        const y = CHORD_HEADER_HEIGHT_PX + rowIndex * NOTE_ROW_HEIGHT_PX;
                        const x =
                          NOTE_GRID_PAD_X_PX +
                          arrangementTicksToBeats(selectedEvent.startTick) *
                            beatWidthPx;
                        const width = Math.max(
                          24,
                          arrangementTicksToBeats(selectedEvent.durationTicks) *
                            beatWidthPx,
                        );
                        return (
                          <Box
                            key={`candidate-${midi}`}
                            as="button"
                            position="absolute"
                            top={`${y}px`}
                            left={`${x}px`}
                            w={`${width}px`}
                            h={`${NOTE_ROW_HEIGHT_PX}px`}
                            px={2}
                            bg={
                              selectedCandidates.has(midi)
                                ? "color-mix(in srgb, var(--app-accent) 10%, transparent)"
                                : "transparent"
                            }
                            onClick={() => applySelectedValue(midi)}
                            style={{ border: "none" }}
                          >
                            <Text
                              color={dsColors.accent}
                              fontSize="10px"
                              fontWeight="bold"
                              position="absolute"
                              right="6px"
                              top="50%"
                              transform="translateY(-50%)"
                              opacity={selectedCandidates.has(midi) ? 1 : 0}
                            >
                              {labelHarmonyNoteForChord(selectedSpan.chord, midi)}
                            </Text>
                          </Box>
                        );
                      })}

                    {referenceArrangement != null &&
                      renderArrangementEvents({
                        arrangement: referenceArrangement,
                        beatWidthPx,
                        highMidi,
                        selection: null,
                        onSelect: undefined,
                        noteOpacity: 0.35,
                        noteBorderStyle: "dashed",
                        zIndex: 1,
                      })}

                    {renderArrangementEvents({
                      arrangement: localArrangement,
                      beatWidthPx,
                      highMidi,
                      selection,
                      onSelect: (voiceIndex, eventId, midi) => {
                        setSelection({ voiceIndex, eventId });
                        focusViewport();
                        if (midi != null && ctx != null) {
                          playNotePreview(ctx, midi, 0.8);
                        }
                      },
                      onPointerDown: handleNotePointerDown,
                      onPointerMove: handleNotePointerMove,
                      onPointerUp: (pointerId) => finishNoteDrag(pointerId),
                      onPointerCancel: (pointerId) => finishNoteDrag(pointerId),
                      noteOpacity: 1,
                      noteBorderStyle: "solid",
                      zIndex: 2,
                    })}

                    {arrangement.editorSpans.map((span) => {
                      const x =
                        NOTE_GRID_PAD_X_PX +
                        arrangementTicksToBeats(span.startTick) * beatWidthPx;
                      const width = Math.max(
                        44,
                        arrangementTicksToBeats(span.durationTicks) * beatWidthPx,
                      );
                      const y = CHORD_HEADER_HEIGHT_PX + noteAreaHeightPx;
                      return (
                        <Box
                          key={`lyric-${span.id}`}
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
                            selection != null && selectedSpan?.id === span.id
                              ? "color-mix(in srgb, var(--app-accent) 8%, transparent)"
                              : "transparent"
                          }
                        >
                          <Text
                            color={span.lyrics ? dsColors.textMuted : dsColors.textSubtle}
                            fontSize="xs"
                            whiteSpace="nowrap"
                            overflow="hidden"
                            textOverflow="ellipsis"
                          >
                            {span.lyrics || " "}
                          </Text>
                        </Box>
                      );
                    })}
                  </Box>

                  <RestFooter
                    arrangement={localArrangement}
                    beatWidthPx={beatWidthPx}
                    gridWidthPx={gridWidthPx}
                    selection={selection}
                    onSelect={(voiceIndex, eventId) => {
                      setSelection({ voiceIndex, eventId });
                      focusViewport();
                    }}
                    onApplyRest={() => applySelectedValue(null)}
                  />
                </Box>
              </Flex>
            </Box>
          </Box>
        </Flex>
      </Box>
    </Flex>
  );
}

function InfoBlock({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Box minW={{ base: "100%", md: "220px" }} flex="1 1 220px">
      <Text color={dsColors.textMuted} fontSize="xs" fontWeight="semibold" mb={1}>
        {label.toUpperCase()}
      </Text>
      <Text color={dsColors.text} fontSize="sm" fontWeight="semibold">
        {value}
      </Text>
      <Text color={dsColors.textMuted} fontSize="xs" mt={0.5}>
        {hint}
      </Text>
    </Box>
  );
}

function PitchSidebar({ pitchRows }: { pitchRows: number[] }) {
  return (
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
        <Text color={dsColors.textMuted} fontSize="xs" fontWeight="semibold">
          Rest
        </Text>
      </Flex>
    </Box>
  );
}

function RestFooter({
  arrangement,
  beatWidthPx,
  gridWidthPx,
  selection,
  onSelect,
  onApplyRest,
}: {
  arrangement: CustomArrangement;
  beatWidthPx: number;
  gridWidthPx: number;
  selection: Selection | null;
  onSelect: (voiceIndex: number, eventId: string) => void;
  onApplyRest: () => void;
}) {
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
      <Box position="relative" w={`${gridWidthPx}px`} h={`${REST_ROW_HEIGHT_PX}px`}>
        {arrangement.voices.flatMap((voice, voiceIndex) =>
          voice.events
            .filter((event) => event.midi == null)
            .map((event) => {
              const x =
                NOTE_GRID_PAD_X_PX +
                arrangementTicksToBeats(event.startTick) * beatWidthPx +
                6;
              const width = Math.max(
                28,
                arrangementTicksToBeats(event.durationTicks) * beatWidthPx - 12,
              );
              const isSelected =
                selection?.voiceIndex === voiceIndex &&
                selection.eventId === event.id;
              return (
                <Box
                  as="button"
                  key={event.id}
                  position="absolute"
                  left={`${x}px`}
                  top={`${6 + voiceIndex * 4}px`}
                  minW={`${width}px`}
                  h={`${NOTE_BLOCK_HEIGHT_PX}px`}
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
                  onClick={() => onSelect(voiceIndex, event.id)}
                >
                  <Text fontSize="10px" fontWeight="bold">
                    {shortVoiceLabel(voiceIndex, arrangement.voices.length + 1)}
                  </Text>
                  <Text fontSize="10px" fontWeight="bold">
                    {formatBeatCount(
                      arrangementTicksToBeats(event.durationTicks),
                    )}
                  </Text>
                </Box>
              );
            }),
        )}

        {selection != null && getSelectedEvent(arrangement, selection)?.midi != null && (
          <Box
            as="button"
            position="absolute"
            inset={0}
            onClick={onApplyRest}
            style={{ border: "none" }}
          />
        )}
      </Box>
    </Box>
  );
}

function renderArrangementEvents({
  arrangement,
  beatWidthPx,
  highMidi,
  selection,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  noteOpacity,
  noteBorderStyle,
  zIndex,
}: {
  arrangement: CustomArrangement;
  beatWidthPx: number;
  highMidi: number;
  selection: Selection | null;
  onSelect?: (voiceIndex: number, eventId: string, midi: MidiNote | null) => void;
  onPointerDown?: (
    event: ReactPointerEvent<HTMLElement>,
    voiceIndex: number,
    eventId: string,
    midi: MidiNote,
  ) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp?: (pointerId: number) => void;
  onPointerCancel?: (pointerId: number) => void;
  noteOpacity: number;
  noteBorderStyle: "solid" | "dashed";
  zIndex: number;
}) {
  return arrangement.voices.flatMap((voice, voiceIndex) =>
    voice.events
      .filter((event) => event.midi != null)
      .map((event) => {
        const midi = event.midi!;
        const rowIndex = highMidi - midi;
        const x =
          NOTE_GRID_PAD_X_PX +
          arrangementTicksToBeats(event.startTick) * beatWidthPx +
          6;
        const width = Math.max(
          28,
          arrangementTicksToBeats(event.durationTicks) * beatWidthPx - 12,
        );
        const y =
          CHORD_HEADER_HEIGHT_PX +
          rowIndex * NOTE_ROW_HEIGHT_PX +
          Math.max(3, (NOTE_ROW_HEIGHT_PX - NOTE_BLOCK_HEIGHT_PX) / 2) +
          voiceIndex * 4;
        const isSelected =
          selection?.voiceIndex === voiceIndex && selection.eventId === event.id;
        return (
          <Box
            as="button"
            key={event.id}
            position="absolute"
            left={`${x}px`}
            top={`${y}px`}
            minW={`${width}px`}
            h={`${NOTE_BLOCK_HEIGHT_PX}px`}
            px={2}
            borderRadius="md"
            bg={VOICE_COLORS[voiceIndex] ?? "#4d44e3"}
            opacity={noteOpacity}
            border="1px"
            borderStyle={noteBorderStyle}
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
            cursor={onSelect == null ? "default" : "pointer"}
            pointerEvents={onSelect == null ? "none" : "auto"}
            boxShadow={
              isSelected
                ? "0 0 0 2px color-mix(in srgb, var(--app-accent) 28%, transparent)"
                : "0 1px 3px rgba(0, 0, 0, 0.12)"
            }
            touchAction="none"
            zIndex={zIndex}
            onClick={() => onSelect?.(voiceIndex, event.id, event.midi)}
            onPointerDown={(pointerEvent) =>
              onPointerDown?.(pointerEvent, voiceIndex, event.id, midi)
            }
            onPointerMove={onPointerMove}
            onPointerUp={(pointerEvent) => onPointerUp?.(pointerEvent.pointerId)}
            onPointerCancel={(pointerEvent) =>
              onPointerCancel?.(pointerEvent.pointerId)
            }
          >
            <Text fontSize="10px" fontWeight="bold">
              {shortVoiceLabel(voiceIndex, arrangement.voices.length + 1)}
            </Text>
            <Text fontSize="10px" fontWeight="bold">
              {midiToNoteName(midi)}
            </Text>
          </Box>
        );
      }),
  );
}

function findSpanForTick(
  spans: ArrangementEditorSpan[],
  tick: number,
): ArrangementEditorSpan | null {
  for (const span of spans) {
    if (tick >= span.startTick && tick < span.startTick + span.durationTicks) {
      return span;
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

function getEditableMidis(
  currentMidi: MidiNote | null,
  rangeLow: number,
  rangeHigh: number,
): MidiNote[] {
  const candidates: MidiNote[] = [];
  for (let midi = rangeLow; midi <= rangeHigh; midi++) {
    candidates.push(midi);
  }
  if (currentMidi != null && (currentMidi < rangeLow || currentMidi > rangeHigh)) {
    candidates.push(currentMidi);
  }
  return candidates;
}

function shortVoiceLabel(index: number, totalParts: number): string {
  const full = getPartLabel(index, totalParts);
  if (full === "Harmony Low") return "L";
  if (full === "Harmony Mid") return "M";
  if (full === "Harmony High") return "H";
  if (full === "Harmony") return "H";
  return full.slice(0, 1).toUpperCase();
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
    const midi = lines[voiceIndex]?.[chordIndex] ?? null;
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

function clampMidi(value: number, rangeLow: number, rangeHigh: number): MidiNote {
  return Math.max(rangeLow, Math.min(rangeHigh, value)) as MidiNote;
}

export function getVisualSelectionItems(
  lines: HarmonyLine[],
  chordCount: number,
): Array<{
  chordIndex: number;
  voiceIndex: number;
  kind: "note" | "rest";
  midi: MidiNote | null;
}> {
  const items: Array<{
    chordIndex: number;
    voiceIndex: number;
    kind: "note" | "rest";
    midi: MidiNote | null;
  }> = [];

  for (let chordIndex = 0; chordIndex < chordCount; chordIndex++) {
    const noteMembers: Array<{
      chordIndex: number;
      voiceIndex: number;
      kind: "note" | "rest";
      midi: MidiNote;
    }> = [];
    const restMembers: Array<{
      chordIndex: number;
      voiceIndex: number;
      kind: "note" | "rest";
      midi: null;
    }> = [];

    for (let voiceIndex = 0; voiceIndex < lines.length; voiceIndex++) {
      const midi = lines[voiceIndex]?.[chordIndex] ?? null;
      if (midi == null) {
        restMembers.push({ chordIndex, voiceIndex, kind: "rest", midi: null });
      } else {
        noteMembers.push({ chordIndex, voiceIndex, kind: "note", midi });
      }
    }

    noteMembers.sort((left, right) => {
      if (left.midi !== right.midi) return right.midi - left.midi;
      return left.voiceIndex - right.voiceIndex;
    });
    items.push(...noteMembers, ...restMembers);
  }

  return items;
}

export function getNextSelectionInVisualOrder(
  items: readonly {
    chordIndex: number;
    voiceIndex: number;
  }[],
  selection: { chordIndex: number; voiceIndex: number } | null,
  direction: -1 | 1,
): { chordIndex: number; voiceIndex: number } | null {
  if (selection == null) return null;
  const currentIndex = items.findIndex(
    (item) =>
      item.chordIndex === selection.chordIndex &&
      item.voiceIndex === selection.voiceIndex,
  );
  if (currentIndex === -1) return null;
  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return null;
  const nextItem = items[nextIndex];
  return nextItem == null
    ? null
    : { chordIndex: nextItem.chordIndex, voiceIndex: nextItem.voiceIndex };
}

type TypedPitchBufferResult =
  | { nextBuffer: string; commit: "none" }
  | { nextBuffer: string; commit: "rest" }
  | { nextBuffer: string; commit: "note"; midi: MidiNote };

export function reduceTypedPitchBuffer(
  currentBuffer: string,
  key: string,
  selectedCandidates: ReadonlySet<number>,
): TypedPitchBufferResult | null {
  if (key === "Backspace") {
    return { nextBuffer: currentBuffer.slice(0, -1), commit: "none" };
  }

  if (key === "Escape") {
    return { nextBuffer: "", commit: "none" };
  }

  const normalizedChar = normalizeTypedPitchChar(key, currentBuffer);
  if (normalizedChar == null) return null;

  const nextBuffer = currentBuffer + normalizedChar;
  if (nextBuffer === "R") {
    return { nextBuffer: "", commit: "rest" };
  }

  if (!isTypedPitchBufferPrefix(nextBuffer)) {
    return { nextBuffer: currentBuffer, commit: "none" };
  }

  if (!isCompleteTypedPitchBuffer(nextBuffer)) {
    return { nextBuffer, commit: "none" };
  }

  try {
    const midi = noteNameToMidi(nextBuffer);
    if (!selectedCandidates.has(midi)) {
      return { nextBuffer: "", commit: "none" };
    }
    return { nextBuffer: "", commit: "note", midi };
  } catch {
    return { nextBuffer: "", commit: "none" };
  }
}

function normalizeTypedPitchChar(
  key: string,
  currentBuffer: string,
): string | null {
  if (key.length !== 1) return null;
  if ((key === "r" || key === "R") && currentBuffer.length === 0) return "R";
  if (/^[0-9#-]$/.test(key)) return key;
  if (key === "b") return "b";
  if (/^[A-Ga-g]$/.test(key)) {
    if (currentBuffer.length === 0) return key.toUpperCase();
    return key === "b" ? "b" : key.toUpperCase();
  }
  return null;
}

function isTypedPitchBufferPrefix(value: string): boolean {
  return /^(?:[A-G](?:[#b])?(?:-?\d*)?)$/.test(value);
}

function isCompleteTypedPitchBuffer(value: string): boolean {
  return /^([A-G][#b]?)(-?\d+)$/.test(value);
}
