import {
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Progress,
  Stack,
  Text,
} from "@chakra-ui/react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useObservable } from "../observable";
import {
  appScreen,
  audioContext,
  currentPartIndex,
  parsedChords,
  partStates,
  resetSession,
  tempoInput,
  updatePartState,
} from "../state/appState";
import type { PartIndex } from "../music/types";
import { PART_LABELS } from "../music/types";
import { progressionDurationSec } from "../music/playback";
import { startCompositor } from "../video/compositor";
import type { CompositorHandle } from "../video/compositor";
import { exportWebM } from "../video/exporter";
import { createMixer } from "../audio/mixer";
import type { Mixer } from "../audio/mixer";
import {
  buildWaveformPeaks,
  deleteSegmentById,
  getActiveSegmentAtTime,
  getSegmentEndSec,
  getTimelineEndSec,
  moveSegmentWithClamp,
  samplePeaksForSegment,
  snapTimeSec,
  splitSegmentAtPlayhead,
} from "./timeline";
import type {
  EditorSelection,
  TimelineSegment,
  TrackTimeline,
  WaveformPeaks,
} from "./timeline";

const TRACK_COUNT = 4;
const PLAYBACK_SCHEDULE_LEAD_SEC = 0.05;
const TIMELINE_PX_PER_SEC = 110;
const TIMELINE_RIGHT_PAD_PX = 48;
const LANE_HEIGHT_PX = 72;
const TRACK_RAIL_WIDTH_PX = 72;

type ActiveAudioSource = {
  source: AudioBufferSourceNode;
};

type PlaybackClock = {
  mode: "idle" | "preview" | "export";
  startCtxTime: number;
  startTimelineSec: number;
  endTimelineSec: number;
  rafId: number | null;
};

