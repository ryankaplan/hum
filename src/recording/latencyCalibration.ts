export const CALIBRATION_TOTAL_BEATS = 8;
export const CALIBRATION_TARGET_BEAT_INDICES = [4, 5, 6, 7] as const;
export const CORRECTION_MIN_SEC = -0.8;
export const CORRECTION_MAX_SEC = 0.8;
export const MANUAL_SHIFT_MIN_SEC = -CORRECTION_MAX_SEC;
export const MANUAL_SHIFT_MAX_SEC = -CORRECTION_MIN_SEC;

const PREVIEW_SPEECH_TARGET_LEVEL = 0.12;
const PREVIEW_SPEECH_GAIN_MIN = 0.24;
const PREVIEW_SPEECH_GAIN_MAX = 1.2;
const PREVIEW_CLICK_GAIN = 1;

const AUTO_SHIFT_STEP_SEC = 0.005;
const AUTO_BEAT_MATCH_THRESHOLD = 0.22;
const AUTO_APPLY_CONFIDENCE_THRESHOLD = 0.72;
const AUTO_APPLY_MAX_MEAN_ERROR_SEC = 0.11;

type ShiftScore = {
  shiftSec: number;
  score: number;
  matchedBeatCount: number;
  meanAlignmentErrorSec: number;
};

export type SpeechCalibrationCapture = {
  audioBuffer: AudioBuffer;
  waveformPeaks: number[];
  sourceStartSec: number;
  durationSec: number;
  secPerBeat: number;
  beatTimesSec: number[];
  targetBeatIndices: number[];
  previewSpeechGain: number;
  previewClickGain: number;
};

export type CaptureSpeechCalibrationOpts = {
  ctx: AudioContext;
  stream: MediaStream;
  tempo: number;
  onBeat?: (beatIndex: number, totalBeats: number) => void;
};

export type CalibrationPreviewSession = {
  stop: () => void;
};

export type StartCalibrationPreviewOpts = {
  ctx: AudioContext;
  audioBuffer: AudioBuffer;
  sourceStartSec: number;
  durationSec: number;
  tempo: number;
  manualShiftSec: number;
  previewSpeechGain?: number;
  previewClickGain?: number;
};

export type AutoCalibrationEstimate = {
  manualShiftSec: number;
  correctionSec: number;
  confidence: number;
  matchedBeatCount: number;
  meanAlignmentErrorSec: number;
  scoreSeparation: number;
};

export type AutoCalibrationAttemptResult = {
  capture: SpeechCalibrationCapture;
  estimate: AutoCalibrationEstimate | null;
};

export type PendingCalibrationDraft = {
  capture: SpeechCalibrationCapture;
  suggestedManualShiftSec: number;
  estimate: AutoCalibrationEstimate | null;
};

let pendingCalibrationDraft: PendingCalibrationDraft | null = null;

export function setPendingCalibrationDraft(
  draft: PendingCalibrationDraft | null,
): void {
  pendingCalibrationDraft = draft;
}

export function consumePendingCalibrationDraft(): PendingCalibrationDraft | null {
  const draft = pendingCalibrationDraft;
  pendingCalibrationDraft = null;
  return draft;
}

