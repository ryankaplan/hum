import { describe, expect, it } from "vitest";
import {
  RecordingTransportController,
  selectMonitorTrackIndices,
  selectReferenceWaveformLane,
} from "../src/ui/RecordingTransportController";

describe("selectReferenceWaveformLane", () => {
  it("uses the designated reference track instead of the last prior lane", () => {
    const first = { trackId: "track-low", segments: [{ id: "first" }] };
    const second = { trackId: "track-mid", segments: [] };
    const third = { trackId: "track-melody", segments: [{ id: "third" }] };

    expect(
      selectReferenceWaveformLane([first, second, third], "track-low"),
    ).toBe(first);
  });

  it("returns null when the designated track is not among decoded prior lanes", () => {
    expect(
      selectReferenceWaveformLane([
        { trackId: "track-low", segments: [{ id: "low" }] },
        { trackId: "track-mid", segments: [{ id: "mid" }] },
      ], "track-melody"),
    ).toBeNull();
  });

  it("returns null when the designated track has no decoded waveform segments", () => {
    expect(
      selectReferenceWaveformLane([
        { trackId: "track-low", segments: [] },
        { trackId: "track-mid", segments: [{ id: "mid" }] },
      ], "track-low"),
    ).toBeNull();
  });
});

describe("selectMonitorTrackIndices", () => {
  it("includes recorded monitor lanes from any other part, not just earlier ones", () => {
    expect(
      selectMonitorTrackIndices(
        ["track-low", "track-mid", "track-high", "track-melody"],
        "track-low",
      ),
    ).toEqual([1, 2, 3]);
  });

  it("returns every track when the active track is unknown", () => {
    expect(
      selectMonitorTrackIndices(
        ["track-low", "track-mid", "track-high", "track-melody"],
        null,
      ),
    ).toEqual([0, 1, 2, 3]);
  });
});

describe("RecordingTransportController monitor playback", () => {
  it("does not auto-loop prior takes when entering pre-roll", () => {
    const controller = new RecordingTransportController() as RecordingTransportController & {
      monitorPlayer: { startLooping: () => void; stop: () => void } | null;
      setPhase: (phase: "pre-roll" | "listening") => void;
      snapshot: { phase: "listening" | "pre-roll" };
    };
    let startLoopingCalls = 0;
    let stopCalls = 0;

    controller.monitorPlayer = {
      startLooping: () => {
        startLoopingCalls += 1;
      },
      stop: () => {
        stopCalls += 1;
      },
    };
    controller.snapshot = {
      ...controller.snapshot,
      phase: "listening",
    };

    controller.setPhase("pre-roll");

    expect(startLoopingCalls).toBe(0);
    expect(stopCalls).toBe(0);
  });
});
