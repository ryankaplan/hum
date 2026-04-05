import { playClick } from "../audio/synths";

const CALIBRATION_TOTAL_BEATS = 8;
const CLAP_TARGET_BEAT_INDICES = [4, 5, 6, 7] as const;
const CLAP_MATCH_WINDOW_EARLY_SEC = 0.2;
const CLAP_MATCH_WINDOW_LATE_SEC = 0.7;
const CORRECTION_MIN_SEC = -0.12;
const CORRECTION_MAX_SEC = 0.6;

export type ClapCalibrationConfidence = "high" | "low";

export type ClapCalibrationResult = {
  correctionSec: number;
  confidence: ClapCalibrationConfidence;
  matchedCount: number;
  expectedTimesSec: number[];
  detectedTimesSec: number[];
  residualsSec: number[];
  timingScore: number;
  waveformPeaks: number[];
  durationSec: number;
};

export type RunClapCalibrationOpts = {
  ctx: AudioContext;
  stream: MediaStream;
  tempo: number;
};

type PeakCandidate = {
  timeSec: number;
  value: number;
};

export async function runClapCalibration(
  opts: RunClapCalibrationOpts,
): Promise<ClapCalibrationResult> {
  const { ctx, stream } = opts;
  const tempo = Math.max(1, opts.tempo);
  const secPerBeat = 60 / tempo;

  const startTime = ctx.currentTime + 0.08;
  const stopTime = startTime + CALIBRATION_TOTAL_BEATS * secPerBeat + 0.7;

  for (let beat = 0; beat < CALIBRATION_TOTAL_BEATS; beat++) {
    const beatTime = startTime + beat * secPerBeat;
    playClick(ctx, beatTime, beat % 4 === 0);
  }

  const mimeType = getSupportedCalibrationMimeType();
  const mediaRecorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 1_500_000,
  });

  const chunks: Blob[] = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  const recordingDone = new Promise<Blob>((resolve) => {
    mediaRecorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType }));
    };
  });

  mediaRecorder.start(100);
  const recorderStartCtxTime = ctx.currentTime;

  await waitMs(Math.max(0, (stopTime - ctx.currentTime) * 1000));
  mediaRecorder.stop();

  const blob = await recordingDone;
  const raw = await blob.arrayBuffer();
  const decoded = await ctx.decodeAudioData(raw);
  const mono = downmixToMono(decoded);

  const peakCandidates = detectClapPeaks(mono, decoded.sampleRate);
  const expectedTimesSec = CLAP_TARGET_BEAT_INDICES.map((beatIndex) => {
    return (
      startTime +
      beatIndex * secPerBeat +
      ctx.outputLatency -
      recorderStartCtxTime
    );
  });

  const matched = matchPeaksToExpected(expectedTimesSec, peakCandidates);
  const detectedTimesSec = matched.filter((v): v is number => v != null);
  const residualsSec = matched
    .map((detected, i) => {
      if (detected == null) return null;
      return detected - expectedTimesSec[i]!;
    })
    .filter((v): v is number => v != null);

  const matchedCount = residualsSec.length;
  const rawCorrectionSec = matchedCount > 0 ? median(residualsSec) : 0;
  const correctionSec = clamp(rawCorrectionSec, CORRECTION_MIN_SEC, CORRECTION_MAX_SEC);
  const spreadSec = medianAbsoluteDeviation(residualsSec);
  const timingScore = computeTimingScore(
    matched,
    expectedTimesSec,
    secPerBeat,
    CLAP_TARGET_BEAT_INDICES.length,
  );
  const confidence: ClapCalibrationConfidence =
    matchedCount >= 3 && spreadSec <= 0.05 && timingScore >= 55 ? "high" : "low";

  return {
    correctionSec,
    confidence,
    matchedCount,
    expectedTimesSec,
    detectedTimesSec,
    residualsSec,
    timingScore,
    waveformPeaks: buildWaveformPeaks(mono, 280),
    durationSec: decoded.duration,
  };
}

function getSupportedCalibrationMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return "video/webm";
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function downmixToMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  const channelCount = Math.max(1, buffer.numberOfChannels);
  for (let c = 0; c < channelCount; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < buffer.length; i++) {
      const current = mono[i] ?? 0;
      mono[i] = current + (channel[i] ?? 0) / channelCount;
    }
  }
  return mono;
}

