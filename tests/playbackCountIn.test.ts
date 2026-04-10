import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const synthMocks = vi.hoisted(() => ({
  playClick: vi.fn(),
  playCountInCueTone: vi.fn(),
  playGuideTone: vi.fn(),
  stopAllSynths: vi.fn(),
}));

vi.mock("../src/audio/synths", () => ({
  playClick: synthMocks.playClick,
  playCountInCueTone: synthMocks.playCountInCueTone,
  playGuideTone: synthMocks.playGuideTone,
  stopAllSynths: synthMocks.stopAllSynths,
}));

import { playCountIn, startRecordingPlayback } from "../src/music/playback";

describe("playCountIn", () => {
  beforeEach(() => {
    synthMocks.playClick.mockReset();
    synthMocks.playCountInCueTone.mockReset();
    synthMocks.playGuideTone.mockReset();
    synthMocks.stopAllSynths.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("schedules the cue note through recording start when a count-in pitch is provided", () => {
    const destination = {} as AudioNode;
    const ctx = {
      currentTime: 12,
      outputLatency: 0.2,
      destination,
    } as AudioContext;

    const result = playCountIn(ctx, 4, 120, 64);

    expect(synthMocks.playClick).toHaveBeenCalledTimes(4);
    expect(synthMocks.playCountInCueTone).toHaveBeenCalledTimes(1);
    expect(synthMocks.playCountInCueTone).toHaveBeenCalledWith(
      ctx,
      expect.any(Number),
      12.05,
      result.gridStartTime,
      1,
      destination,
    );
    expect(result.gridStartTime).toBeCloseTo(14.05);
    expect(result.alignmentStartTime).toBeCloseTo(14.25);
  });

  it("keeps the count-in click-only when no cue pitch is provided", () => {
    const ctx = {
      currentTime: 3,
      outputLatency: 0.1,
    } as AudioContext;

    playCountIn(ctx, 3, 90, null);

    expect(synthMocks.playClick).toHaveBeenCalledTimes(3);
    expect(synthMocks.playCountInCueTone).not.toHaveBeenCalled();
  });

  it("delays count-in beat callbacks until the click is actually heard", () => {
    const intervalCallbacks: Array<() => void> = [];
    vi.spyOn(globalThis, "setInterval").mockImplementation((handler) => {
      if (typeof handler === "function") {
        intervalCallbacks.push(handler as () => void);
      }
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});

    let now = 12;
    const ctx = {
      get currentTime() {
        return now;
      },
      outputLatency: 0.2,
      destination: {} as AudioNode,
    } as AudioContext;
    const onBeat = vi.fn();

    playCountIn(ctx, 1, 60, null, onBeat);

    expect(intervalCallbacks).toHaveLength(1);

    now = 12.24;
    intervalCallbacks[0]?.();
    expect(onBeat).not.toHaveBeenCalled();

    now = 12.26;
    intervalCallbacks[0]?.();
    expect(onBeat).toHaveBeenCalledWith(0, 1);
  });

  it("delays playback beat and chord callbacks until the backing is heard", () => {
    const intervalCallbacks: Array<() => void> = [];
    vi.spyOn(globalThis, "setInterval").mockImplementation((handler) => {
      if (typeof handler === "function") {
        intervalCallbacks.push(handler as () => void);
      }
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});

    let now = 10;
    const ctx = {
      get currentTime() {
        return now;
      },
      outputLatency: 0.2,
      destination: {} as AudioNode,
    } as AudioContext;
    const onBeat = vi.fn();
    const onChordChange = vi.fn();

    const session = startRecordingPlayback({
      ctx,
      chords: [
        { root: "C", quality: "major", bass: null, beats: 1 },
        { root: "F", quality: "major", bass: null, beats: 1 },
      ],
      harmonyLine: null,
      beatsPerBar: 4,
      tempo: 60,
      onBeat,
      onChordChange,
    });

    expect(intervalCallbacks).toHaveLength(2);

    now = 10.24;
    intervalCallbacks.forEach((callback) => callback());
    expect(onBeat).not.toHaveBeenCalled();
    expect(onChordChange).not.toHaveBeenCalled();

    now = 10.26;
    intervalCallbacks.forEach((callback) => callback());
    expect(onBeat).toHaveBeenCalledWith(0);
    expect(onChordChange).toHaveBeenCalledWith(0);

    session.stop();
  });
});
