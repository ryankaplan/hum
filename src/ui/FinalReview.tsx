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
import { useEffect, useRef, useState } from "react";
import { useObservable } from "../observable";
import {
  appScreen,
  audioContext,
  currentPartIndex,
  meterInput,
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

export function FinalReview() {
  const states = useObservable(partStates);
  const chords = useObservable(parsedChords);
  const tempo = useObservable(tempoInput);
  const ctx = useObservable(audioContext);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([null, null, null, null]);
  const compositorRef = useRef<CompositorHandle | null>(null);
  const audioSourcesRef = useRef<MediaElementAudioSourceNode[]>([]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportedUrl, setExportedUrl] = useState<string | null>(null);

  const durationSec = progressionDurationSec(chords, tempo);

  // Set up video elements and compositor on mount
  useEffect(() => {
    const videos: HTMLVideoElement[] = [];
    for (let i = 0; i < 4; i++) {
      const state = states[i];
      const el = document.createElement("video");
      el.loop = true;
      el.muted = false;
      el.playsInline = true;
      if (state != null && state.status === "kept") {
        el.src = state.url;
      }
      videoRefs.current[i] = el;
      videos.push(el);
    }

    if (canvasRef.current != null) {
      compositorRef.current = startCompositor(canvasRef.current, videos);
    }

    return () => {
      compositorRef.current?.stop();
      for (const el of videos) {
        el.pause();
        el.src = "";
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePlayPause() {
    const videos = videoRefs.current;
    if (isPlaying) {
      for (const v of videos) v?.pause();
      setIsPlaying(false);
    } else {
      for (const v of videos) {
        if (v != null) {
          v.currentTime = 0;
          v.play().catch(() => {});
        }
      }
      setIsPlaying(true);
    }
  }

  function handleRedoPart(index: number) {
    updatePartState(index, { status: "idle" });
    currentPartIndex.set(index as PartIndex);
    appScreen.set("recording");
  }

  async function handleExport() {
    if (ctx == null || canvasRef.current == null) return;
    setExporting(true);
    setExportProgress(0);

    // Create audio sources for all kept takes
    const sources: MediaElementAudioSourceNode[] = [];
    for (const v of videoRefs.current) {
      if (v != null && v.src !== "") {
        const src = ctx.createMediaElementSource(v);
        sources.push(src);
      }
    }
    audioSourcesRef.current = sources;

    // Start all videos from the beginning
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
        audioSources: sources,
        durationMs: durationSec * 1000,
        onProgress: setExportProgress,
      });

      const url = URL.createObjectURL(blob);
      setExportedUrl(url);
    } catch (err) {
      console.error("Export failed", err);
    } finally {
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
            w="100%"
            aspectRatio="9/16"
            maxH="480px"
          >
            <canvas
              ref={canvasRef}
              style={{ width: "100%", height: "100%", display: "block" }}
            />
          </Box>

          {/* Playback controls */}
          <Button
            colorPalette={isPlaying ? "gray" : "brand"}
            variant={isPlaying ? "outline" : "solid"}
            size="lg"
            onClick={handlePlayPause}
            disabled={exporting}
          >
            {isPlaying ? "Pause" : "Play Preview"}
          </Button>

          {/* Part redo buttons */}
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

          {/* Export section */}
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
    </Flex>
  );
}