function detectClapPeaks(samples: Float32Array, sampleRate: number): PeakCandidate[] {
  if (samples.length === 0 || sampleRate <= 0) return [];

  const highPassed = new Float32Array(samples.length);
  highPassed[0] = samples[0] ?? 0;
  for (let i = 1; i < samples.length; i++) {
    highPassed[i] = (samples[i] ?? 0) - 0.985 * (samples[i - 1] ?? 0);
  }

  const frameSize = Math.max(128, Math.floor(sampleRate * 0.008));
  const hop = Math.max(64, Math.floor(frameSize / 2));
  const energies: number[] = [];
  for (let start = 0; start + frameSize < highPassed.length; start += hop) {
    let sumAbs = 0;
    for (let i = start; i < start + frameSize; i++) {
      sumAbs += Math.abs(highPassed[i] ?? 0);
    }
    energies.push(sumAbs / frameSize);
  }

  if (energies.length < 3) return [];

  for (let i = 1; i < energies.length; i++) {
    const curr = energies[i] ?? 0;
    const prev = energies[i - 1] ?? 0;
    energies[i] = 0.65 * curr + 0.35 * prev;
  }

  const baseline = percentile(energies, 0.55);
  const p90 = percentile(energies, 0.9);
  const threshold = Math.max(0.006, baseline * 2.7, baseline + (p90 - baseline) * 0.45);

  const rawPeaks: PeakCandidate[] = [];
  for (let i = 1; i < energies.length - 1; i++) {
    const prev = energies[i - 1] ?? 0;
    const curr = energies[i] ?? 0;
    const next = energies[i + 1] ?? 0;
    if (curr > threshold && curr >= prev && curr > next) {
      const frameCenterSample = i * hop + Math.floor(frameSize / 2);
      rawPeaks.push({
        timeSec: frameCenterSample / sampleRate,
        value: curr,
      });
    }
  }

  if (rawPeaks.length === 0) return [];

  const refractorySec = 0.09;
  const filtered: PeakCandidate[] = [];
  for (const candidate of rawPeaks) {
    const last = filtered[filtered.length - 1];
    if (
      last != null &&
      candidate.timeSec - last.timeSec < refractorySec
    ) {
      if (candidate.value > last.value) {
        filtered[filtered.length - 1] = candidate;
      }
      continue;
    }
    filtered.push(candidate);
  }

  return filtered;
}

function matchPeaksToExpected(
  expectedTimesSec: number[],
  peaks: PeakCandidate[],
): Array<number | null> {
  const used = new Set<number>();
  const matched: Array<number | null> = [];

  for (const expected of expectedTimesSec) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < peaks.length; i++) {
      if (used.has(i)) continue;
      const peak = peaks[i];
      if (peak == null) continue;
      const delta = peak.timeSec - expected;
      if (delta < -CLAP_MATCH_WINDOW_EARLY_SEC || delta > CLAP_MATCH_WINDOW_LATE_SEC) {
        continue;
      }
      const distance = Math.abs(delta);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    if (bestIndex === -1) {
      matched.push(null);
      continue;
    }

    used.add(bestIndex);
    matched.push(peaks[bestIndex]?.timeSec ?? null);
  }

  return matched;
}

function buildWaveformPeaks(samples: Float32Array, buckets: number): number[] {
  if (samples.length === 0 || buckets <= 0) return [];
  const window = Math.max(1, Math.floor(samples.length / buckets));
  const peaks: number[] = [];

  for (let i = 0; i < buckets; i++) {
    const from = i * window;
    if (from >= samples.length) {
      peaks.push(0);
      continue;
    }
    const to = Math.min(samples.length, from + window);
    let peak = 0;
    for (let s = from; s < to; s++) {
      const value = Math.abs(samples[s] ?? 0);
      if (value > peak) peak = value;
    }
    peaks.push(peak);
  }

  const max = peaks.reduce((m, v) => (v > m ? v : m), 0);
  if (max <= 1e-6) return peaks.map(() => 0);
  return peaks.map((v) => v / max);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function medianAbsoluteDeviation(values: number[]): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  const med = median(values);
  const abs = values.map((v) => Math.abs(v - med));
  return median(abs);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
  return sorted[index] ?? 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function computeTimingScore(
  matched: Array<number | null>,
  expectedTimesSec: number[],
  secPerBeat: number,
  targetCount: number,
): number {
  const matchedCount = matched.filter((v): v is number => v != null).length;
  if (targetCount <= 0) return 0;

  const completeness = matchedCount / targetCount;
  if (matchedCount <= 1) {
    return Math.round(clamp(completeness * 100, 0, 100));
  }

  const intervalErrors: number[] = [];
  for (let i = 1; i < matched.length; i++) {
    const prev = matched[i - 1];
    const curr = matched[i];
    if (prev == null || curr == null) continue;
    const expectedDelta = (expectedTimesSec[i] ?? 0) - (expectedTimesSec[i - 1] ?? 0);
    const actualDelta = curr - prev;
    const idealDelta = expectedDelta > 0 ? expectedDelta : secPerBeat;
    intervalErrors.push(Math.abs(actualDelta - idealDelta));
  }

  if (intervalErrors.length === 0) {
    return Math.round(clamp(completeness * 100, 0, 100));
  }

  const meanAbsIntervalError =
    intervalErrors.reduce((sum, e) => sum + e, 0) / intervalErrors.length;
  const evenness = clamp(1 - meanAbsIntervalError / 0.12, 0, 1);
  const score = 100 * completeness * (0.4 + 0.6 * evenness);
  return Math.round(clamp(score, 0, 100));
}
