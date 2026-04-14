import {
  arrangementTicksToBeats,
  type ArrangementVoice,
} from "../music/arrangementScore";
import { PitchDetector } from "pitchy";
import type { Chord, HarmonyLine } from "../music/types";

export type TakeMetricScore = {
  score100: number;
};

export type TimingTakeScore = TakeMetricScore & {
  medianOffsetMs: number;
  globalOffsetMs: number;
  unitCount: number;
};

export type PitchTakeScore = TakeMetricScore & {
  medianAbsCents: number;
  within25CentRatio: number;
  validFrameRatio: number;
};

export type HarmonyTakeScores = {
  timing: TimingTakeScore | null;
  pitch: PitchTakeScore | null;
};

export type ScoringAudioSegment = {
  buffer: AudioBuffer;
  timelineStartSec: number;
  sourceStartSec: number;
  durationSec: number;
};

type NoteSpan = {
  startBeat: number;
  endBeat: number;
  durationBeats: number;
  midi: number;
};

type CorrelationResult = {
  lagFrames: number;
  correlation: number;
};

type FramedTargetSample = {
  startSample: number;
  targetMidi: number;
  rms: number;
};

const TIMING_WINDOW_SEC = 0.02;
const TIMING_HOP_SEC = 0.01;
const TIMING_SEARCH_SEC = 0.18;
const TIMING_GLOBAL_SEARCH_SEC = 0.2;
const PITCH_WINDOW_SIZE = 4096;
const PITCH_HOP_SIZE = 1024;
const PITCH_CLARITY_THRESHOLD = 0.8;
const PITCH_MIN_VALID_FRAME_RATIO = 0.25;
const PITCH_RMS_GATE_FLOOR = 0.01;
const PITCH_RMS_GATE_RATIO = 0.18;

export function gradeHarmonyTake(input: {
  takeBuffer: AudioBuffer;
  takeAlignmentOffsetSec: number;
  referenceSegments: readonly ScoringAudioSegment[];
  arrangementDurationSec: number;
  tempo: number;
  chords: Chord[];
  harmonyLine: HarmonyLine | null;
  arrangementVoice: ArrangementVoice | null;
}): HarmonyTakeScores | null {
  const spans = deriveNoteSpans(input.chords, input.harmonyLine, input.arrangementVoice);
  if (spans.length === 0) return null;

  const safeDurationSec = Math.max(0, input.arrangementDurationSec);
  if (safeDurationSec <= 0) {
    return {
      timing: null,
      pitch: null,
    };
  }

  const sampleRate = input.takeBuffer.sampleRate;
  const takeTimeline = renderTimelineSamples({
    durationSec: safeDurationSec,
    sampleRate,
    segments: [
      {
        buffer: input.takeBuffer,
        timelineStartSec: Math.max(0, -input.takeAlignmentOffsetSec),
        sourceStartSec: Math.max(0, input.takeAlignmentOffsetSec),
        durationSec: Math.max(0, safeDurationSec - Math.max(0, -input.takeAlignmentOffsetSec)),
      },
    ],
  });
  const referenceTimeline =
    input.referenceSegments.length > 0
      ? renderTimelineSamples({
          durationSec: safeDurationSec,
          sampleRate,
          segments: input.referenceSegments,
        })
      : null;

  return {
    timing:
      referenceTimeline != null
        ? scoreTiming({
            takeTimeline,
            referenceTimeline,
            spans,
            sampleRate,
            tempo: input.tempo,
          })
        : null,
    pitch: scorePitch({
      takeTimeline,
      spans,
      sampleRate,
      tempo: input.tempo,
    }),
  };
}

function deriveNoteSpans(
  chords: Chord[],
  harmonyLine: HarmonyLine | null,
  arrangementVoice: ArrangementVoice | null,
): NoteSpan[] {
  if (arrangementVoice != null) {
    return arrangementVoice.events.flatMap((event) => {
      if (event.midi == null) return [];
      const startBeat = arrangementTicksToBeats(event.startTick);
      const durationBeats = arrangementTicksToBeats(event.durationTicks);
      return {
        startBeat,
        endBeat: startBeat + durationBeats,
        durationBeats,
        midi: event.midi,
      };
    });
  }

  if (harmonyLine == null) return [];

  const spans: NoteSpan[] = [];
  let beatCursor = 0;
  for (let index = 0; index < chords.length; index++) {
    const chord = chords[index];
    const beats = chord?.beats ?? 0;
    const midi = harmonyLine[index] ?? null;
    if (midi != null && beats > 0) {
      spans.push({
        startBeat: beatCursor,
        endBeat: beatCursor + beats,
        durationBeats: beats,
        midi,
      });
    }
    beatCursor += beats;
  }
  return spans;
}

