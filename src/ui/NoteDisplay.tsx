import { Box, Text } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { midiToNoteName } from "../music/types";
import type { Chord, HarmonyLine, MidiNote } from "../music/types";
import { playNotePreview } from "../music/playback";
import { dsColors, dsPanel } from "./designSystem";

type Props = {
  ctx: AudioContext;
  chords: Chord[];
  lyricsByChord: string[];
  harmonyLine: HarmonyLine | null; // null for melody part
  activeChordIndex: number;
  currentAbsoluteBeat: number;
  beatsPerBar: number;
  tempo: number;
  transportActive: boolean;
};

const NOTE_ROW_HEIGHT_PX = 22;
const NOTE_TRACK_PAD_TOP_PX = 8;
const NOTE_TRACK_PAD_BOTTOM_PX = 10;
const NOTE_TRACK_PAD_X_PX = 6;
const MEASURE_WIDTH_PX = 80;
const NOTE_PITCH_PADDING = 2;
const LYRIC_LANE_HEIGHT_PX = 34;

type NoteSegment = {
  chordIndex: number;
  startBeat: number;
  beats: number;
  midi: MidiNote;
  noteLabel: string;
};

export function NoteDisplay({
  ctx,
  chords,
  lyricsByChord,
  harmonyLine,
  activeChordIndex,
  currentAbsoluteBeat,
  beatsPerBar,
  tempo,
  transportActive,
}: Props) {
  const lyricSegments = chords.map((chord, index) => ({
    chordIndex: index,
    lyric: lyricsByChord[index] ?? "",
    beats: chord.beats,
  }));
  const hasLyrics = lyricSegments.some((segment) => segment.lyric.trim().length > 0);

  if (harmonyLine == null) {
    return (
      <Box w="100%" p={4} {...dsPanel}>
        <Text color={dsColors.textMuted} fontSize="xs" mb={hasLyrics ? 3 : 0}>
          YOUR NOTES
        </Text>
        {hasLyrics ? (
          <LyricLane
            chords={chords}
            lyricSegments={lyricSegments}
            activeChordIndex={activeChordIndex}
            currentAbsoluteBeat={currentAbsoluteBeat}
            beatsPerBar={beatsPerBar}
            tempo={tempo}
            transportActive={transportActive}
          />
        ) : (
          <Text color={dsColors.textMuted} fontSize="sm" textAlign="center">
            Melody — sing freely over the harmonies
          </Text>
        )}
      </Box>
    );
  }

  function handleNoteClick(midi: MidiNote | undefined) {
    if (midi == null) return;
    playNotePreview(ctx, midi);
  }

  const segments: NoteSegment[] = [];
  let totalBeats = 0;
  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i];
    const beats = chord?.beats ?? 0;
    const midi = harmonyLine[i];
    if (chord != null && midi != null) {
      segments.push({
        chordIndex: i,
        startBeat: totalBeats,
        beats,
        midi,
        noteLabel: midiToNoteName(midi),
      });
    }
    totalBeats += beats;
  }

  if (segments.length === 0 || totalBeats <= 0) {
    return (
      <Box w="100%" p={4} {...dsPanel}>
        <Text color={dsColors.textMuted} fontSize="sm" textAlign="center">
          No harmony notes available for this part yet.
        </Text>
      </Box>
    );
  }

  let minMidi = Number.POSITIVE_INFINITY;
  let maxMidi = Number.NEGATIVE_INFINITY;
  for (const segment of segments) {
    minMidi = Math.min(minMidi, segment.midi);
    maxMidi = Math.max(maxMidi, segment.midi);
  }

  const lowMidi = Math.floor(minMidi) - NOTE_PITCH_PADDING;
  const highMidi = Math.ceil(maxMidi) + NOTE_PITCH_PADDING;
  const pitchRows = Math.max(1, highMidi - lowMidi + 1);
  const trackHeightPx =
    NOTE_TRACK_PAD_TOP_PX +
    NOTE_TRACK_PAD_BOTTOM_PX +
    pitchRows * NOTE_ROW_HEIGHT_PX +
    (hasLyrics ? LYRIC_LANE_HEIGHT_PX : 0);
  const trackWidthPx = Math.max(
    280,
    Math.ceil(
      totalBeats * (MEASURE_WIDTH_PX / Math.max(1, beatsPerBar)) +
        NOTE_TRACK_PAD_X_PX * 2,
    ),
  );

  const safeBeatsPerBar = Math.max(1, beatsPerBar);
  const notePxPerBeat = MEASURE_WIDTH_PX / safeBeatsPerBar;
  const beatGuideCount = Math.max(1, Math.ceil(totalBeats) + 1);
  const hasActiveBeat = currentAbsoluteBeat >= 0;

  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const anchorBeatRef = useRef(currentAbsoluteBeat);
  const anchorTimeMsRef = useRef<number>(performance.now());
  const smoothBeatRef = useRef(hasActiveBeat ? currentAbsoluteBeat : 0);
  const [smoothBeat, setSmoothBeat] = useState(smoothBeatRef.current);

  useEffect(() => {
    if (!hasActiveBeat) {
      smoothBeatRef.current = 0;
      setSmoothBeat(0);
      return;
    }
    const now = performance.now();
    const msPerBeat =
      Number.isFinite(tempo) && tempo > 0 ? (60 / tempo) * 1000 : 0;
    const carry =
      msPerBeat > 0
        ? clamp(smoothBeatRef.current - currentAbsoluteBeat, 0, 0.95)
        : 0;

    anchorBeatRef.current = currentAbsoluteBeat;
    anchorTimeMsRef.current = now - carry * msPerBeat;

    // Re-anchor hard when we're significantly out of range (e.g. transport reset).
    if (
      smoothBeatRef.current < currentAbsoluteBeat - 0.5 ||
      smoothBeatRef.current > currentAbsoluteBeat + 1.5
    ) {
      smoothBeatRef.current = currentAbsoluteBeat;
      setSmoothBeat(currentAbsoluteBeat);
    }
  }, [currentAbsoluteBeat, hasActiveBeat, tempo]);

  useEffect(() => {
    if (
      !transportActive ||
      !hasActiveBeat ||
      !Number.isFinite(tempo) ||
      tempo <= 0
    ) {
      return;
    }
    let rafId = 0;
    const msPerBeat = (60 / tempo) * 1000;

    const tick = () => {
      const elapsed = performance.now() - anchorTimeMsRef.current;
      const progress = Math.max(0, elapsed / msPerBeat);
      const nextBeat = anchorBeatRef.current + progress;
      smoothBeatRef.current = nextBeat;
      setSmoothBeat(nextBeat);
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [transportActive, hasActiveBeat, tempo]);

  const displayBeat =
    transportActive && hasActiveBeat ? smoothBeat : currentAbsoluteBeat;
  const playheadX = hasActiveBeat
    ? NOTE_TRACK_PAD_X_PX + Math.max(0, displayBeat) * notePxPerBeat
    : 0;

  useEffect(() => {
    if (!transportActive || !hasActiveBeat) return;
    const el = scrollViewportRef.current;
    if (el == null) return;

    const maxScroll = Math.max(0, trackWidthPx - el.clientWidth);
    if (maxScroll <= 0) return;

    const target = clamp(playheadX - el.clientWidth * 0.45, 0, maxScroll);
    el.scrollLeft = el.scrollLeft + (target - el.scrollLeft) * 0.22;
  }, [playheadX, transportActive, hasActiveBeat, trackWidthPx]);

  return (
    <Box w="100%" {...dsPanel}>
      <Text
        color={dsColors.textMuted}
        fontSize="xs"
        mb={3}
        fontWeight="semibold"
      >
        YOUR NOTES
      </Text>
      <Box
        w="100%"
        ref={scrollViewportRef}
        className="record-note-timeline"
        borderRadius="xl"
        border="1px solid"
        borderColor={dsColors.border}
        bg={dsColors.surfaceSubtle}
        overflowX="auto"
        overflowY="hidden"
      >
        <Box
          position="relative"
          w={`${trackWidthPx}px`}
          h={`${trackHeightPx}px`}
        >
          {Array.from({ length: pitchRows }).map((_, row) => {
            const y = NOTE_TRACK_PAD_TOP_PX + row * NOTE_ROW_HEIGHT_PX;
            return (
              <Box
                key={`pitch-row-${row}`}
                className="record-note-pitch-line"
                position="absolute"
                left={0}
                right={0}
                top={`${y}px`}
              />
            );
          })}

          {Array.from({ length: beatGuideCount }).map((_, beat) => {
            const x = NOTE_TRACK_PAD_X_PX + beat * notePxPerBeat;
            return (
              <Box
                key={`beat-guide-${beat}`}
                className="record-note-beat-line"
                position="absolute"
                top={0}
                bottom={0}
                left={`${x}px`}
              />
            );
          })}

          {hasActiveBeat && (
            <Box
              className="record-note-playhead"
              position="absolute"
              top={0}
              bottom={0}
              left={`${playheadX}px`}
            />
          )}

          {segments.map((segment) => {
            const rowFromTop = highMidi - segment.midi;
            const y =
              NOTE_TRACK_PAD_TOP_PX + rowFromTop * NOTE_ROW_HEIGHT_PX + 2;
            const x =
              NOTE_TRACK_PAD_X_PX + segment.startBeat * notePxPerBeat + 2;
            const w = Math.max(26, segment.beats * notePxPerBeat - 4);
            const h = Math.max(16, NOTE_ROW_HEIGHT_PX - 4);
            const isActive = segment.chordIndex === activeChordIndex;

            return (
              <Box
                key={`segment-${segment.chordIndex}`}
                className={`record-note-block${isActive ? " is-active" : ""}`}
                position="absolute"
                top={`${y}px`}
                left={`${x}px`}
                w={`${w}px`}
                h={`${h}px`}
                px={2}
                borderRadius="md"
                onClick={() => handleNoteClick(segment.midi)}
                userSelect="none"
                display="flex"
                alignItems="center"
                justifyContent="flex-start"
                overflow="hidden"
              >
                <Text
                  color={isActive ? dsColors.accentForeground : dsColors.text}
                  fontSize="sm"
                  fontWeight="semibold"
                  lineHeight="1"
                  whiteSpace="nowrap"
                >
                  {segment.noteLabel}
                </Text>
              </Box>
            );
          })}

          {hasLyrics &&
            renderLyricSegments({
              chords,
              lyricSegments,
              activeChordIndex,
              notePxPerBeat,
            })}
        </Box>
      </Box>
    </Box>
  );
}

type LyricSegment = {
  chordIndex: number;
  lyric: string;
  beats: number;
};

type LyricLaneProps = {
  chords: Chord[];
  lyricSegments: LyricSegment[];
  activeChordIndex: number;
  currentAbsoluteBeat: number;
  beatsPerBar: number;
  tempo: number;
  transportActive: boolean;
};

function LyricLane({
  chords,
  lyricSegments,
  activeChordIndex,
  currentAbsoluteBeat,
  beatsPerBar,
  tempo,
  transportActive,
}: LyricLaneProps) {
  const totalBeats = chords.reduce((sum, chord) => sum + chord.beats, 0);
  const trackWidthPx = Math.max(
    280,
    Math.ceil(
      totalBeats * (MEASURE_WIDTH_PX / Math.max(1, beatsPerBar)) +
        NOTE_TRACK_PAD_X_PX * 2,
    ),
  );
  const notePxPerBeat = MEASURE_WIDTH_PX / Math.max(1, beatsPerBar);
  const beatGuideCount = Math.max(1, Math.ceil(totalBeats) + 1);
  const hasActiveBeat = currentAbsoluteBeat >= 0;
  const playheadX = hasActiveBeat
    ? NOTE_TRACK_PAD_X_PX + Math.max(0, currentAbsoluteBeat) * notePxPerBeat
    : 0;

  return (
    <Box
      borderRadius="xl"
      border="1px solid"
      borderColor={dsColors.border}
      bg={dsColors.surfaceSubtle}
      overflowX="auto"
      overflowY="hidden"
    >
      <Box position="relative" w={`${trackWidthPx}px`} h={`${LYRIC_LANE_HEIGHT_PX}px`}>
        {Array.from({ length: beatGuideCount }).map((_, beat) => {
          const x = NOTE_TRACK_PAD_X_PX + beat * notePxPerBeat;
          return (
            <Box
              key={`melody-lyric-guide-${beat}`}
              className="record-note-beat-line"
              position="absolute"
              top={0}
              bottom={0}
              left={`${x}px`}
            />
          );
        })}
        {hasActiveBeat && transportActive && (
          <Box
            className="record-note-playhead"
            position="absolute"
            top={0}
            bottom={0}
            left={`${playheadX}px`}
          />
        )}
        {renderLyricSegments({
          chords,
          lyricSegments,
          activeChordIndex,
          notePxPerBeat,
        })}
      </Box>
    </Box>
  );
}

function renderLyricSegments(input: {
  chords: Chord[];
  lyricSegments: LyricSegment[];
  activeChordIndex: number;
  notePxPerBeat: number;
}) {
  const { chords, lyricSegments, activeChordIndex, notePxPerBeat } = input;
  let startBeat = 0;
  let activeStartBeat = 0;
  let activeBeats = 0;

  for (let index = 0; index < lyricSegments.length; index++) {
    const chord = chords[index];
    if (index === activeChordIndex) {
      activeStartBeat = startBeat;
      activeBeats = chord?.beats ?? lyricSegments[index]?.beats ?? 0;
      break;
    }
    startBeat += chord?.beats ?? 0;
  }

  const currentSegment = lyricSegments[activeChordIndex];
  const nextSegment = lyricSegments[activeChordIndex + 1];
  const currentLyric = currentSegment?.lyric.trim() ?? "";
  const nextLyric = nextSegment?.lyric.trim() ?? "";

  if (currentLyric.length === 0 && nextLyric.length === 0) {
    return null;
  }

  const x = NOTE_TRACK_PAD_X_PX + activeStartBeat * notePxPerBeat + 2;
  const minW = Math.max(48, activeBeats * notePxPerBeat - 4);

  return (
    <Box
      key={`lyric-cue-${activeChordIndex}`}
      position="absolute"
      left={`${x}px`}
      bottom="6px"
      minW={`${minW}px`}
      maxW={`calc(100% - ${x + 12}px)`}
      px={3}
      py={2}
      borderRadius="lg"
      bg="rgba(255, 255, 255, 0.92)"
      border="1px solid"
      borderColor="rgba(148, 163, 184, 0.45)"
      boxShadow="sm"
      zIndex={2}
      overflow="hidden"
    >
      <Box display="flex" alignItems="baseline" gap={3} whiteSpace="nowrap">
        {currentLyric.length > 0 && (
          <Text
            color={dsColors.text}
            fontSize="sm"
            fontWeight="bold"
            lineHeight="1.2"
            flexShrink={0}
          >
            {currentLyric}
          </Text>
        )}
        {nextLyric.length > 0 && (
          <Text
            color={dsColors.textMuted}
            fontSize="sm"
            lineHeight="1.2"
            opacity={0.72}
            overflow="hidden"
            textOverflow="ellipsis"
          >
            {nextLyric}
          </Text>
        )}
      </Box>
    </Box>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
