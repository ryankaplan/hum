import { AUDIO_SCHEDULE_LEAD_SEC } from "../transport/core";

export type EncodedMonitorSegment = {
  recordingId: string;
  blob: Blob;
  timelineStartSec: number;
  sourceStartSec: number;
  durationSec: number;
};

export type MonitorSegment = {
  buffer: AudioBuffer;
  timelineStartSec: number;
  sourceStartSec: number;
  durationSec: number;
};

export type MonitorLane = {
  segments: MonitorSegment[];
};

export type MonitorPlayer = {
  start(when: number): void;
  startLooping(): void;
  stop(): void;
  setMuted(trackIndex: number, muted: boolean): void;
  setLevel(level: number): void;
  dispose(): void;
};

export async function decodeMonitorLanes(
  ctx: AudioContext,
  lanes: Array<{ segments: EncodedMonitorSegment[] }>,
): Promise<MonitorLane[]> {
  const decodeCache = new Map<string, Promise<AudioBuffer | null>>();

  const decodeRecording = (recordingId: string, blob: Blob): Promise<AudioBuffer | null> => {
    const cached = decodeCache.get(recordingId);
    if (cached != null) return cached;

    const task = (async () => {
      try {
        const arrayBuffer = await blob.arrayBuffer();
        return await ctx.decodeAudioData(arrayBuffer);
      } catch {
        return null;
      }
    })();
    decodeCache.set(recordingId, task);
    return task;
  };

  return await Promise.all(
    lanes.map(async (lane) => {
      const segments: MonitorSegment[] = [];

      for (const segment of lane.segments) {
        const buffer = await decodeRecording(segment.recordingId, segment.blob);
        if (buffer == null) continue;

        segments.push({
          buffer,
          timelineStartSec: Math.max(0, segment.timelineStartSec),
          sourceStartSec: Math.max(0, segment.sourceStartSec),
          durationSec: Math.max(0, segment.durationSec),
        });
      }

      return { segments };
    }),
  );
}

export function createMonitorPlayer(
  ctx: AudioContext,
  lanes: MonitorLane[],
  loopDurationSec: number,
): MonitorPlayer {
  const BASE_TRACK_GAIN = 0.6;
  const gainNodes: GainNode[] = lanes.map(() => {
    const gain = ctx.createGain();
    gain.gain.value = BASE_TRACK_GAIN;
    gain.connect(ctx.destination);
    return gain;
  });

  const muted: boolean[] = lanes.map(() => false);
  let level = 1;
  let activeSources = new Set<AudioBufferSourceNode>();
  let loopTimer: number | null = null;
  let loopGeneration = 0;

  function clearLoopTimer(): void {
    if (loopTimer != null) {
      window.clearTimeout(loopTimer);
      loopTimer = null;
    }
  }

  function stopActiveSources(): void {
    for (const source of activeSources) {
      try {
        source.stop();
      } catch {
        // Safe to ignore if the source has already ended.
      }
    }
    activeSources = new Set<AudioBufferSourceNode>();
  }

  function stopScheduling(): void {
    loopGeneration += 1;
    clearLoopTimer();
  }

  function registerSource(source: AudioBufferSourceNode): void {
    activeSources.add(source);
    source.onended = () => {
      activeSources.delete(source);
    };
  }

  function applyTrackGain(trackIndex: number): void {
    const gain = gainNodes[trackIndex];
    if (gain == null) return;
    gain.gain.value = muted[trackIndex] ? 0 : BASE_TRACK_GAIN * level;
  }

  function scheduleSegment(
    source: MonitorSegment,
    gain: GainNode,
    cycleStartCtxTime: number,
    maxDurationSec: number,
  ): void {
    const availableDurationSec = Math.max(
      0,
      source.buffer.duration - source.sourceStartSec,
    );
    const playDurationSec = Math.min(
      Math.max(0, source.durationSec),
      availableDurationSec,
      maxDurationSec,
    );
    if (playDurationSec <= 0) return;

    const node = ctx.createBufferSource();
    node.buffer = source.buffer;
    node.connect(gain);
    node.start(
      cycleStartCtxTime + source.timelineStartSec,
      source.sourceStartSec,
      playDurationSec,
    );
    registerSource(node);
  }

  function scheduleAllSegments(startCtxTime: number): void {
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex++) {
      const lane = lanes[laneIndex];
      const gain = gainNodes[laneIndex];
      if (lane == null || gain == null) continue;

      for (const segment of lane.segments) {
        scheduleSegment(segment, gain, startCtxTime, Number.POSITIVE_INFINITY);
      }
    }
  }

  function scheduleLoopCycle(startCtxTime: number, generation: number): void {
    if (generation !== loopGeneration) return;
    const safeLoopDurationSec = Math.max(0, loopDurationSec);
    if (safeLoopDurationSec <= 0) return;

    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex++) {
      const lane = lanes[laneIndex];
      const gain = gainNodes[laneIndex];
      if (lane == null || gain == null) continue;

      for (const segment of lane.segments) {
        if (segment.timelineStartSec >= safeLoopDurationSec) continue;

        scheduleSegment(
          segment,
          gain,
          startCtxTime,
          safeLoopDurationSec - segment.timelineStartSec,
        );
      }
    }

    const nextStartCtxTime = startCtxTime + safeLoopDurationSec;
    const scheduleDelayMs = Math.max(
      0,
      (nextStartCtxTime - ctx.currentTime - AUDIO_SCHEDULE_LEAD_SEC) * 1000,
    );
    loopTimer = window.setTimeout(() => {
      scheduleLoopCycle(nextStartCtxTime, generation);
    }, scheduleDelayMs);
  }

  return {
    start(when: number) {
      stopScheduling();
      stopActiveSources();
      scheduleAllSegments(when);
    },

    startLooping() {
      stopScheduling();
      stopActiveSources();

      const startCtxTime = ctx.currentTime + AUDIO_SCHEDULE_LEAD_SEC;
      const generation = loopGeneration + 1;
      loopGeneration = generation;
      scheduleLoopCycle(startCtxTime, generation);
    },

    stop() {
      stopScheduling();
      stopActiveSources();
    },

    setMuted(trackIndex: number, isMuted: boolean) {
      muted[trackIndex] = isMuted;
      applyTrackGain(trackIndex);
    },

    setLevel(nextLevel: number) {
      level = Math.max(0, Math.min(1, nextLevel));
      for (let i = 0; i < lanes.length; i++) {
        applyTrackGain(i);
      }
    },

    dispose() {
      stopScheduling();
      stopActiveSources();
      for (const gain of gainNodes) {
        gain.disconnect();
      }
    },
  };
}
