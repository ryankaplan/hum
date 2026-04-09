import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("startRecordTake", () => {
  beforeEach(() => {
    playbackMocks.playCountIn.mockReset();
    playbackMocks.progressionDurationSec.mockReset();
    playbackMocks.startRecordingPlayback.mockReset();
    playbackMocks.stopAllPlayback.mockReset();
  });

  it("stops monitor playback before count-in and forwards the cue note", async () => {
    playbackMocks.playCountIn.mockReturnValue({
      promise: new Promise<void>(() => {}),
      recordingStartTime: 123,
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
});