export async function captureSpeechCalibration(
  opts: CaptureSpeechCalibrationOpts,
): Promise<SpeechCalibrationCapture> {
  const { ctx, stream, onBeat } = opts;
  const tempo = Math.max(1, opts.tempo);
  const secPerBeat = 60 / tempo;

  const startTime = ctx.currentTime + 0.08;
  const stopTime = startTime + CALIBRATION_TOTAL_BEATS * secPerBeat + 0.7;
  const beatTimesCtx = Array.from(
    { length: CALIBRATION_TOTAL_BEATS },
    (_, i) => startTime + i * secPerBeat,
  );

  for (let beat = 0; beat < CALIBRATION_TOTAL_BEATS; beat++) {
    const beatTime = startTime + beat * secPerBeat;
    playCalibrationClick(ctx, beatTime, beat % 4 === 0);
  }

  const beatTracker =
    onBeat != null
      ? createBeatTracker(ctx, beatTimesCtx, (i) =>
          onBeat(i, CALIBRATION_TOTAL_BEATS),
        )
      : null;

  const mimeType = getSupportedCalibrationMimeType();
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 1_500_000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType }));
    };
  });

  recorder.start(100);
  const recorderStartCtxTime = ctx.currentTime;

  try {
    await waitMs(Math.max(0, (stopTime - ctx.currentTime) * 1000));
    recorder.stop();
  } finally {
    beatTracker?.stop();
  }

  const blob = await done;
  const raw = await blob.arrayBuffer();
  const decoded = await ctx.decodeAudioData(raw);
  const mono = downmixToMono(decoded);

  const beatTimesSec = Array.from(
    { length: CALIBRATION_TOTAL_BEATS },
    (_, i) => {
      return (
        startTime + i * secPerBeat + ctx.outputLatency - recorderStartCtxTime
      );
    },
  );
  const secondMeasureStartSec =
    beatTimesSec[CALIBRATION_TARGET_BEAT_INDICES[0]] ?? 0;
  const secondMeasureDurationSec = 4 * secPerBeat;
  const previewSpeechGain = deriveSpeechPreviewGain(
    mono,
    decoded.sampleRate,
    secondMeasureStartSec,
    secondMeasureDurationSec,
  );

  return {
    audioBuffer: decoded,
    waveformPeaks: buildWaveformPeaks(
      mono,
      decoded.sampleRate,
      secondMeasureStartSec,
      secondMeasureDurationSec,
      1400,
    ),
    sourceStartSec: secondMeasureStartSec,
    durationSec: secondMeasureDurationSec,
    secPerBeat,
    beatTimesSec: [0, secPerBeat, secPerBeat * 2, secPerBeat * 3],
    targetBeatIndices: [0, 1, 2, 3],
    previewSpeechGain,
    previewClickGain: PREVIEW_CLICK_GAIN,
  };
}

export async function runBestEffortAutoCalibration(
  opts: CaptureSpeechCalibrationOpts,
): Promise<AutoCalibrationAttemptResult> {
  const capture = await captureSpeechCalibration(opts);
  const estimate = estimateAutoCalibration(capture);
  return { capture, estimate };
}

export function shouldAutoApplyCalibration(
  estimate: AutoCalibrationEstimate | null,
): boolean {
  if (estimate == null) return false;
  return (
    estimate.confidence >= AUTO_APPLY_CONFIDENCE_THRESHOLD &&
    estimate.matchedBeatCount >= 3 &&
    estimate.meanAlignmentErrorSec <= AUTO_APPLY_MAX_MEAN_ERROR_SEC
  );
}