function scoreTiming(input: {
  takeTimeline: Float32Array;
  referenceTimeline: Float32Array;
  spans: readonly NoteSpan[];
  sampleRate: number;
  tempo: number;
}): TimingTakeScore | null {
  const { takeTimeline, referenceTimeline, spans, sampleRate, tempo } = input;
  const takeEnvelope = buildTimingEnvelope(takeTimeline, sampleRate);
  const referenceEnvelope = buildTimingEnvelope(referenceTimeline, sampleRate);
  const referencePeak = maxValue(referenceEnvelope.values);
  if (referencePeak <= 0) return null;

  const hopSec = takeEnvelope.hopSec;
  const secPerBeat = 60 / tempo;
  const searchFrames = Math.max(1, Math.round(TIMING_SEARCH_SEC / hopSec));
  let weightedScore = 0;
  let totalWeight = 0;
  const offsetsMs: number[] = [];
  let unitCount = 0;

  for (const span of spans) {
    const startFrame = Math.max(
      0,
      Math.floor((span.startBeat * secPerBeat) / hopSec),
    );
    const endFrame = Math.max(
      startFrame + 1,
      Math.ceil((span.endBeat * secPerBeat) / hopSec),
    );
    const result = findBestCorrelation({
      referenceValues: referenceEnvelope.values,
      takeValues: takeEnvelope.values,
      startFrame,
      endFrame,
      maxLagFrames: searchFrames,
    });
    if (result == null) continue;

    const offsetMs = result.lagFrames * hopSec * 1000;
    const offsetScore = clamp01(1 - Math.abs(offsetMs) / 160);
    const correlationScore = clamp01((result.correlation - 0.35) / 0.5);
    const unitScore = 100 * (0.65 * offsetScore + 0.35 * correlationScore);
    const weight = Math.min(span.durationBeats, 2);

    weightedScore += unitScore * weight;
    totalWeight += weight;
    offsetsMs.push(offsetMs);
    unitCount += 1;
  }

  if (unitCount === 0 || totalWeight <= 0) return null;

  const globalResult = findBestCorrelation({
    referenceValues: referenceEnvelope.values,
    takeValues: takeEnvelope.values,
    startFrame: 0,
    endFrame: referenceEnvelope.values.length,
    maxLagFrames: Math.max(1, Math.round(TIMING_GLOBAL_SEARCH_SEC / hopSec)),
    minOverlapRatio: 0.75,
  });
  const globalOffsetMs =
    globalResult != null ? globalResult.lagFrames * hopSec * 1000 : 0;
  const globalScore =
    globalResult != null
      ? 100 * clamp01(1 - Math.abs(globalOffsetMs) / 180)
      : 100;

  return {
    score100: Math.round(0.75 * (weightedScore / totalWeight) + 0.25 * globalScore),
    medianOffsetMs: roundToNearest(median(offsetsMs), 1),
    globalOffsetMs: roundToNearest(globalOffsetMs, 1),
    unitCount,
  };
}

