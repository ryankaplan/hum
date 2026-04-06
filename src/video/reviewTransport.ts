import type { TrackTimeline } from "../ui/timeline";
import {
  FRAME_READY_TIMEOUT_MS,
  TRANSPORT_END_EPSILON_SEC,
  classifyVideoDrift,
  computeTransportTimeline,
  mapTimelineToSource,
  playbackRateForDrift,
} from "../transport/core";

export type ReviewTransportMode = "preview" | "export";

export type PrimeForStartOpts = {
  startTimelineSec: number;
  frameReadyTimeoutMs?: number;
  onLaneUnavailable?: (laneIndex: number) => void;
};

export type StartRunOpts = {
  mode: ReviewTransportMode;
  startCtxTimeSec: number;
  startTimelineSec: number;
  endTimelineSec: number;
  onTick: (timelineSec: number) => void;
  onEnded: () => void;
};

export type ReviewTransport = {
  primeForStart: (opts: PrimeForStartOpts) => Promise<number[]>;
  startRun: (opts: StartRunOpts) => void;
  stop: (opts?: { resetAvailability?: boolean }) => void;
  syncPaused: (timelineSec: number) => void;
  getLaneAvailability: () => boolean[];
  dispose: () => void;
};

type CreateReviewTransportOpts = {
  ctx: AudioContext;
  trackCount: number;
  videos: (HTMLVideoElement | null)[];
  getTimelines: () => TrackTimeline[];
  onActiveMask: (mask: boolean[]) => void;
};

type LaneRuntimeState = {
  segmentId: string | null;
  isPlaying: boolean;
};

type RunState = {
  mode: ReviewTransportMode;
  startCtxTimeSec: number;
  startTimelineSec: number;
  endTimelineSec: number;
  started: boolean;
  rafId: number | null;
  onTick: (timelineSec: number) => void;
  onEnded: () => void;
};

