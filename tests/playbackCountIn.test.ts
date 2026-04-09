import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { playCountIn } from "../src/music/playback";

describe("playCountIn", () => {
  beforeEach(() => {
    synthMocks.playClick.mockReset();
    synthMocks.playCountInCueTone.mockReset();
    synthMocks.playGuideTone.mockReset();
    synthMocks.stopAllSynths.mockReset();
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
});
