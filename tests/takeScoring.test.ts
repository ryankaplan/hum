import { describe, expect, it } from "vitest";
import { gradeHarmonyTake } from "../src/recording/takeScoring";
import type { Chord } from "../src/music/types";

const SAMPLE_RATE = 48_000;
const TEMPO = 120;
const CHORDS: Chord[] = [
  { root: "C", quality: "major", bass: null, beats: 2 },
  { root: "F", quality: "major", bass: null, beats: 2 },
];
const ARRANGEMENT_DURATION_SEC = 2;
const HARMONY_LINE = [60, 60];

describe("gradeHarmonyTake", () => {
  it("scores closely aligned timing highly", () => {
    const referenceBuffer = createRenderedTake({
      delaySec: 0,
      detuneSemitones: 0,
    });
    const takeBuffer = createRenderedTake({
      delaySec: 0.01,
      detuneSemitones: 0,
    });

    const scores = gradeHarmonyTake({
      takeBuffer,
      takeAlignmentOffsetSec: 0,
      referenceSegments: [
        {
          buffer: referenceBuffer,
          timelineStartSec: 0,
          sourceStartSec: 0,
          durationSec: ARRANGEMENT_DURATION_SEC,
        },
      ],
      arrangementDurationSec: ARRANGEMENT_DURATION_SEC,
      tempo: TEMPO,
      chords: CHORDS,
      harmonyLine: HARMONY_LINE,
      arrangementVoice: null,
    });

    expect(scores?.timing?.score100 ?? 0).toBeGreaterThanOrEqual(85);
  });

  it("reduces timing score for noticeably late phrasing", () => {
    const referenceBuffer = createRenderedTake({
      delaySec: 0,
      detuneSemitones: 0,
    });
    const alignedScores = gradeHarmonyTake({
      takeBuffer: createRenderedTake({ delaySec: 0, detuneSemitones: 0 }),
      takeAlignmentOffsetSec: 0,
      referenceSegments: [
        {
          buffer: referenceBuffer,
          timelineStartSec: 0,
          sourceStartSec: 0,
          durationSec: ARRANGEMENT_DURATION_SEC,
        },
      ],
      arrangementDurationSec: ARRANGEMENT_DURATION_SEC,
      tempo: TEMPO,
      chords: CHORDS,
      harmonyLine: HARMONY_LINE,
      arrangementVoice: null,
    });
    const lateScores = gradeHarmonyTake({
      takeBuffer: createRenderedTake({ delaySec: 0.18, detuneSemitones: 0 }),
      takeAlignmentOffsetSec: 0,
      referenceSegments: [
        {
          buffer: referenceBuffer,
          timelineStartSec: 0,
          sourceStartSec: 0,
          durationSec: ARRANGEMENT_DURATION_SEC,
        },
      ],
      arrangementDurationSec: ARRANGEMENT_DURATION_SEC,
      tempo: TEMPO,
      chords: CHORDS,
      harmonyLine: HARMONY_LINE,
      arrangementVoice: null,
    });

    expect((lateScores?.timing?.score100 ?? 0) + 20).toBeLessThan(
      alignedScores?.timing?.score100 ?? 100,
    );
  });

  it("scores on-pitch singing highly", () => {
    const takeBuffer = createRenderedTake({
      delaySec: 0,
      detuneSemitones: 0,
    });

    const scores = gradeHarmonyTake({
      takeBuffer,
      takeAlignmentOffsetSec: 0,
      referenceSegments: [],
      arrangementDurationSec: ARRANGEMENT_DURATION_SEC,
      tempo: TEMPO,
      chords: CHORDS,
      harmonyLine: HARMONY_LINE,
      arrangementVoice: null,
    });

    expect(scores?.pitch?.score100 ?? 0).toBeGreaterThanOrEqual(90);
    expect(scores?.timing).toBeNull();
  });

  it("scores semitone-off singing materially lower", () => {
    const onPitchScores = gradeHarmonyTake({
      takeBuffer: createRenderedTake({ delaySec: 0, detuneSemitones: 0 }),
      takeAlignmentOffsetSec: 0,
      referenceSegments: [],
      arrangementDurationSec: ARRANGEMENT_DURATION_SEC,
      tempo: TEMPO,
      chords: CHORDS,
      harmonyLine: HARMONY_LINE,
      arrangementVoice: null,
    });
    const offPitchScores = gradeHarmonyTake({
      takeBuffer: createRenderedTake({ delaySec: 0, detuneSemitones: 1 }),
      takeAlignmentOffsetSec: 0,
      referenceSegments: [],
      arrangementDurationSec: ARRANGEMENT_DURATION_SEC,
      tempo: TEMPO,
      chords: CHORDS,
      harmonyLine: HARMONY_LINE,
      arrangementVoice: null,
    });

    expect((offPitchScores?.pitch?.score100 ?? 100) + 40).toBeLessThan(
      onPitchScores?.pitch?.score100 ?? 100,
    );
  });
});

function createRenderedTake(input: {
  delaySec: number;
  detuneSemitones: number;
}): AudioBuffer {
  const sampleCount = Math.round((ARRANGEMENT_DURATION_SEC + input.delaySec) * SAMPLE_RATE);
  const samples = new Float32Array(sampleCount);
  const secPerBeat = 60 / TEMPO;
  const spans = [
    { startBeat: 0, endBeat: 2, midi: 60 },
    { startBeat: 2, endBeat: 4, midi: 60 },
  ];

  for (const span of spans) {
    const startSample = Math.round(
      (span.startBeat * secPerBeat + input.delaySec) * SAMPLE_RATE,
    );
    const endSample = Math.min(
      sampleCount,
      Math.round((span.endBeat * secPerBeat + input.delaySec) * SAMPLE_RATE),
    );
    const frequencyHz = midiToFrequency(span.midi + input.detuneSemitones);

    for (let sampleIndex = startSample; sampleIndex < endSample; sampleIndex++) {
      const localTimeSec = (sampleIndex - startSample) / SAMPLE_RATE;
      const attack = Math.min(1, localTimeSec / 0.03);
      const release = Math.min(
        1,
        Math.max(0, (endSample - sampleIndex) / (0.05 * SAMPLE_RATE)),
      );
      const envelope = attack * release;
      samples[sampleIndex] =
        0.42 *
        envelope *
        Math.sin((2 * Math.PI * frequencyHz * sampleIndex) / SAMPLE_RATE);
    }
  }

  return createAudioBuffer(samples, SAMPLE_RATE);
}

function createAudioBuffer(
  channelData: Float32Array,
  sampleRate: number,
): AudioBuffer {
  return {
    sampleRate,
    numberOfChannels: 1,
    length: channelData.length,
    duration: channelData.length / sampleRate,
    getChannelData: () => channelData,
  } as AudioBuffer;
}

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