export function createReviewTransport(
  opts: CreateReviewTransportOpts,
): ReviewTransport {
  const { ctx, trackCount, videos, getTimelines, onActiveMask } = opts;

  let generation = 0;
  let laneAvailability = makeBooleanMask(trackCount, true);
  let laneRuntimeState = createLaneRuntimeState(trackCount);
  let runState: RunState | null = null;

  function stopRunClock(): void {
    const activeRun = runState;
    if (activeRun?.rafId != null) {
      cancelAnimationFrame(activeRun.rafId);
    }
    runState = null;
  }

  function stopAllVideos(): void {
    for (const video of videos) {
      if (video == null) continue;
      pauseAndResetRate(video);
    }
  }

  function syncAtTimeline(
    timelineSec: number,
    playState: "playing" | "paused",
    respectAvailability: boolean,
  ): void {
    const timelines = getTimelines();
    const nextActiveMask = makeBooleanMask(trackCount, false);

    for (let lane = 0; lane < trackCount; lane++) {
      const video = videos[lane];
      const laneState = laneRuntimeState[lane];
      if (video == null || laneState == null) continue;

      const laneIsAvailable = laneAvailability[lane] ?? false;
      if (respectAvailability && !laneIsAvailable) {
        laneState.segmentId = null;
        laneState.isPlaying = false;
        pauseAndResetRate(video);
        continue;
      }

      const track = timelines[lane] ?? [];
      const mapping = mapTimelineToSource(track, timelineSec);
      if (mapping == null) {
        laneState.segmentId = null;
        laneState.isPlaying = false;
        pauseAndResetRate(video);
        continue;
      }

      nextActiveMask[lane] = true;
      const desiredSourceTime = mapping.sourceTimeSec;
      const isSegmentChanged = laneState.segmentId !== mapping.segment.id;

      if (playState === "paused") {
        if (Math.abs(video.currentTime - desiredSourceTime) > 0.01) {
          hardSeek(video, desiredSourceTime);
        }
        laneState.segmentId = mapping.segment.id;
        laneState.isPlaying = false;
        pauseAndResetRate(video);
        continue;
      }

      if (isSegmentChanged) {
        hardSeek(video, desiredSourceTime);
      } else {
        const driftSec = video.currentTime - desiredSourceTime;
        const driftClass = classifyVideoDrift(driftSec);
        if (driftClass === "hard") {
          hardSeek(video, desiredSourceTime);
          video.playbackRate = 1;
        } else if (driftClass === "soft") {
          video.playbackRate = playbackRateForDrift(driftSec);
        } else if (video.playbackRate !== 1) {
          video.playbackRate = 1;
        }
      }

      laneState.segmentId = mapping.segment.id;
      if (!laneState.isPlaying) {
        void video.play().catch(() => {});
        laneState.isPlaying = true;
      }
    }

    onActiveMask(nextActiveMask);
  }

  function runTick(): void {
    const activeRun = runState;
    if (activeRun == null) return;

    const sample = computeTransportTimeline(
      ctx.currentTime,
      activeRun.startCtxTimeSec,
      activeRun.startTimelineSec,
      activeRun.endTimelineSec,
    );

    if (!activeRun.started) {
      if (ctx.currentTime >= activeRun.startCtxTimeSec) {
        activeRun.started = true;
        syncAtTimeline(sample.clampedTimelineSec, "playing", true);
      } else {
        activeRun.onTick(activeRun.startTimelineSec);
        activeRun.rafId = requestAnimationFrame(runTick);
        return;
      }
    } else {
      syncAtTimeline(sample.clampedTimelineSec, "playing", true);
    }

    activeRun.onTick(sample.clampedTimelineSec);

    if (
      sample.timelineNowSec >=
      activeRun.endTimelineSec - TRANSPORT_END_EPSILON_SEC
    ) {
      syncAtTimeline(activeRun.endTimelineSec, "paused", true);
      const onEnded = activeRun.onEnded;
      stopRunClock();
      onEnded();
      return;
    }

    activeRun.rafId = requestAnimationFrame(runTick);
  }

  return {
    async primeForStart(input) {
      generation += 1;
      const primeToken = generation;
      stopRunClock();

      laneAvailability = makeBooleanMask(trackCount, true);
      laneRuntimeState = createLaneRuntimeState(trackCount);
      stopAllVideos();

      const timelines = getTimelines();
      const timeoutMs = input.frameReadyTimeoutMs ?? FRAME_READY_TIMEOUT_MS;
      const unavailableLanes = new Set<number>();

      const tasks: Promise<void>[] = [];

      for (let lane = 0; lane < trackCount; lane++) {
        const video = videos[lane];
        const track = timelines[lane] ?? [];
        const mapping = mapTimelineToSource(track, input.startTimelineSec);
        if (video == null || mapping == null) continue;

        tasks.push(
          (async () => {
            const ready = await primeVideoAtTime(
              video,
              mapping.sourceTimeSec,
              timeoutMs,
              () => generation !== primeToken,
            );
            if (generation !== primeToken) return;

            if (!ready) {
              laneAvailability[lane] = false;
              unavailableLanes.add(lane);
              pauseAndResetRate(video);
              input.onLaneUnavailable?.(lane);
              return;
            }

            const laneState = laneRuntimeState[lane];
            if (laneState != null) {
              laneState.segmentId = mapping.segment.id;
              laneState.isPlaying = false;
            }
          })(),
        );
      }

      await Promise.all(tasks);
      if (generation !== primeToken) return [];

      syncAtTimeline(input.startTimelineSec, "paused", true);
      return Array.from(unavailableLanes).sort((a, b) => a - b);
    },

    startRun(input) {
      stopRunClock();
      runState = {
        mode: input.mode,
        startCtxTimeSec: input.startCtxTimeSec,
        startTimelineSec: input.startTimelineSec,
        endTimelineSec: input.endTimelineSec,
        started: false,
        rafId: null,
        onTick: input.onTick,
        onEnded: input.onEnded,
      };
      runState.rafId = requestAnimationFrame(runTick);
    },

    stop(stopOpts) {
      generation += 1;
      stopRunClock();
      stopAllVideos();
      laneRuntimeState = createLaneRuntimeState(trackCount);
      if (stopOpts?.resetAvailability ?? true) {
        laneAvailability = makeBooleanMask(trackCount, true);
      }
      onActiveMask(makeBooleanMask(trackCount, false));
    },

    syncPaused(timelineSec) {
      stopRunClock();
      stopAllVideos();
      syncAtTimeline(timelineSec, "paused", false);
    },

    getLaneAvailability() {
      return [...laneAvailability];
    },

    dispose() {
      generation += 1;
      stopRunClock();
      stopAllVideos();
      onActiveMask(makeBooleanMask(trackCount, false));
    },
  };
}