export function startCalibrationPreview(
  opts: StartCalibrationPreviewOpts,
): CalibrationPreviewSession {
  const { ctx, audioBuffer } = opts;
  const tempo = Math.max(1, opts.tempo);
  const previewSpeechGain = clamp(
    opts.previewSpeechGain ?? 0.85,
    PREVIEW_SPEECH_GAIN_MIN,
    PREVIEW_SPEECH_GAIN_MAX,
  );
  const previewClickGain = clamp(opts.previewClickGain ?? 1, 0.25, 1.75);
  const secPerBeat = 60 / tempo;
  const loopDurationSec = Math.max(0.01, opts.durationSec);
  // Allow enough lead time so small negative shifts can still be scheduled.
  const startLeadSec = 0.9;
  const scheduleHorizonSec = 0.5;

  let nextLoopStart = ctx.currentTime + startLeadSec;
  let stopped = false;
  const activeSources = new Set<AudioBufferSourceNode>();
  const activeGains = new Set<GainNode>();
  const activeClickStops = new Set<() => void>();

  function stopNodes() {
    for (const stop of activeClickStops) {
      stop();
    }
    activeClickStops.clear();
    for (const source of activeSources) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
      source.disconnect();
    }
    for (const gain of activeGains) {
      gain.disconnect();
    }
    activeSources.clear();
    activeGains.clear();
  }

  function scheduleLoop(loopStartSec: number) {
    for (let beat = 0; beat < 4; beat++) {
      const beatTime = loopStartSec + beat * secPerBeat;
      const stopClick = playCalibrationClick(
        ctx,
        beatTime,
        beat === 0,
        previewClickGain,
      );
      activeClickStops.add(stopClick);
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    const gain = ctx.createGain();
    gain.gain.value = previewSpeechGain;
    source.connect(gain);
    gain.connect(ctx.destination);

    const desiredStartSec = loopStartSec + opts.manualShiftSec;
    const earliestStartSec = ctx.currentTime + 0.01;
    const safeStartSec = Math.max(desiredStartSec, earliestStartSec);
    const startDeltaSec = Math.max(0, safeStartSec - desiredStartSec);
    const sourceStartSec = opts.sourceStartSec + startDeltaSec;

    if (sourceStartSec < audioBuffer.duration - 0.01) {
      const maxPlayableSec = Math.max(
        0,
        Math.min(loopDurationSec, audioBuffer.duration - sourceStartSec),
      );
      if (maxPlayableSec > 0) {
        source.start(safeStartSec, sourceStartSec, maxPlayableSec);
        source.stop(loopStartSec + loopDurationSec + 0.05);
        activeSources.add(source);
        activeGains.add(gain);
        source.onended = () => {
          source.disconnect();
          gain.disconnect();
          activeSources.delete(source);
          activeGains.delete(gain);
        };
      } else {
        source.disconnect();
        gain.disconnect();
      }
    } else {
      source.disconnect();
      gain.disconnect();
    }
  }

  const tickerId = window.setInterval(() => {
    if (stopped) return;
    while (nextLoopStart - ctx.currentTime < scheduleHorizonSec) {
      scheduleLoop(nextLoopStart);
      nextLoopStart += loopDurationSec;
    }
  }, 120);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(tickerId);
      stopNodes();
    },
  };
}

export function manualShiftToCorrectionSec(manualShiftSec: number): number {
  return clamp(-manualShiftSec, CORRECTION_MIN_SEC, CORRECTION_MAX_SEC);
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

// Lower-volume click for calibration so metronome bleed does not dominate the
// captured speech waveform (especially on speech-optimized Bluetooth routes).
function playCalibrationClick(
  ctx: AudioContext,
  time: number,
  isDownbeat: boolean,
  gainScale = 1,
): () => void {
  const gain = ctx.createGain();
  gain.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.connect(gain);

  const startFreq = isDownbeat ? 220 : 170;
  const endFreq = isDownbeat ? 60 : 50;
  osc.frequency.setValueAtTime(startFreq, time);
  osc.frequency.exponentialRampToValueAtTime(endFreq, time + 0.035);

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.exponentialRampToValueAtTime(0.24 * gainScale, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.09);

  osc.start(time);
  osc.stop(time + 0.11);
  let ended = false;
  osc.onended = () => {
    ended = true;
    gain.disconnect();
  };
  return () => {
    if (ended) return;
    try {
      osc.stop();
    } catch {
      // already stopped
    }
    gain.disconnect();
  };
}

function downmixToMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  const channelCount = Math.max(1, buffer.numberOfChannels);
  for (let c = 0; c < channelCount; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < buffer.length; i++) {
      mono[i] = (mono[i] ?? 0) + (channel[i] ?? 0) / channelCount;
    }
  }
  return mono;
}

