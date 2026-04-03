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
import { useEffect, useRef, useState, useCallback } from "react";
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

export function FinalReview() {
  const states = useObservable(partStates);
  const chords = useObservable(parsedChords);
  const tempo = useObservable(tempoInput);
  const ctx = useObservable(audioContext);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([null, null, null, null]);
  const compositorRef = useRef<CompositorHandle | null>(null);
  const mixerRef = useRef<Mixer | null>(null);

  // Decoded audio buffers and trim offsets for each track. These are decoded
  // once on mount so playback can use AudioBufferSourceNode.start(when) for
  // sample-accurate synchronization.
  const audioBuffersRef = useRef<(AudioBuffer | null)[]>([null, null, null, null]);
  const trimOffsetsRef = useRef<number[]>([0, 0, 0, 0]);

  // Currently active AudioBufferSourceNodes so we can stop them on pause
  const activeSourcesRef = useRef<(AudioBufferSourceNode | null)[]>([]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportedUrl, setExportedUrl] = useState<string | null>(null);

  // Mixer UI state
  const [volumes, setVolumes] = useState<number[]>([1, 1, 1, 1]);
  const [muted, setMuted] = useState<boolean[]>([false, false, false, false]);
  const [reverbWet, setReverbWet] = useState(0.15);

  const durationSec = progressionDurationSec(chords, tempo);

  // Build video elements (muted, visual only), compositor, and Web Audio
  // graph once ctx is available. Audio is handled via AudioBufferSourceNodes
  // rather than MediaElementSource, so all tracks start sample-accurately.
  useEffect(() => {
    if (ctx == null) return;

    const videos: HTMLVideoElement[] = [];

    for (let i = 0; i < 4; i++) {
      const state = states[i];
      const el = document.createElement("video");
      el.loop = true;
      el.muted = true; // audio is handled via AudioBufferSourceNode, not the element
      el.playsInline = true;
      if (state != null && state.status === "kept") {
        el.src = state.url;
      }
      videoRefs.current[i] = el;
      videos.push(el);
    }

    const mixer = createMixer(ctx, 4);
    mixerRef.current = mixer;

    if (canvasRef.current != null) {
      compositorRef.current = startCompositor(canvasRef.current, videos);
    }

    // Decode each kept take's audio asynchronously
    let cancelled = false;
    for (let i = 0; i < 4; i++) {
      const state = states[i];
      if (state == null || state.status !== "kept") continue;
      const capturedI = i;
      const trimOffset = state.trimOffsetSec;
      void state.blob.arrayBuffer().then((ab) => {
        if (cancelled) return;
        return ctx.decodeAudioData(ab);
      }).then((buffer) => {
        if (cancelled || buffer == null) return;
        audioBuffersRef.current[capturedI] = buffer;
        trimOffsetsRef.current[capturedI] = trimOffset;
      }).catch(() => {});
    }

    return () => {
      cancelled = true;
      compositorRef.current?.stop();
      mixerRef.current?.dispose();
      mixerRef.current = null;
      for (const el of videos) {
        el.pause();
        el.src = "";
      }
    };
  }, [ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Playback ───────────────────────────────────────────────────────────────

  // Start all audio buffers at the same AudioContext time so all tracks are
  // sample-accurate. Video elements (muted) are started best-effort for visuals.
  const startAudio = useCallback((when: number) => {
    if (ctx == null || mixerRef.current == null) return;
    const newSources: (AudioBufferSourceNode | null)[] = [];
    for (let i = 0; i < 4; i++) {
      const buffer = audioBuffersRef.current[i];
      if (buffer == null) {
        newSources.push(null);
        continue;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      mixerRef.current.connectSource(i, source);
      const trimOffset = Math.max(0, trimOffsetsRef.current[i] ?? 0);
      source.start(when, trimOffset);
      newSources.push(source);
    }
    activeSourcesRef.current = newSources;
  }, [ctx]);

  const stopAudio = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try {
        source?.stop();
      } catch {
        // safe to ignore if already stopped
      }
    }
    activeSourcesRef.current = [];
  }, []);

  function handlePlayPause() {
    if (isPlaying) {
      stopAudio();
      for (const v of videoRefs.current) v?.pause();
      setIsPlaying(false);
    } else {
      if (ctx == null) return;
      const when = ctx.currentTime + 0.05;
      startAudio(when);
      // Video is muted; start it for visual sync (best-effort)
      for (const v of videoRefs.current) {
        if (v != null && v.src !== "") {
          v.currentTime = 0;
          v.play().catch(() => {});
        }
      }
      setIsPlaying(true);
    }
  }

  // ─── Mixer ──────────────────────────────────────────────────────────────────

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

  // ─── Part management ────────────────────────────────────────────────────────

  function handleRedoPart(index: number) {
    updatePartState(index, { status: "idle" });
    currentPartIndex.set(index as PartIndex);
    appScreen.set("recording");
  }

  // ─── Export ─────────────────────────────────────────────────────────────────

  async function handleExport() {
    const mixer = mixerRef.current;
    if (ctx == null || canvasRef.current == null || mixer == null) return;

    setExporting(true);
    setExportProgress(0);

    // Start audio buffers and video (visual) together before the recorder captures
    const when = ctx.currentTime + 0.05;
    startAudio(when);
    for (const v of videoRefs.current) {
      if (v != null && v.src !== "") {
        v.currentTime = 0;
        v.play().catch(() => {});
      }
    }

    try {
      const blob = await exportWebM({
        canvas: canvasRef.current,
        audioContext: ctx,
        mixer,
        durationMs: durationSec * 1000,
        onProgress: setExportProgress,
      });

      const url = URL.createObjectURL(blob);
      setExportedUrl(url);
    } catch (err) {
      console.error("Export failed", err);
    } finally {
      stopAudio();
      for (const v of videoRefs.current) v?.pause();
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
    resetSession();
    appScreen.set("setup");
  }

  return (
    <Flex minH="100vh" bg="gray.950" align="center" justify="center" px={4} py={8}>
      <Box w="100%" maxW="520px">
        <Stack gap={6}>
          <Box>
            <Heading size="xl" color="white">
              Final Review
            </Heading>
            <Text color="gray.500" fontSize="sm" mt={1}>
              Preview your 4-part harmony video before exporting
            </Text>
          </Box>

          {/* Canvas preview */}
          <Box
            borderRadius="xl"
            overflow="hidden"
            bg="black"
            w="min(100%, calc(60vh * 9 / 16))"
            aspectRatio="9/16"
            mx="auto"
          >
            <canvas
              ref={canvasRef}
              style={{ width: "100%", height: "100%", display: "block" }}
            />
          </Box>

          {/* Playback */}
          <Button
            colorPalette={isPlaying ? "gray" : "brand"}
            variant={isPlaying ? "outline" : "solid"}
            size="lg"
            onClick={handlePlayPause}
            disabled={exporting}
          >
            {isPlaying ? "Pause" : "Play Preview"}
          </Button>

          {/* Mixer */}
          <Box>
            <Text color="gray.500" fontSize="xs" mb={3} fontWeight="semibold">
              MIX
            </Text>
            <Stack gap={2}>
              {Array.from({ length: 4 }).map((_, i) => (
                <Flex key={i} align="center" gap={3}>
                  <Text
                    color="gray.400"
                    fontSize="xs"
                    w="24"
                    flexShrink={0}
                    lineClamp={1}
                  >
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

              {/* Reverb row */}
              <Flex align="center" gap={3} mt={1}>
                <Text color="gray.400" fontSize="xs" w="24" flexShrink={0}>
                  Reverb
                </Text>
                {/* spacer matching the mute button width */}
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

          {/* Redo a part */}
          <Box>
            <Text color="gray.500" fontSize="xs" mb={3} fontWeight="semibold">
              REDO A PART
            </Text>
            <Grid templateColumns="repeat(4, 1fr)" gap={2}>
              {Array.from({ length: 4 }).map((_, i) => (
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

          {/* Export */}
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
                onClick={() => setExportedUrl(null)}
              >
                Export Again
              </Button>
            </Stack>
          ) : (
            <Button
              colorPalette="brand"
              size="lg"
              onClick={handleExport}
              disabled={exporting}
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
        .mix-slider:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }
      `}</style>
    </Flex>
  );
}