async function primeVideoAtTime(
  video: HTMLVideoElement,
  desiredSourceTimeSec: number,
  timeoutMs: number,
  isCancelled: () => boolean,
): Promise<boolean> {
  if (!Number.isFinite(desiredSourceTimeSec) || isCancelled()) return false;

  if (!(await waitForMetadata(video, timeoutMs, isCancelled))) {
    return false;
  }

  const seeked = await seekVideo(video, desiredSourceTimeSec, timeoutMs, isCancelled);
  if (!seeked) return false;

  return waitForDecodedFrame(video, Math.min(timeoutMs, 350), isCancelled);
}

function waitForMetadata(
  video: HTMLVideoElement,
  timeoutMs: number,
  isCancelled: () => boolean,
): Promise<boolean> {
  if (isCancelled()) return Promise.resolve(false);
  if (video.readyState >= 1) return Promise.resolve(true);
  if (timeoutMs <= 0) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => finish(video.readyState >= 1), timeoutMs);

    function finish(value: boolean): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("error", onError);
      resolve(value && !isCancelled());
    }

    function onLoadedMetadata(): void {
      finish(true);
    }

    function onError(): void {
      finish(false);
    }

    video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function seekVideo(
  video: HTMLVideoElement,
  timeSec: number,
  timeoutMs: number,
  isCancelled: () => boolean,
): Promise<boolean> {
  if (isCancelled()) return Promise.resolve(false);
  if (timeoutMs <= 0) return Promise.resolve(false);

  const clamped = clampVideoTime(video, timeSec);
  if (
    Math.abs(video.currentTime - clamped) <= 0.008 &&
    (video.readyState >= 2 || !Number.isFinite(video.currentTime))
  ) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timeoutId = window.setTimeout(
      () => finish(Math.abs(video.currentTime - clamped) <= 0.06 && video.readyState >= 2),
      timeoutMs,
    );

    function finish(value: boolean): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      resolve(value && !isCancelled());
    }

    function onSeeked(): void {
      finish(true);
    }

    function onError(): void {
      finish(false);
    }

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });

    try {
      video.currentTime = clamped;
    } catch {
      finish(false);
    }
  });
}

function waitForDecodedFrame(
  video: HTMLVideoElement,
  timeoutMs: number,
  isCancelled: () => boolean,
): Promise<boolean> {
  if (isCancelled()) return Promise.resolve(false);
  if (video.readyState >= 2) return Promise.resolve(true);
  if (timeoutMs <= 0) return Promise.resolve(false);

  const frameVideo = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (
      callback: (now: number, metadata: unknown) => void,
    ) => number;
    cancelVideoFrameCallback?: (handle: number) => void;
  };

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let frameHandle: number | null = null;
    const timeoutId = window.setTimeout(
      () => finish(video.readyState >= 2),
      timeoutMs,
    );

    function finish(value: boolean): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (frameHandle != null && frameVideo.cancelVideoFrameCallback != null) {
        frameVideo.cancelVideoFrameCallback(frameHandle);
      }
      video.removeEventListener("loadeddata", onLoadedData);
      video.removeEventListener("canplay", onLoadedData);
      video.removeEventListener("error", onError);
      resolve(value && !isCancelled());
    }

    function onLoadedData(): void {
      finish(true);
    }

    function onError(): void {
      finish(false);
    }

    if (frameVideo.requestVideoFrameCallback != null) {
      frameHandle = frameVideo.requestVideoFrameCallback(() => finish(true));
    }

    video.addEventListener("loadeddata", onLoadedData, { once: true });
    video.addEventListener("canplay", onLoadedData, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function clampVideoTime(video: HTMLVideoElement, sourceTimeSec: number): number {
  const min = 0;
  const duration = video.duration;
  if (!Number.isFinite(duration)) {
    return Math.max(min, sourceTimeSec);
  }
  const max = Math.max(min, duration - 0.001);
  return Math.min(Math.max(sourceTimeSec, min), max);
}

function hardSeek(video: HTMLVideoElement, sourceTimeSec: number): void {
  try {
    video.currentTime = clampVideoTime(video, sourceTimeSec);
  } catch {
    // Some browsers can throw while metadata is still loading.
  }
}

function pauseAndResetRate(video: HTMLVideoElement): void {
  video.playbackRate = 1;
  video.pause();
}

function makeBooleanMask(size: number, value: boolean): boolean[] {
  return Array.from({ length: size }, () => value);
}

function createLaneRuntimeState(trackCount: number): LaneRuntimeState[] {
  return Array.from({ length: trackCount }, () => ({
    segmentId: null,
    isPlaying: false,
  }));
}