export function FinalReview() {
  const states = useObservable(partStates);
  const chords = useObservable(parsedChords);
  const tempo = useObservable(tempoInput);
  const ctx = useObservable(audioContext);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timelineViewportRef = useRef<HTMLDivElement>(null);

  const videoRefs = useRef<(HTMLVideoElement | null)[]>([null, null, null, null]);
  const activeVideoMaskRef = useRef<boolean[]>([false, false, false, false]);
  const compositorRef = useRef<CompositorHandle | null>(null);
  const mixerRef = useRef<Mixer | null>(null);

  const audioBuffersRef = useRef<(AudioBuffer | null)[]>([null, null, null, null]);
  const laneSourceStartRef = useRef<number[]>([0, 0, 0, 0]);
  const laneSourceDurationRef = useRef<number[]>([0, 0, 0, 0]);
  const waveformPeaksRef = useRef<WaveformPeaks[]>([[], [], [], []]);

  const activeSourcesRef = useRef<ActiveAudioSource[]>([]);

  const playbackClockRef = useRef<PlaybackClock>({
    mode: "idle",
    startCtxTime: 0,
    startTimelineSec: 0,
    endTimelineSec: 0,
    rafId: null,
  });

  const segmentIdCounterRef = useRef(0);
  const timelinesRef = useRef<TrackTimeline[]>([[], [], [], []]);

  const [timelines, setTimelines] = useState<TrackTimeline[]>([[], [], [], []]);
  const [selection, setSelection] = useState<EditorSelection>({
    laneIndex: null,
    segmentId: null,
  });
  const [playheadSec, setPlayheadSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [snapToBeat, setSnapToBeat] = useState(false);

  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);
  const [waveformVersion, setWaveformVersion] = useState(0);

  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportedUrl, setExportedUrl] = useState<string | null>(null);

  const [volumes, setVolumes] = useState<number[]>([1, 1, 1, 1]);
  const [muted, setMuted] = useState<boolean[]>([false, false, false, false]);
  const [reverbWet, setReverbWet] = useState(0.15);

  const baseDurationSec = progressionDurationSec(chords, tempo);
  const beatSec = tempo > 0 ? 60 / tempo : 0;

  const timelineEndSec = useMemo(() => {
    return getTimelineEndSec(timelines);
  }, [timelines]);

  const timelineContentWidthPx = useMemo(() => {
    const minContent = Math.max(1, timelineEndSec) * TIMELINE_PX_PER_SEC + TIMELINE_RIGHT_PAD_PX;
    return Math.max(timelineViewportWidth, Math.ceil(minContent));
  }, [timelineEndSec, timelineViewportWidth]);

  const beatLineTimes = useMemo(() => {
    if (beatSec <= 0 || timelineEndSec <= 0) return [] as number[];
    const lines: number[] = [];
    for (let t = 0; t <= timelineEndSec + 0.0001; t += beatSec) {
      lines.push(t);
    }
    return lines;
  }, [beatSec, timelineEndSec]);

  timelinesRef.current = timelines;

  const makeSegmentId = useCallback((): string => {
    segmentIdCounterRef.current += 1;
    return `segment-${segmentIdCounterRef.current}`;
  }, []);

  const syncVideosToTimeline = useCallback((timelineSec: number, shouldPlay: boolean) => {
    const nextMask = [false, false, false, false];

    for (let lane = 0; lane < TRACK_COUNT; lane++) {
      const track = timelinesRef.current[lane] ?? [];
      const segment = getActiveSegmentAtTime(track, timelineSec);
      const video = videoRefs.current[lane];
      if (video == null || segment == null) {
        if (video != null) {
          video.pause();
        }
        continue;
      }

      const laneTime = timelineSec - segment.timelineStartSec;
      const desiredSourceTime = segment.sourceStartSec + laneTime;
      if (!Number.isFinite(desiredSourceTime)) {
        video.pause();
        continue;
      }

      nextMask[lane] = true;

      if (Math.abs(video.currentTime - desiredSourceTime) > 0.045) {
        try {
          video.currentTime = desiredSourceTime;
        } catch {
          // Some browsers can throw while metadata is still loading.
        }
      }

      if (shouldPlay) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    }

    activeVideoMaskRef.current = nextMask;
  }, []);

  const stopAudio = useCallback(() => {
    for (const entry of activeSourcesRef.current) {
      try {
        entry.source.stop();
      } catch {
        // Safe to ignore if already stopped.
      }
    }
    activeSourcesRef.current = [];
  }, []);

  const stopClock = useCallback(() => {
    const clock = playbackClockRef.current;
    if (clock.rafId != null) {
      cancelAnimationFrame(clock.rafId);
    }
    playbackClockRef.current = {
      mode: "idle",
      startCtxTime: 0,
      startTimelineSec: 0,
      endTimelineSec: 0,
      rafId: null,
    };
  }, []);

  const stopPlaybackEngine = useCallback((preservePlayhead: boolean) => {
    stopClock();
    stopAudio();
    setIsPlaying(false);

    for (const video of videoRefs.current) {
      video?.pause();
    }
    activeVideoMaskRef.current = [false, false, false, false];

    if (!preservePlayhead) {
      setPlayheadSec(0);
      syncVideosToTimeline(0, false);
    }
  }, [stopAudio, stopClock, syncVideosToTimeline]);

  const runPreviewTick = useCallback(() => {
    const clock = playbackClockRef.current;
    if (clock.mode !== "preview" || ctx == null) return;

    const elapsed = Math.max(0, ctx.currentTime - clock.startCtxTime);
    const timelineNow = clock.startTimelineSec + elapsed;
    const clampedNow = Math.min(timelineNow, clock.endTimelineSec);

    setPlayheadSec(clampedNow);
    syncVideosToTimeline(clampedNow, true);

    if (timelineNow >= clock.endTimelineSec - 0.001) {
      stopAudio();
      stopClock();
      setIsPlaying(false);
      setPlayheadSec(clock.endTimelineSec);
      syncVideosToTimeline(clock.endTimelineSec, false);
      return;
    }

    clock.rafId = requestAnimationFrame(runPreviewTick);
  }, [ctx, stopAudio, stopClock, syncVideosToTimeline]);

  const runExportTick = useCallback(() => {
    const clock = playbackClockRef.current;
    if (clock.mode !== "export" || ctx == null) return;

    const elapsed = Math.max(0, ctx.currentTime - clock.startCtxTime);
    const timelineNow = clock.startTimelineSec + elapsed;
    const clampedNow = Math.min(timelineNow, clock.endTimelineSec);

    setPlayheadSec(clampedNow);
    syncVideosToTimeline(clampedNow, true);

    if (timelineNow >= clock.endTimelineSec - 0.001) {
      stopClock();
      syncVideosToTimeline(clock.endTimelineSec, false);
      return;
    }

    clock.rafId = requestAnimationFrame(runExportTick);
  }, [ctx, stopClock, syncVideosToTimeline]);

  const startPlaybackClock = useCallback((
    mode: "preview" | "export",
    startCtxTime: number,
    startTimelineSec: number,
    endTimelineSec: number,
  ) => {
    stopClock();
    playbackClockRef.current = {
      mode,
      startCtxTime,
      startTimelineSec,
      endTimelineSec,
      rafId: null,
    };

    if (mode === "preview") {
      playbackClockRef.current.rafId = requestAnimationFrame(runPreviewTick);
    } else {
      playbackClockRef.current.rafId = requestAnimationFrame(runExportTick);
    }
  }, [runExportTick, runPreviewTick, stopClock]);

  const startAudioFromTimeline = useCallback((
    startCtxTime: number,
    startTimelineSec: number,
    endTimelineSec: number,
  ) => {
    if (ctx == null || mixerRef.current == null) return;

    stopAudio();

    for (let lane = 0; lane < TRACK_COUNT; lane++) {
      const buffer = audioBuffersRef.current[lane];
      if (buffer == null) continue;

      const track = timelinesRef.current[lane] ?? [];
      for (const segment of track) {
        const segStart = segment.timelineStartSec;
        const segEnd = getSegmentEndSec(segment);
        if (segEnd <= startTimelineSec || segStart >= endTimelineSec) continue;

        const playFrom = Math.max(startTimelineSec, segStart);
        const playTo = Math.min(endTimelineSec, segEnd);
        const playDuration = playTo - playFrom;
        if (playDuration <= 0) continue;

        const sourceOffset = segment.sourceStartSec + (playFrom - segStart);
        if (sourceOffset >= buffer.duration) continue;

        const cappedDuration = Math.min(playDuration, buffer.duration - sourceOffset);
        if (cappedDuration <= 0) continue;

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        mixerRef.current.connectSource(lane, source);

        const startAt = startCtxTime + (playFrom - startTimelineSec);
        source.start(startAt, sourceOffset, cappedDuration);
        activeSourcesRef.current.push({ source });
      }
    }
  }, [ctx, stopAudio]);

  function findSegmentBySelection(sel: EditorSelection): TimelineSegment | null {
    if (sel.laneIndex == null || sel.segmentId == null) return null;
    const track = timelines[sel.laneIndex] ?? [];
    return track.find((segment) => segment.id === sel.segmentId) ?? null;
  }

  // Build video elements, mixer, compositor and decode track audio once.
  useEffect(() => {
    if (ctx == null) return;

    let cancelled = false;
    const videos: HTMLVideoElement[] = [];

    audioBuffersRef.current = [null, null, null, null];
    laneSourceStartRef.current = [0, 0, 0, 0];
    laneSourceDurationRef.current = [0, 0, 0, 0];
    waveformPeaksRef.current = [[], [], [], []];
    setTimelines([[], [], [], []]);
    setSelection({ laneIndex: null, segmentId: null });
    setPlayheadSec(0);

    for (let i = 0; i < TRACK_COUNT; i++) {
      const state = states[i];
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.loop = false;
      video.preload = "auto";
      if (state != null && state.status === "kept") {
        video.src = state.url;
      }
      videoRefs.current[i] = video;
      videos.push(video);
    }

    const mixer = createMixer(ctx, TRACK_COUNT);
    for (let i = 0; i < TRACK_COUNT; i++) {
      mixer.setTrackVolume(i, volumes[i] ?? 1);
      mixer.setTrackMuted(i, muted[i] ?? false);
    }
    mixer.setReverbWet(reverbWet);
    mixerRef.current = mixer;

    if (canvasRef.current != null) {
      compositorRef.current = startCompositor(canvasRef.current, videos, {
        isVideoActive: (index) => activeVideoMaskRef.current[index] ?? false,
      });
    }

    for (let i = 0; i < TRACK_COUNT; i++) {
      const state = states[i];
      if (state == null || state.status !== "kept") continue;

      const laneIndex = i;
      const trimOffsetSec = Math.max(0, state.trimOffsetSec);

      void state.blob
        .arrayBuffer()
        .then((ab) => {
          if (cancelled) return null;
          return ctx.decodeAudioData(ab);
        })
        .then((buffer) => {
          if (cancelled || buffer == null) return;

          const sourceStartSec = Math.min(trimOffsetSec, buffer.duration);
          const rawDuration = Math.max(0, buffer.duration - sourceStartSec);
          const laneDurationSec = Math.max(
            0,
            Math.min(rawDuration, Math.max(0, baseDurationSec)),
          );

          audioBuffersRef.current[laneIndex] = buffer;
          laneSourceStartRef.current[laneIndex] = sourceStartSec;
          laneSourceDurationRef.current[laneIndex] = laneDurationSec;
          waveformPeaksRef.current[laneIndex] = buildWaveformPeaks(
            buffer,
            sourceStartSec,
            laneDurationSec,
            400,
          );
          setWaveformVersion((v) => v + 1);

          if (laneDurationSec <= 0) return;

          const firstSegmentId = makeSegmentId();
          setTimelines((prev) => {
            const track = prev[laneIndex] ?? [];
            if (track.length > 0) return prev;
            const next = [...prev];
            next[laneIndex] = [
              {
                id: firstSegmentId,
                laneIndex,
                timelineStartSec: 0,
                sourceStartSec,
                durationSec: laneDurationSec,
              },
            ];
            return next;
          });

          setSelection((prev) => {
            if (prev.segmentId != null) return prev;
            return { laneIndex, segmentId: firstSegmentId };
          });
        })
        .catch(() => {
          // Keep lane empty if decoding fails.
        });
    }

    return () => {
      cancelled = true;
      stopPlaybackEngine(false);

      compositorRef.current?.stop();
      compositorRef.current = null;

      mixerRef.current?.dispose();
      mixerRef.current = null;

      for (const video of videos) {
        video.pause();
        video.src = "";
      }
    };
  }, [
    baseDurationSec,
    ctx,
    makeSegmentId,
    states,
    stopPlaybackEngine,
  ]);

  // Keep mixer graph in sync with UI controls after mount.
  useEffect(() => {
    const mixer = mixerRef.current;
    if (mixer == null) return;
    for (let i = 0; i < TRACK_COUNT; i++) {
      mixer.setTrackVolume(i, volumes[i] ?? 1);
      mixer.setTrackMuted(i, muted[i] ?? false);
    }
    mixer.setReverbWet(reverbWet);
  }, [muted, reverbWet, volumes]);

  // Keep a current frame visible while paused.
  useEffect(() => {
    if (isPlaying || exporting) return;
    syncVideosToTimeline(playheadSec, false);
  }, [exporting, isPlaying, playheadSec, syncVideosToTimeline, timelines, waveformVersion]);

  // Ensure selection always points to an existing segment.
  useEffect(() => {
    const selected = findSegmentBySelection(selection);
    if (selected != null) return;

    for (let lane = 0; lane < TRACK_COUNT; lane++) {
      const first = timelines[lane]?.[0] ?? null;
      if (first != null) {
        if (selection.laneIndex === lane && selection.segmentId === first.id) {
          return;
        }
        setSelection({ laneIndex: lane, segmentId: first.id });
        return;
      }
    }

    if (selection.laneIndex != null || selection.segmentId != null) {
      setSelection({ laneIndex: null, segmentId: null });
    }
  }, [selection, timelines]);

  // Track timeline viewport width for responsive content width.
  useEffect(() => {
    const el = timelineViewportRef.current;
    if (el == null) return;

    const update = () => setTimelineViewportWidth(el.clientWidth);
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      stopPlaybackEngine(false);
    };
  }, [stopPlaybackEngine]);

  function handlePlayPause() {
    if (exporting || ctx == null) return;
    if (timelineEndSec <= 0) return;

    if (isPlaying) {
      stopPlaybackEngine(true);
      return;
    }

    const startTimelineSec = playheadSec >= timelineEndSec ? 0 : playheadSec;
    const startCtxTime = ctx.currentTime + PLAYBACK_SCHEDULE_LEAD_SEC;

    setPlayheadSec(startTimelineSec);
    startAudioFromTimeline(startCtxTime, startTimelineSec, timelineEndSec);
    startPlaybackClock("preview", startCtxTime, startTimelineSec, timelineEndSec);
    setIsPlaying(true);
  }

  function handleSplitAtPlayhead() {
    if (exporting) return;
    if (selection.laneIndex == null) return;

    if (isPlaying) {
      stopPlaybackEngine(true);
    }

    const lane = selection.laneIndex;
    let selectedSegmentId: string | null = null;

    setTimelines((prev) => {
      const track = prev[lane] ?? [];
      const split = splitSegmentAtPlayhead(track, playheadSec, makeSegmentId);
      if (split == null) return prev;
      const next = [...prev];
      next[lane] = split;
      const atPlayhead = split.find(
        (segment) => Math.abs(segment.timelineStartSec - playheadSec) < 0.0005,
      );
      selectedSegmentId = atPlayhead?.id ?? split[0]?.id ?? null;
      return next;
    });

    if (selectedSegmentId != null) {
      setSelection({ laneIndex: lane, segmentId: selectedSegmentId });
    }
  }

  function handleDeleteSelectedSegment() {
    if (exporting) return;
    if (selection.laneIndex == null || selection.segmentId == null) return;

    if (isPlaying) {
      stopPlaybackEngine(true);
    }

    const lane = selection.laneIndex;
    const segmentId = selection.segmentId;
    let nextSegmentId: string | null = null;

    setTimelines((prev) => {
      const track = prev[lane] ?? [];
      const nextTrack = deleteSegmentById(track, segmentId);
      if (nextTrack.length === track.length) return prev;
      const next = [...prev];
      next[lane] = nextTrack;

      const after = nextTrack.find((segment) => segment.timelineStartSec >= playheadSec);
      nextSegmentId = after?.id ?? nextTrack[nextTrack.length - 1]?.id ?? null;
      return next;
    });

    if (nextSegmentId != null) {
      setSelection({ laneIndex: lane, segmentId: nextSegmentId });
    } else {
      setSelection({ laneIndex: null, segmentId: null });
    }
  }

  function handleLaneClick(e: ReactPointerEvent<HTMLDivElement>, laneIndex: number) {
    if (exporting) return;
    if (isPlaying) return;

    const viewport = timelineViewportRef.current;
    if (viewport == null) return;

    const rect = viewport.getBoundingClientRect();
    const contentX = e.clientX - rect.left + viewport.scrollLeft;
    const unclampedTime = contentX / TIMELINE_PX_PER_SEC;
    const nextPlayhead = Math.max(0, Math.min(unclampedTime, timelineEndSec));

    setSelection((prev) => ({ laneIndex, segmentId: prev.segmentId }));
    setPlayheadSec(nextPlayhead);
  }

  function handleSegmentPointerDown(
    e: ReactPointerEvent<HTMLDivElement>,
    laneIndex: number,
    segment: TimelineSegment,
  ) {
    e.stopPropagation();
    if (exporting || isPlaying) return;

    setSelection({ laneIndex, segmentId: segment.id });

    const startClientX = e.clientX;
    const originStartSec = segment.timelineStartSec;

    const onMove = (event: PointerEvent) => {
      const deltaPx = event.clientX - startClientX;
      const deltaSec = deltaPx / TIMELINE_PX_PER_SEC;
      let desiredStartSec = originStartSec + deltaSec;

      if (snapToBeat) {
        desiredStartSec = snapTimeSec(desiredStartSec, beatSec);
      }

      setTimelines((prev) => {
        const track = prev[laneIndex] ?? [];
        const moved = moveSegmentWithClamp(track, segment.id, desiredStartSec);
        if (moved === track) return prev;
        const next = [...prev];
        next[laneIndex] = moved;
        return next;
      });
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function handleSeek(valueSec: number) {
    if (isPlaying || exporting) return;
    const next = Math.max(0, Math.min(valueSec, timelineEndSec));
    setPlayheadSec(next);
  }

  function handleVolumeChange(index: number, value: number) {
    const next = [...volumes];
    next[index] = value;
    setVolumes(next);
    mixerRef.current?.setTrackVolume(index, value);
  }

  function handleMuteToggle(index: number) {
    const next = [...muted];
    next[index] = !(next[index] ?? false);
    setMuted(next);
    mixerRef.current?.setTrackMuted(index, next[index] ?? false);
  }

  function handleReverbChange(wet: number) {
    setReverbWet(wet);
    mixerRef.current?.setReverbWet(wet);
  }

  function handleRedoPart(index: number) {
    stopPlaybackEngine(false);
    updatePartState(index, { status: "idle" });
    currentPartIndex.set(index as PartIndex);
    appScreen.set("recording");
  }

  async function handleExport() {
    const mixer = mixerRef.current;
    if (ctx == null || canvasRef.current == null || mixer == null) return;
    if (timelineEndSec <= 0) return;

    stopPlaybackEngine(false);
    setExporting(true);
    setExportProgress(0);
    setPlayheadSec(0);

    const startCtxTime = ctx.currentTime + PLAYBACK_SCHEDULE_LEAD_SEC;
    startAudioFromTimeline(startCtxTime, 0, timelineEndSec);
    startPlaybackClock("export", startCtxTime, 0, timelineEndSec);

    try {
      const blob = await exportWebM({
        canvas: canvasRef.current,
        audioContext: ctx,
        mixer,
        durationMs: timelineEndSec * 1000,
        onProgress: setExportProgress,
      });

      const nextUrl = URL.createObjectURL(blob);
      setExportedUrl((prev) => {
        if (prev != null) {
          URL.revokeObjectURL(prev);
        }
        return nextUrl;
      });
    } catch (err) {
      console.error("Export failed", err);
    } finally {
      stopPlaybackEngine(false);
      setExporting(false);
    }
  }

  function handleDownload() {
    if (exportedUrl == null) return;
    const a = document.createElement("a");
    a.href = exportedUrl;
    a.download = "hum-harmony.webm";
    a.click();
  }

  function handleStartOver() {
    stopPlaybackEngine(false);
    resetSession();
    appScreen.set("setup");
  }

  const selectedSegment = findSegmentBySelection(selection);
  const canDelete = selectedSegment != null;
  const canSplit =
    selection.laneIndex != null &&
    getActiveSegmentAtTime(timelines[selection.laneIndex] ?? [], playheadSec) != null;

  return (
    <Flex minH="100vh" bg="gray.950" align="center" justify="center" px={4} py={8}>
      <Box w="100%" maxW="980px">
        <Stack gap={6}>
          <Box>
            <Heading size="xl" color="white">
              Final Review
            </Heading>
            <Text color="gray.500" fontSize="sm" mt={1}>
              Edit four synced A/V tracks before exporting
            </Text>
          </Box>

          <Flex direction={{ base: "column", lg: "row" }} gap={6} align="start">
            <Box
              borderRadius="xl"
              overflow="hidden"
              bg="black"
              w={{ base: "100%", lg: "min(46%, calc(70vh * 9 / 16))" }}
              aspectRatio="9/16"
              flexShrink={0}
              mx={{ base: "auto", lg: 0 }}
            >
              <canvas
                ref={canvasRef}
                style={{ width: "100%", height: "100%", display: "block" }}
              />
            </Box>

            <Box flex="1" minW={0}>
              <Stack gap={0}>
                <Box
                  borderRadius="md"
                  borderWidth="1px"
                  borderColor="whiteAlpha.200"
                  bg="gray.900"
                  overflow="hidden"
                  boxShadow="0 1px 2px rgba(0, 0, 0, 0.35)"
                >
                  <Flex
                    align="center"
                    justify="space-between"
                    gap={3}
                    px={3}
                    py={2}
                    borderBottomWidth="1px"
                    borderColor="whiteAlpha.100"
                  >
                    <Text fontSize="xs" fontWeight="medium" color="gray.400" letterSpacing="0.02em">
                      Tracks
                    </Text>
                    <Box
                      as="span"
                      fontSize="xs"
                      color="gray.500"
                      fontFamily="mono"
                      fontVariantNumeric="tabular-nums"
                    >
                      {formatTime(playheadSec)}
                      <Box as="span" color="gray.600">
                        {" "}
                        / {formatTime(timelineEndSec)}
                      </Box>
                    </Box>
                  </Flex>

                  <Flex
                    gap={1.5}
                    flexWrap="wrap"
                    px={3}
                    py={2}
                    borderBottomWidth="1px"
                    borderColor="whiteAlpha.100"
                  >
                    <Button
                      colorPalette={isPlaying ? "gray" : "brand"}
                      variant={isPlaying ? "outline" : "solid"}
                      size="sm"
                      h={8}
                      px={3}
                      fontSize="xs"
                      fontWeight="medium"
                      onClick={handlePlayPause}
                      disabled={exporting || timelineEndSec <= 0}
                    >
                      {isPlaying ? "Pause" : "Play"}
                    </Button>
                    <Button
                      size="sm"
                      h={8}
                      px={3}
                      variant="outline"
                      borderColor="whiteAlpha.200"
                      color="gray.300"
                      _hover={{ bg: "whiteAlpha.50" }}
                      fontSize="xs"
                      fontWeight="normal"
                      onClick={handleSplitAtPlayhead}
                      disabled={exporting || !canSplit}
                    >
                      Split
                    </Button>
                    <Button
                      size="sm"
                      h={8}
                      px={3}
                      variant="outline"
                      borderColor="whiteAlpha.200"
                      color="gray.300"
                      _hover={{ bg: "whiteAlpha.50" }}
                      fontSize="xs"
                      fontWeight="normal"
                      onClick={handleDeleteSelectedSegment}
                      disabled={exporting || !canDelete}
                    >
                      Delete
                    </Button>
                    <Button
                      size="sm"
                      h={8}
                      px={3}
                      variant={snapToBeat ? "solid" : "outline"}
                      colorPalette={snapToBeat ? "brand" : "gray"}
                      borderColor="whiteAlpha.200"
                      fontSize="xs"
                      fontWeight="normal"
                      onClick={() => setSnapToBeat((v) => !v)}
                      disabled={exporting || isPlaying}
                    >
                      Snap {snapToBeat ? "on" : "off"}
                    </Button>
                  </Flex>

                  <Flex align="stretch" minH={0}>
                    <Box
                      flexShrink={0}
                      w={`${TRACK_RAIL_WIDTH_PX}px`}
                      borderRightWidth="1px"
                      borderColor="whiteAlpha.100"
                      bg="blackAlpha.300"
                    >
                      {Array.from({ length: TRACK_COUNT }).map((_, lane) => (
                        <Flex
                          key={`rail-${lane}`}
                          h={`${LANE_HEIGHT_PX}px`}
                          align="center"
                          justify="center"
                          borderBottomWidth="1px"
                          borderColor="whiteAlpha.50"
                          px={2}
                        >
                          <Text
                            fontSize="10px"
                            fontWeight="medium"
                            color="gray.500"
                            textAlign="center"
                            lineHeight="1.25"
                            textTransform="uppercase"
                            letterSpacing="0.06em"
                          >
                            {PART_LABELS[lane as PartIndex]}
                          </Text>
                        </Flex>
                      ))}
                    </Box>

                    <Box
                      ref={timelineViewportRef}
                      overflowX="auto"
                      overflowY="hidden"
                      flex={1}
                      minW={0}
                      bg="#0c0c0e"
                    >
                      <Box
                        position="relative"
                        w={`${timelineContentWidthPx}px`}
                        h={`${TRACK_COUNT * LANE_HEIGHT_PX}px`}
                      >
                        {Array.from({ length: TRACK_COUNT }).map((_, lane) => {
                          const track = timelines[lane] ?? [];
                          const peaks = waveformPeaksRef.current[lane] ?? [];
                          const laneStart = laneSourceStartRef.current[lane] ?? 0;
                          const laneDuration = laneSourceDurationRef.current[lane] ?? 0;
                          const laneClass =
                            `timeline-lane ${selection.laneIndex === lane ? "is-selected-lane" : ""}` +
                            (lane % 2 === 0 ? " is-alt" : "");

                          return (
                            <Box
                              key={lane}
                              className={laneClass}
                              position="absolute"
                              left={0}
                              right={0}
                              top={`${lane * LANE_HEIGHT_PX}px`}
                              h={`${LANE_HEIGHT_PX - 1}px`}
                              onPointerDown={(e) => handleLaneClick(e, lane)}
                            >
                              {beatLineTimes.map((line, index) => (
                                <Box
                                  key={`${lane}-beat-${index}`}
                                  className="timeline-beat"
                                  left={`${line * TIMELINE_PX_PER_SEC}px`}
                                />
                              ))}

                              {track.map((segment) => {
                                const leftPx = segment.timelineStartSec * TIMELINE_PX_PER_SEC;
                                const widthPx = Math.max(8, segment.durationSec * TIMELINE_PX_PER_SEC);
                                const isSelected = selection.segmentId === segment.id;

                                const bars = Math.max(8, Math.min(220, Math.floor(widthPx / 5)));
                                const relativeSourceStart = Math.max(
                                  0,
                                  segment.sourceStartSec - laneStart,
                                );
                                const samples = samplePeaksForSegment(
                                  peaks,
                                  laneDuration,
                                  relativeSourceStart,
                                  segment.durationSec,
                                  bars,
                                );

                                return (
                                  <Box
                                    key={segment.id}
                                    className={`timeline-segment ${isSelected ? "is-selected" : ""}`}
                                    left={`${leftPx}px`}
                                    w={`${widthPx}px`}
                                    onPointerDown={(e) => handleSegmentPointerDown(e, lane, segment)}
                                  >
                                    <Box className="segment-waveform">
                                      {samples.map((sample, idx) => (
                                        <Box
                                          key={`${segment.id}-${idx}`}
                                          className="segment-bar"
                                          h={`${Math.max(12, Math.round(sample * 100))}%`}
                                        />
                                      ))}
                                    </Box>
                                  </Box>
                                );
                              })}
                            </Box>
                          );
                        })}

                        <Box
                          className="timeline-playhead"
                          left={`${playheadSec * TIMELINE_PX_PER_SEC}px`}
                        />
                      </Box>
                    </Box>
                  </Flex>

                  <Box px={3} py={2.5} borderTopWidth="1px" borderColor="whiteAlpha.100" bg="gray.900">
                    <input
                      type="range"
                      className="timeline-slider"
                      min={0}
                      max={Math.max(1, Math.round(timelineEndSec * 1000))}
                      step={1}
                      value={Math.round(playheadSec * 1000)}
                      onChange={(e) => handleSeek(parseInt(e.target.value, 10) / 1000)}
                      disabled={exporting || isPlaying || timelineEndSec <= 0}
                    />
                  </Box>
                </Box>
              </Stack>
            </Box>
          </Flex>

          <Box>
            <Text color="gray.500" fontSize="xs" mb={3} fontWeight="semibold">
              MIX
            </Text>
            <Stack gap={2}>
              {Array.from({ length: TRACK_COUNT }).map((_, i) => (
                <Flex key={i} align="center" gap={3}>
                  <Text color="gray.400" fontSize="xs" w="24" flexShrink={0} lineClamp={1}>
                    {PART_LABELS[i as PartIndex]}
                  </Text>
                  <Button
                    size="xs"
                    variant="ghost"
                    color={muted[i] ? "red.400" : "gray.600"}
                    bg={muted[i] ? "red.950" : "transparent"}
                    fontWeight="bold"
                    onClick={() => handleMuteToggle(i)}
                    w={7}
                    h={6}
                    minW={7}
                    p={0}
                    fontSize="11px"
                    flexShrink={0}
                    disabled={exporting}
                  >
                    M
                  </Button>
                  <input
                    type="range"
                    className="mix-slider"
                    min={0}
                    max={150}
                    step={1}
                    value={Math.round((volumes[i] ?? 1) * 100)}
                    onChange={(e) =>
                      handleVolumeChange(i, parseInt(e.target.value, 10) / 100)
                    }
                    disabled={exporting}
                  />
                  <Text color="gray.600" fontSize="xs" w={8} textAlign="right" flexShrink={0}>
                    {Math.round((volumes[i] ?? 1) * 100)}%
                  </Text>
                </Flex>
              ))}

              <Flex align="center" gap={3} mt={1}>
                <Text color="gray.400" fontSize="xs" w="24" flexShrink={0}>
                  Reverb
                </Text>
                <Box w={7} flexShrink={0} />
                <input
                  type="range"
                  className="mix-slider"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(reverbWet * 100)}
                  onChange={(e) =>
                    handleReverbChange(parseInt(e.target.value, 10) / 100)
                  }
                  disabled={exporting}
                />
                <Text color="gray.600" fontSize="xs" w={8} textAlign="right" flexShrink={0}>
                  {Math.round(reverbWet * 100)}%
                </Text>
              </Flex>
            </Stack>
          </Box>

          <Box>
            <Text color="gray.500" fontSize="xs" mb={3} fontWeight="semibold">
              REDO A PART
            </Text>
            <Grid templateColumns="repeat(4, 1fr)" gap={2}>
              {Array.from({ length: TRACK_COUNT }).map((_, i) => (
                <Button
                  key={i}
                  size="sm"
                  variant="outline"
                  borderColor="gray.700"
                  color="gray.400"
                  fontSize="xs"
                  onClick={() => handleRedoPart(i)}
                  disabled={exporting}
                >
                  {PART_LABELS[i as PartIndex]}
                </Button>
              ))}
            </Grid>
          </Box>

          {exporting && (
            <Box>
              <Text color="gray.400" fontSize="sm" mb={2}>
                Exporting… {Math.round(exportProgress * 100)}%
              </Text>
              <Progress.Root value={exportProgress * 100} colorPalette="brand">
                <Progress.Track>
                  <Progress.Range />
                </Progress.Track>
              </Progress.Root>
            </Box>
          )}

          {exportedUrl != null ? (
            <Stack gap={3}>
              <Button colorPalette="brand" size="lg" onClick={handleDownload}>
                Download WebM
              </Button>
              <Button
                variant="ghost"
                color="gray.500"
                onClick={() => {
                  URL.revokeObjectURL(exportedUrl);
                  setExportedUrl(null);
                }}
              >
                Export Again
              </Button>
            </Stack>
          ) : (
            <Button
              colorPalette="brand"
              size="lg"
              onClick={handleExport}
              disabled={exporting || timelineEndSec <= 0}
              loading={exporting}
              loadingText="Exporting…"
            >
              Export WebM
            </Button>
          )}

          <Button
            variant="ghost"
            color="gray.600"
            size="sm"
            onClick={handleStartOver}
            disabled={exporting}
          >
            Start Over
          </Button>
        </Stack>
      </Box>

      <style>{`
        .mix-slider {
          flex: 1;
          min-width: 0;
          appearance: none;
          height: 4px;
          border-radius: 2px;
          background: #374151;
          outline: none;
          cursor: pointer;
        }
        .mix-slider::-webkit-slider-thumb {
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #818cf8;
          cursor: pointer;
        }
        .mix-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #818cf8;
          cursor: pointer;
          border: none;
        }

        .timeline-slider {
          width: 100%;
          appearance: none;
          height: 4px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
          outline: none;
          cursor: pointer;
        }
        .timeline-slider::-webkit-slider-thumb {
          appearance: none;
          width: 13px;
          height: 13px;
          border-radius: 50%;
          background: #fafafa;
          border: 1px solid rgba(255, 255, 255, 0.12);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
          cursor: pointer;
        }
        .timeline-slider::-moz-range-thumb {
          width: 13px;
          height: 13px;
          border-radius: 50%;
          background: #fafafa;
          border: 1px solid rgba(255, 255, 255, 0.12);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
          cursor: pointer;
        }

        .timeline-lane {
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          background: transparent;
          user-select: none;
          touch-action: none;
        }
        .timeline-lane.is-alt {
          background: rgba(255, 255, 255, 0.02);
        }
        .timeline-lane.is-selected-lane {
          background: rgba(129, 140, 248, 0.06);
          box-shadow: inset 0 0 0 1px rgba(129, 140, 248, 0.18);
        }
        .timeline-beat {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 1px;
          background: rgba(255, 255, 255, 0.04);
          pointer-events: none;
        }
        .timeline-segment {
          position: absolute;
          top: 9px;
          bottom: 9px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.04);
          display: flex;
          align-items: center;
          cursor: grab;
          overflow: hidden;
        }
        .timeline-segment:active {
          cursor: grabbing;
        }
        .timeline-segment.is-selected {
          border-color: rgba(129, 140, 248, 0.45);
          background: rgba(129, 140, 248, 0.1);
          box-shadow: 0 0 0 1px rgba(129, 140, 248, 0.25);
        }
        .segment-waveform {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1px;
          width: 100%;
          height: 100%;
          padding: 0 4px;
          pointer-events: none;
        }
        .segment-bar {
          width: 2px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.28);
          align-self: center;
        }
        .timeline-playhead {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 1px;
          margin-left: -0.5px;
          background: #fafafa;
          box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
          pointer-events: none;
          z-index: 10;
        }

        .mix-slider:disabled,
        .timeline-slider:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }
      `}</style>
    </Flex>
  );
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00.00";
  const mins = Math.floor(sec / 60);
  const rem = sec - mins * 60;
  const whole = Math.floor(rem);
  const hundredths = Math.floor((rem - whole) * 100);
  return `${mins}:${String(whole).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}
