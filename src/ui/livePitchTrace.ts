import { PitchDetector } from "pitchy";
import { useEffect, useRef, useState } from "react";

export type LivePitchSample = {
  beat: number;
  midi: number | null;
};

const LIVE_PITCH_WINDOW_SIZE = 4096;
const LIVE_PITCH_CLARITY_THRESHOLD = 0.8;
const LIVE_PITCH_RMS_GATE = 0.01;
const LIVE_PITCH_EMIT_INTERVAL_MS = 80;
const LIVE_PITCH_MAX_SAMPLES = 512;

export function useLivePitchTrace(input: {
  ctx: AudioContext | null;
  stream: MediaStream | null;
  enabled: boolean;
  beat: number;
}): LivePitchSample[] {
  const { ctx, stream, enabled, beat } = input;
  const beatRef = useRef(beat);
  const samplesRef = useRef<LivePitchSample[]>([]);
  const lastEmitMsRef = useRef(0);
  const [samples, setSamples] = useState<LivePitchSample[]>([]);

  useEffect(() => {
    beatRef.current = beat;
  }, [beat]);

  useEffect(() => {
    if (!enabled || ctx == null || stream == null) {
      samplesRef.current = [];
      setSamples([]);
      return;
    }

    samplesRef.current = [];
    setSamples([]);
    lastEmitMsRef.current = 0;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = LIVE_PITCH_WINDOW_SIZE;
    analyser.smoothingTimeConstant = 0.12;

    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);

    const detector = PitchDetector.forFloat32Array(LIVE_PITCH_WINDOW_SIZE);
    detector.clarityThreshold = LIVE_PITCH_CLARITY_THRESHOLD;
    detector.minVolumeDecibels = -40;
    const frame = new Float32Array(analyser.fftSize);

    let rafId = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(frame);
      const [frequencyHz, clarity] = detector.findPitch(frame, ctx.sampleRate);
      const rms = computeRms(frame);
      const sample: LivePitchSample = {
        beat: beatRef.current,
        midi:
          clarity >= LIVE_PITCH_CLARITY_THRESHOLD &&
          rms >= LIVE_PITCH_RMS_GATE &&
          frequencyHz > 0
            ? frequencyToMidi(frequencyHz)
            : null,
      };

      const nextSamples = samplesRef.current.concat(sample);
      samplesRef.current =
        nextSamples.length > LIVE_PITCH_MAX_SAMPLES
          ? nextSamples.slice(nextSamples.length - LIVE_PITCH_MAX_SAMPLES)
          : nextSamples;

      const now = performance.now();
      if (now - lastEmitMsRef.current >= LIVE_PITCH_EMIT_INTERVAL_MS) {
        lastEmitMsRef.current = now;
        setSamples(samplesRef.current);
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      source.disconnect();
      analyser.disconnect();
    };
  }, [ctx, enabled, stream]);

  return samples;
}

function computeRms(values: Float32Array): number {
  let energy = 0;
  for (const value of values) {
    energy += value * value;
  }
  return Math.sqrt(energy / Math.max(1, values.length));
}

function frequencyToMidi(frequencyHz: number): number {
  return 69 + 12 * Math.log2(frequencyHz / 440);
}
