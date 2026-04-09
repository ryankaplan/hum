import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const playbackMocks = vi.hoisted(() => ({
  playCountIn: vi.fn(),
  progressionDurationSec: vi.fn(),
  startRecordingPlayback: vi.fn(),
  stopAllPlayback: vi.fn(),
}));

vi.mock("../src/music/playback", () => ({
  playCountIn: playbackMocks.playCountIn,
  progressionDurationSec: playbackMocks.progressionDurationSec,
  startRecordingPlayback: playbackMocks.startRecordingPlayback,
  stopAllPlayback: playbackMocks.stopAllPlayback,
}));

import {
  RecordingCancelledError,
  startRecordTake,
} from "../src/recording/recorder";

const originalMediaRecorder = globalThis.MediaRecorder;

class FakeMediaRecorder {
  static isTypeSupported(type: string): boolean {
    return type.length > 0;
  }

  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state: "inactive" | "recording" = "inactive";

  constructor(
    _stream: MediaStream,
    _options?: MediaRecorderOptions,
  ) {}

  start(_timeslice?: number): void {
    this.state = "recording";
  }

  stop(): void {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.onstop?.();
  }
}

describe("startRecordTake", () => {
  beforeEach(() => {
    playbackMocks.playCountIn.mockReset();
    playbackMocks.progressionDurationSec.mockReset();
    playbackMocks.startRecordingPlayback.mockReset();
    playbackMocks.stopAllPlayback.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.MediaRecorder = originalMediaRecorder;
  });

  it("stops monitor playback before count-in and forwards the cue note", async () => {
    playbackMocks.playCountIn.mockReturnValue({
      promise: new Promise<void>(() => {}),
      gridStartTime: 123,
      alignmentStartTime: 123,
    });

    const monitorPlayer = {
      start: vi.fn(),
      startLooping: vi.fn(),
      stop: vi.fn(),
      setMuted: vi.fn(),
      setLevel: vi.fn(),
      dispose: vi.fn(),
    };

    const session = startRecordTake({
      ctx: { currentTime: 10 } as AudioContext,
      stream: {} as MediaStream,
      chords: [],
      harmonyLine: null,
      countInCueMidi: 67,
      beatsPerBar: 4,
      tempo: 120,
      monitorPlayer,
    });

    expect(monitorPlayer.stop).toHaveBeenCalledTimes(1);
    expect(playbackMocks.playCountIn).toHaveBeenCalledWith(
      expect.anything(),
      4,
      120,
      67,
      undefined,
      1,
      1,
      undefined,
      undefined,
    );
    expect(monitorPlayer.stop.mock.invocationCallOrder[0]).toBeLessThan(
      playbackMocks.playCountIn.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY,
    );

    session.stop();
    await expect(session.promise).rejects.toBeInstanceOf(
      RecordingCancelledError,
    );
  });

  it("uses the grid start for playback and the latency-adjusted start for alignment", async () => {
    vi.useFakeTimers();
    globalThis.MediaRecorder =
      FakeMediaRecorder as unknown as typeof MediaRecorder;

    playbackMocks.playCountIn.mockReturnValue({
      promise: Promise.resolve(),
      gridStartTime: 40,
      alignmentStartTime: 40.2,
    });
    playbackMocks.progressionDurationSec.mockReturnValue(0.1);

    const playbackStop = vi.fn();
    let forwardedOnBeat: ((beat: number) => void) | undefined;
    playbackMocks.startRecordingPlayback.mockImplementation((opts) => {
      forwardedOnBeat = opts.onBeat;
      return {
        startTime: opts.startTime ?? 0,
        stop: playbackStop,
      };
    });

    const onRecordingStart = vi.fn();
    const onBeat = vi.fn();
    const session = startRecordTake({
      ctx: { currentTime: 39.6 } as AudioContext,
      stream: {} as MediaStream,
      chords: [],
      harmonyLine: null,
      beatsPerBar: 4,
      tempo: 120,
      callbacks: {
        onRecordingStart,
        onBeat,
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(playbackMocks.startRecordingPlayback).toHaveBeenCalledWith(
      expect.objectContaining({
        startTime: 40,
        onBeat: expect.any(Function),
      }),
    );
    expect(onRecordingStart).not.toHaveBeenCalled();

    forwardedOnBeat?.(0);
    expect(onRecordingStart).toHaveBeenCalledTimes(1);
    expect(onBeat).toHaveBeenCalledWith(0);

    forwardedOnBeat?.(1);
    expect(onRecordingStart).toHaveBeenCalledTimes(1);
    expect(onBeat).toHaveBeenCalledWith(1);

    await vi.advanceTimersByTimeAsync(700);

    const result = await session.promise;
    expect(result.alignmentOffsetSec).toBeCloseTo(0.6);
    expect(playbackStop).toHaveBeenCalled();
  });
});