function buildWaveformPeaks(
  samples: Float32Array,
  sampleRate: number,
  sourceStartSec: number,
  durationSec: number,
  buckets: number,
): number[] {
  if (
    samples.length === 0 ||
    buckets <= 0 ||
    sampleRate <= 0 ||
    durationSec <= 0
  ) {
    return [];
  }
  const start = Math.max(0, Math.floor(sourceStartSec * sampleRate));
  const end = Math.min(
    samples.length,
    Math.floor((sourceStartSec + durationSec) * sampleRate),
  );
  if (end <= start) return [];
  const window = Math.max(1, Math.floor((end - start) / buckets));
  const peaks: number[] = [];

  for (let i = 0; i < buckets; i++) {
    const from = start + i * window;
    if (from >= end) {
      peaks.push(0);
      continue;
    }
    const to = Math.min(end, from + window);
    let sumSquares = 0;
    let maxAbs = 0;
    for (let s = from; s < to; s++) {
      const value = samples[s] ?? 0;
      const abs = Math.abs(value);
      sumSquares += value * value;
      if (abs > maxAbs) maxAbs = abs;
    }
    const sampleCount = Math.max(1, to - from);
    const rms = Math.sqrt(sumSquares / sampleCount);
    // Mix RMS + peak to retain consonants while keeping speech body visible.
    peaks.push(0.7 * rms + 0.3 * maxAbs);
  }

  const p95 = percentile(peaks, 0.95);
  if (p95 <= 1e-6) return peaks.map(() => 0);
  // Compress dynamic range so a few hot transients do not flatten everything else.
  return peaks.map((v) => Math.pow(clamp(v / p95, 0, 1), 0.65));
}

function estimateAutoCalibration(
  capture: SpeechCalibrationCapture,
): AutoCalibrationEstimate | null {
  const beatTimes = capture.beatTimesSec;
  if (beatTimes.length === 0) return null;

  const mono = downmixToMono(capture.audioBuffer);
  const envelope = buildOnsetEnvelope(
    mono,
    capture.audioBuffer.sampleRate,
    capture.sourceStartSec,
    capture.durationSec,
  );
  if (envelope.values.length === 0 || envelope.energyP95 <= 1e-6) {
    return null;
  }

  const searchRadiusSec = clamp(capture.secPerBeat * 0.28, 0.09, 0.24);
  let best: ShiftScore | null = null;
  let secondBest: ShiftScore | null = null;

  for (
    let shiftSec = MANUAL_SHIFT_MIN_SEC;
    shiftSec <= MANUAL_SHIFT_MAX_SEC + 1e-6;
    shiftSec += AUTO_SHIFT_STEP_SEC
  ) {
    const scored = scoreShiftCandidate(
      envelope,
      beatTimes,
      shiftSec,
      searchRadiusSec,
    );
    if (best == null || scored.score > best.score) {
      secondBest = best;
      best = scored;
    } else if (secondBest == null || scored.score > secondBest.score) {
      secondBest = scored;
    }
  }

  if (best == null || best.matchedBeatCount === 0) return null;

  const coverage = best.matchedBeatCount / beatTimes.length;
  const meanErrorNorm =
    1 - clamp(best.meanAlignmentErrorSec / Math.max(0.04, searchRadiusSec), 0, 1);
  const scoreSeparation =
    best.score > 1e-6
      ? clamp((best.score - (secondBest?.score ?? 0)) / best.score, 0, 1)
      : 0;
  const scoreNorm = clamp(best.score / Math.max(1, beatTimes.length), 0, 1);
  const confidence = clamp(
    coverage * 0.45 +
      meanErrorNorm * 0.25 +
      scoreSeparation * 0.2 +
      scoreNorm * 0.1,
    0,
    1,
  );

  const manualShiftSec = clamp(
    best.shiftSec,
    MANUAL_SHIFT_MIN_SEC,
    MANUAL_SHIFT_MAX_SEC,
  );
  return {
    manualShiftSec,
    correctionSec: manualShiftToCorrectionSec(manualShiftSec),
    confidence,
    matchedBeatCount: best.matchedBeatCount,
    meanAlignmentErrorSec: best.meanAlignmentErrorSec,
    scoreSeparation,
  };
}

