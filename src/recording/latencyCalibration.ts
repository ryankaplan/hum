export const CALIBRATION_TOTAL_BEATS = 8;
export const CALIBRATION_TARGET_BEAT_INDICES = [4, 5, 6, 7] as const;
export const CORRECTION_MIN_SEC = -0.8;
export const CORRECTION_MAX_SEC = 0.8;

export type SpeechCalibrationCapture = {
  audioBuffer: AudioBuffer;
  waveformPeaks: number[];
  sourceStartSec: number;
  durationSec: number;
  secPerBeat: number;
  beatTimesSec: number[];
  targetBeatIndices: number[];
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
};

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
  };
}

export function startCalibrationPreview(
  opts: StartCalibrationPreviewOpts,
): CalibrationPreviewSession {
  const { ctx, audioBuffer } = opts;
  const tempo = Math.max(1, opts.tempo);
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
      const stopClick = playCalibrationClick(ctx, beatTime, beat === 0);
      activeClickStops.add(stopClick);
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.85;
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
  gain.gain.exponentialRampToValueAtTime(0.24, time + 0.002);
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