function scorePitch(input: {
  takeTimeline: Float32Array;
  spans: readonly NoteSpan[];
  sampleRate: number;
  tempo: number;
}): PitchTakeScore | null {
  const { takeTimeline, spans, sampleRate, tempo } = input;
  if (takeTimeline.length < PITCH_WINDOW_SIZE) return null;

  const detector = PitchDetector.forFloat32Array(PITCH_WINDOW_SIZE);
  detector.clarityThreshold = PITCH_CLARITY_THRESHOLD;
  detector.minVolumeDecibels = -40;
  const secPerBeat = 60 / tempo;

  const framedSamples: FramedTargetSample[] = [];
  for (
    let startSample = 0;
    startSample + PITCH_WINDOW_SIZE <= takeTimeline.length;
    startSample += PITCH_HOP_SIZE
  ) {
    const centerSec = (startSample + PITCH_WINDOW_SIZE / 2) / sampleRate;
    const targetMidi = findTargetMidiAtBeat(spans, centerSec / secPerBeat);
    if (targetMidi == null) continue;

    const frame = takeTimeline.subarray(startSample, startSample + PITCH_WINDOW_SIZE);
    framedSamples.push({
      startSample,
      targetMidi,
      rms: computeRms(frame),
    });
  }

  if (framedSamples.length === 0) return null;

  const maxRms = Math.max(...framedSamples.map((frame) => frame.rms));
  const rmsGate = Math.max(PITCH_RMS_GATE_FLOOR, maxRms * PITCH_RMS_GATE_RATIO);

  let validFrameCount = 0;
  let scoreTotal = 0;
  let within25Count = 0;
  const absCentsValues: number[] = [];

  for (const framedSample of framedSamples) {
    if (framedSample.rms < rmsGate) continue;

    const frame = takeTimeline.subarray(
      framedSample.startSample,
      framedSample.startSample + PITCH_WINDOW_SIZE,
    );
    const [frequencyHz, clarity] = detector.findPitch(frame, sampleRate);
    if (clarity < PITCH_CLARITY_THRESHOLD || frequencyHz <= 0) continue;

    const centsOff =
      1200 * Math.log2(frequencyHz / midiToFrequency(framedSample.targetMidi));
    const absCents = Math.abs(centsOff);
    const frameScore =
      absCents <= 25 ? 1 : absCents >= 100 ? 0 : 1 - (absCents - 25) / 75;

    validFrameCount += 1;
    scoreTotal += frameScore;
    if (absCents <= 25) {
      within25Count += 1;
    }
    absCentsValues.push(absCents);
  }

  const validFrameRatio = validFrameCount / framedSamples.length;
  if (validFrameCount === 0 || validFrameRatio < PITCH_MIN_VALID_FRAME_RATIO) {
    return null;
  }

  return {
    score100: Math.round((scoreTotal / validFrameCount) * 100),
    medianAbsCents: roundToNearest(median(absCentsValues), 1),
    within25CentRatio: roundToNearest(within25Count / validFrameCount, 0.001),
    validFrameRatio: roundToNearest(validFrameRatio, 0.001),
  };
}

function buildTimingEnvelope(
  samples: Float32Array,
  sampleRate: number,
): { values: Float32Array; hopSec: number } {
  const windowSize = Math.max(1, Math.round(TIMING_WINDOW_SEC * sampleRate));
  const hopSize = Math.max(1, Math.round(TIMING_HOP_SEC * sampleRate));
  if (samples.length < windowSize) {
    return {
      values: new Float32Array(0),
      hopSec: hopSize / sampleRate,
    };
  }

  const frameCount =
    1 + Math.floor((samples.length - windowSize) / hopSize);
  const rmsValues = new Float32Array(frameCount);
  for (let index = 0; index < frameCount; index++) {
    const startSample = index * hopSize;
    rmsValues[index] = computeRms(
      samples.subarray(startSample, startSample + windowSize),
    );
  }

  const maxRms = maxValue(rmsValues);
  const deltas = new Float32Array(frameCount);
  let maxDelta = 0;
  for (let index = 1; index < frameCount; index++) {
    const delta = Math.max(0, rmsValues[index]! - rmsValues[index - 1]!);
    deltas[index] = delta;
    maxDelta = Math.max(maxDelta, delta);
  }

  const envelope = new Float32Array(frameCount);
  for (let index = 0; index < frameCount; index++) {
    const rmsNorm = maxRms > 0 ? rmsValues[index]! / maxRms : 0;
    const deltaNorm = maxDelta > 0 ? deltas[index]! / maxDelta : 0;
    envelope[index] = 0.7 * rmsNorm + 0.3 * deltaNorm;
  }

  return {
    values: envelope,
    hopSec: hopSize / sampleRate,
  };
}