type OnsetEnvelope = {
  values: number[];
  startSec: number;
  stepSec: number;
  energyP95: number;
};

function buildOnsetEnvelope(
  samples: Float32Array,
  sampleRate: number,
  sourceStartSec: number,
  durationSec: number,
): OnsetEnvelope {
  if (samples.length === 0 || sampleRate <= 0 || durationSec <= 0) {
    return { values: [], startSec: 0, stepSec: 0, energyP95: 0 };
  }

  const analysisStartSec = sourceStartSec + MANUAL_SHIFT_MIN_SEC - 0.25;
  const analysisEndSec = sourceStartSec + durationSec + MANUAL_SHIFT_MAX_SEC + 0.25;
  const start = Math.max(0, Math.floor(analysisStartSec * sampleRate));
  const end = Math.min(samples.length, Math.floor(analysisEndSec * sampleRate));
  if (end <= start) {
    return { values: [], startSec: 0, stepSec: 0, energyP95: 0 };
  }

  const frameSize = Math.max(1, Math.floor(sampleRate * 0.004));
  const frameCount = Math.max(1, Math.ceil((end - start) / frameSize));
  const raw: number[] = new Array(frameCount).fill(0);
  for (let i = 0; i < frameCount; i++) {
    const from = start + i * frameSize;
    const to = Math.min(end, from + frameSize);
    if (to <= from) continue;
    let sumAbs = 0;
    for (let s = from; s < to; s++) {
      sumAbs += Math.abs(samples[s] ?? 0);
    }
    raw[i] = sumAbs / (to - from);
  }

  const fast = movingAverage(raw, 2);
  const slow = movingAverage(raw, 10);
  const onsetRaw: number[] = new Array(frameCount).fill(0);
  for (let i = 0; i < frameCount; i++) {
    const base = Math.max(0, (fast[i] ?? 0) - (slow[i] ?? 0) * 0.95);
    const rise = i === 0 ? base : Math.max(0, base - (onsetRaw[i - 1] ?? 0));
    onsetRaw[i] = base * 0.75 + rise * 0.25;
  }

  const energyP95 = percentile(onsetRaw, 0.95);
  if (energyP95 <= 1e-6) {
    return {
      values: onsetRaw.map(() => 0),
      startSec: start / sampleRate - sourceStartSec,
      stepSec: frameSize / sampleRate,
      energyP95,
    };
  }

  return {
    values: onsetRaw.map((v) => clamp(v / energyP95, 0, 1)),
    startSec: start / sampleRate - sourceStartSec,
    stepSec: frameSize / sampleRate,
    energyP95,
  };
}

function scoreShiftCandidate(
  envelope: OnsetEnvelope,
  beatTimesSec: number[],
  shiftSec: number,
  searchRadiusSec: number,
): ShiftScore {
  let score = 0;
  let matchedBeatCount = 0;
  let errorSumSec = 0;

  for (const beatTimeSec of beatTimesSec) {
    const { value, peakTimeSec } = findWindowPeak(
      envelope,
      beatTimeSec - shiftSec,
      searchRadiusSec,
    );
    score += value;
    if (value >= AUTO_BEAT_MATCH_THRESHOLD) {
      matchedBeatCount += 1;
      errorSumSec += Math.abs(peakTimeSec + shiftSec - beatTimeSec);
    }
  }

  const meanAlignmentErrorSec =
    matchedBeatCount > 0 ? errorSumSec / matchedBeatCount : searchRadiusSec;
  // Gentle edge penalty so flat/noisy captures do not collapse to ±800ms.
  const edgePenalty = 0.05 * (Math.abs(shiftSec) / Math.max(0.001, MANUAL_SHIFT_MAX_SEC));
  return {
    shiftSec,
    score: score - edgePenalty,
    matchedBeatCount,
    meanAlignmentErrorSec,
  };
}

