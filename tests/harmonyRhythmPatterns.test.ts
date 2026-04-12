import { describe, expect, it } from "vitest";
import {
  createArrangementFromPattern,
  getAvailableHarmonyRhythmPatterns,
  type HarmonyRhythmPatternId,
} from "../src/music/harmonyRhythmPatterns";
import type { ChordEvent } from "../src/state/model";

function makeChordEvents(beatsPerChord: number[]): ChordEvent[] {
  let startBeat = 0;
  return beatsPerChord.map((durationBeats, index) => {
    const event: ChordEvent = {
      id: `chord-${index}`,
      chordText: `C${index}`,
      lyrics: "",
      chord: {
        root: "C",
        quality: "maj7",
        beats: durationBeats,
      },
      startBeat,
      durationBeats,
    };
    startBeat += durationBeats;
    return event;
  });
}

function eventSummary(patternId: HarmonyRhythmPatternId, beatsPerChord: number[]) {
  const arrangement = createArrangementFromPattern(
    [[60, 62]],
    makeChordEvents(beatsPerChord),
    [4, 4],
    patternId,
  );

  return arrangement.voices[0]?.events.map((event) => ({
    startTick: event.startTick,
    durationTicks: event.durationTicks,
    midi: event.midi,
  }));
}

describe("harmony rhythm patterns", () => {
  it("returns only the presets supported by the selected meter", () => {
    expect(
      getAvailableHarmonyRhythmPatterns([3, 4]).map((pattern) => pattern.id),
    ).toEqual(["sustain_pad", "strong_beats", "beat_pulse", "waltz_block"]);

    expect(
      getAvailableHarmonyRhythmPatterns([6, 8]).map((pattern) => pattern.id),
    ).toEqual(["sustain_pad", "strong_beats", "beat_pulse", "compound_swell"]);
  });

  it("builds quarter-note pulses with rests between attacks", () => {
    expect(eventSummary("beat_pulse", [4])).toEqual([
      { startTick: 0, durationTicks: 3, midi: 60 },
      { startTick: 3, durationTicks: 1, midi: null },
      { startTick: 4, durationTicks: 3, midi: 60 },
      { startTick: 7, durationTicks: 1, midi: null },
      { startTick: 8, durationTicks: 3, midi: 60 },
      { startTick: 11, durationTicks: 1, midi: null },
      { startTick: 12, durationTicks: 3, midi: 60 },
      { startTick: 15, durationTicks: 1, midi: null },
    ]);
  });

  it("splits measure-aligned windows at chord boundaries", () => {
    expect(eventSummary("charleston", [2, 2])).toEqual([
      { startTick: 0, durationTicks: 5, midi: 60 },
      { startTick: 5, durationTicks: 1, midi: null },
      { startTick: 6, durationTicks: 2, midi: 60 },
      { startTick: 8, durationTicks: 2, midi: 62 },
      { startTick: 10, durationTicks: 6, midi: null },
    ]);
  });

  it("clips offbeat hits when the chord ends before the full slot", () => {
    expect(eventSummary("offbeat_comp", [2, 2])).toEqual([
      { startTick: 0, durationTicks: 6, midi: null },
      { startTick: 6, durationTicks: 2, midi: 60 },
      { startTick: 8, durationTicks: 1, midi: 62 },
      { startTick: 9, durationTicks: 5, midi: null },
      { startTick: 14, durationTicks: 2, midi: 62 },
    ]);
  });
});