function findBestCorrelation(input: {
  referenceValues: Float32Array;
  takeValues: Float32Array;
  startFrame: number;
  endFrame: number;
  maxLagFrames: number;
  minOverlapRatio?: number;
}): CorrelationResult | null {
  const {
    referenceValues,
    takeValues,
    startFrame,
    endFrame,
    maxLagFrames,
    minOverlapRatio = 0.6,
  } = input;

  const refLength = Math.max(0, endFrame - startFrame);
  if (refLength <= 0) return null;

  let best: CorrelationResult | null = null;
  const minOverlapFrames = Math.max(4, Math.floor(refLength * minOverlapRatio));

  for (let lagFrames = -maxLagFrames; lagFrames <= maxLagFrames; lagFrames++) {
    const takeStart = startFrame + lagFrames;
    const overlapStart = Math.max(0, -takeStart);
    const overlapEnd = Math.min(refLength, takeValues.length - takeStart);
    const overlapLength = overlapEnd - overlapStart;
    if (overlapLength < minOverlapFrames) continue;

    const correlation = normalizedCorrelation(
      referenceValues,
      startFrame + overlapStart,
      takeValues,
      takeStart + overlapStart,
      overlapLength,
    );
    if (
      best == null ||
      correlation > best.correlation ||
      (correlation === best.correlation &&
        Math.abs(lagFrames) < Math.abs(best.lagFrames))
    ) {
      best = {
        lagFrames,
        correlation,
      };
    }
  }

  return best;
}

function normalizedCorrelation(
  a: Float32Array,
  aStart: number,
  b: Float32Array,
  bStart: number,
  length: number,
): number {
  let sumA = 0;
  let sumB = 0;
  for (let index = 0; index < length; index++) {
    sumA += a[aStart + index] ?? 0;
    sumB += b[bStart + index] ?? 0;
  }
  const meanA = sumA / length;
  const meanB = sumB / length;

  let numerator = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let index = 0; index < length; index++) {
    const centeredA = (a[aStart + index] ?? 0) - meanA;
    const centeredB = (b[bStart + index] ?? 0) - meanB;
    numerator += centeredA * centeredB;
    varianceA += centeredA * centeredA;
    varianceB += centeredB * centeredB;
  }

  if (varianceA <= 0 || varianceB <= 0) return 0;
  return numerator / Math.sqrt(varianceA * varianceB);
}

function renderTimelineSamples(input: {
  durationSec: number;
  sampleRate: number;
  segments: readonly ScoringAudioSegment[];
}): Float32Array {
  const totalSamples = Math.max(1, Math.round(input.durationSec * input.sampleRate));
  const timeline = new Float32Array(totalSamples);

  for (const segment of input.segments) {
    const safeTimelineStartSec = Math.max(0, segment.timelineStartSec);
    const safeSourceStartSec = Math.max(0, segment.sourceStartSec);
    const availableDurationSec = Math.max(
      0,
      segment.buffer.duration - safeSourceStartSec,
    );
    const copyDurationSec = Math.max(
      0,
      Math.min(
        segment.durationSec,
        input.durationSec - safeTimelineStartSec,
        availableDurationSec,
      ),
    );
    if (copyDurationSec <= 0) continue;

    const sourceChannelCount = Math.max(1, segment.buffer.numberOfChannels);
    const timelineStartSample = Math.round(safeTimelineStartSec * input.sampleRate);
    const sourceStartSample = Math.round(safeSourceStartSec * segment.buffer.sampleRate);
    const sampleCount = Math.min(
      Math.round(copyDurationSec * input.sampleRate),
      timeline.length - timelineStartSample,
      segment.buffer.length - sourceStartSample,
    );

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
      let mixedValue = 0;
      for (let channelIndex = 0; channelIndex < sourceChannelCount; channelIndex++) {
        const channelData = segment.buffer.getChannelData(channelIndex);
        mixedValue += channelData[sourceStartSample + sampleIndex] ?? 0;
      }
      const existingValue = timeline[timelineStartSample + sampleIndex] ?? 0;
      timeline[timelineStartSample + sampleIndex] =
        existingValue + mixedValue / sourceChannelCount;
    }
  }

  return timeline;
}

function findTargetMidiAtBeat(
  spans: readonly NoteSpan[],
  timeBeat: number,
): number | null {
  for (const span of spans) {
    if (timeBeat >= span.startBeat && timeBeat < span.endBeat) {
      return span.midi;
    }
  }
  return null;
}

function computeRms(values: ArrayLike<number>): number {
  let energy = 0;
  for (let index = 0; index < values.length; index++) {
    const value = values[index] ?? 0;
    energy += value * value;
  }
  return Math.sqrt(energy / Math.max(1, values.length));
}

function maxValue(values: Float32Array): number {
  let max = 0;
  for (const value of values) {
    max = Math.max(max, value);
  }
  return max;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function roundToNearest(value: number, precision: number): number {
  if (!Number.isFinite(value) || precision <= 0) return 0;
  return Math.round(value / precision) * precision;
}