function findWindowPeak(
  envelope: OnsetEnvelope,
  centerSec: number,
  radiusSec: number,
): { value: number; peakTimeSec: number } {
  const { values, startSec, stepSec } = envelope;
  if (values.length === 0 || stepSec <= 0) {
    return { value: 0, peakTimeSec: centerSec };
  }

  const minIndex = Math.max(
    0,
    Math.floor((centerSec - radiusSec - startSec) / stepSec),
  );
  const maxIndex = Math.min(
    values.length - 1,
    Math.ceil((centerSec + radiusSec - startSec) / stepSec),
  );
  if (maxIndex < minIndex) {
    return { value: 0, peakTimeSec: centerSec };
  }

  let bestIndex = minIndex;
  let bestWeightedValue = -Infinity;
  for (let i = minIndex; i <= maxIndex; i++) {
    const value = values[i] ?? 0;
    const sec = startSec + i * stepSec;
    const distance = Math.abs(sec - centerSec);
    const proximity = 1 - clamp(distance / Math.max(1e-3, radiusSec), 0, 1);
    const weightedValue = value * (0.65 + 0.35 * proximity);
    if (weightedValue > bestWeightedValue) {
      bestWeightedValue = weightedValue;
      bestIndex = i;
    }
  }

  return {
    value: values[bestIndex] ?? 0,
    peakTimeSec: startSec + bestIndex * stepSec,
  };
}

function movingAverage(values: number[], radius: number): number[] {
  if (values.length === 0) return [];
  const prefix = new Array(values.length + 1).fill(0);
  for (let i = 0; i < values.length; i++) {
    prefix[i + 1] = (prefix[i] ?? 0) + (values[i] ?? 0);
  }

  const smoothed = new Array(values.length).fill(0);
  for (let i = 0; i < values.length; i++) {
    const from = Math.max(0, i - radius);
    const to = Math.min(values.length - 1, i + radius);
    const count = Math.max(1, to - from + 1);
    smoothed[i] = ((prefix[to + 1] ?? 0) - (prefix[from] ?? 0)) / count;
  }
  return smoothed;
}

function deriveSpeechPreviewGain(
  samples: Float32Array,
  sampleRate: number,
  sourceStartSec: number,
  durationSec: number,
): number {
  const start = Math.max(0, Math.floor(sourceStartSec * sampleRate));
  const end = Math.min(
    samples.length,
    Math.floor((sourceStartSec + durationSec) * sampleRate),
  );
  if (end <= start || sampleRate <= 0) {
    return 0.85;
  }

  let sumSquares = 0;
  const absValues: number[] = [];
  for (let i = start; i < end; i++) {
    const value = samples[i] ?? 0;
    const abs = Math.abs(value);
    absValues.push(abs);
    sumSquares += value * value;
  }

  const sampleCount = Math.max(1, end - start);
  const rms = Math.sqrt(sumSquares / sampleCount);
  const p90Abs = percentile(absValues, 0.9);
  const loudness = 0.72 * rms + 0.28 * p90Abs;
  if (!Number.isFinite(loudness) || loudness <= 1e-5) {
    return 0.85;
  }
  return clamp(
    PREVIEW_SPEECH_TARGET_LEVEL / loudness,
    PREVIEW_SPEECH_GAIN_MIN,
    PREVIEW_SPEECH_GAIN_MAX,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))),
  );
  return sorted[index] ?? 0;
}

function createBeatTracker(
  ctx: AudioContext,
  beatTimes: number[],
  onBeat: (index: number) => void,
): { stop: () => void } {
  let lastFired = -1;
  const id = setInterval(() => {
    const now = ctx.currentTime;
    for (let i = lastFired + 1; i < beatTimes.length; i++) {
      const t = beatTimes[i];
      if (t != null && now >= t) {
        lastFired = i;
        onBeat(i);
      } else {
        break;
      }
    }
  }, 16);
  return { stop: () => clearInterval(id) };
}
