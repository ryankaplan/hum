import { Derived, Observable, PersistedObservable } from "../observable";
import { generateHarmony } from "../music/harmony";
import { parseChordProgression } from "../music/parse";
import { progressionDurationSec } from "../music/playback";
import { noteNameToMidi } from "../music/types";
import type { Chord, HarmonyVoicing, Meter, PartIndex } from "../music/types";
import type {
  ClapCalibrationConfidence,
  ClapCalibrationResult,
} from "../recording/clapCalibration";
import type { Mixer } from "../audio/mixer";
import type { CompositorHandle } from "../video/compositor";
import { buildWaveformPeaks } from "../ui/timeline";
import { TracksModel } from "./tracksModel";
import type { TakeRecord } from "./tracksModel";

type WaveformPeaks = number[];

export type {
  TrackClip,
  TrackLane,
  TrackEditorSelection,
  TracksState,
  TakeRecord,
} from "./tracksModel";

export type {
  ClapCalibrationConfidence,
  ClapCalibrationResult,
} from "../recording/clapCalibration";

export type AppScreen = "setup" | "calibration" | "recording" | "review";

export type PartState =
  | { status: "idle" }
  | { status: "recording" }
  | { status: "review"; blob: Blob; url: string }
  | { status: "kept"; blob: Blob; url: string; trimOffsetSec: number };

export type TotalPartCount = 2 | 4;

export type ArrangementInput = {
  chordsInput: string;
  tempo: number;
  meter: Meter;
  vocalRangeLow: string;
  vocalRangeHigh: string;
  totalParts: TotalPartCount;
};

export type ArrangementInfo = {
  input: ArrangementInput;
  parsedChords: Chord[];
  harmonyVoicing: HarmonyVoicing | null;
  beatSec: number;
  progressionDurationSec: number;
  isValid: boolean;
};

export type KeepTakeInput = {
  laneIndex: number;
  blob: Blob;
  url: string;
  trimOffsetSec: number;
};

export type RuntimeTakeMediaIngestInput = {
  takeId: string;
  laneIndex: number;
  blob: Blob;
  trimOffsetSec: number;
  ctx: AudioContext;
  videoEl: HTMLVideoElement;
  maxDurationSec: number;
  waveformBuckets?: number;
};

export type TakeSourceWindow = {
  sourceStartSec: number;
  durationSec: number;
};

export type LaneRuntimeWaveform = {
  takeId: string;
  peaks: WaveformPeaks;
  sourceWindow: TakeSourceWindow;
} | null;

function parseTotalPartCount(raw: unknown): TotalPartCount {
  return raw === 2 ? 2 : 4;
}

function createIdlePartStates(totalParts: number): PartState[] {
  return Array.from({ length: totalParts }, () => ({
    status: "idle" as const,
  }));
}

class AppModel {
  private nextTakeId = 0;
  private audioBuffersByTakeId = new Map<string, AudioBuffer>();
  private waveformPeaksByTakeId = new Map<string, WaveformPeaks>();
  private videoElByTakeId = new Map<string, HTMLVideoElement>();
  private takeSourceWindowByTakeId = new Map<string, TakeSourceWindow>();

  readonly chordsInput = new PersistedObservable<string>(
    "hum.chords",
    "A A F#m F#m D D E E",
  );

  readonly tempoInput = new PersistedObservable<number>("hum.tempo", 80);

  readonly meterInput = new PersistedObservable<Meter>("hum.meter", [4, 4]);

  readonly vocalRangeLow = new PersistedObservable<string>(
    "hum.vocalRangeLow",
    "C3",
  );

  readonly vocalRangeHigh = new PersistedObservable<string>(
    "hum.vocalRangeHigh",
    "C5",
  );

  readonly totalPartsInput = new PersistedObservable<TotalPartCount>(
    "hum.totalParts",
    4,
    { schema: parseTotalPartCount },
  );

  readonly appScreen = new Observable<AppScreen>("setup");
  readonly mediaStream = new Observable<MediaStream | null>(null);
  readonly audioContext = new Observable<AudioContext | null>(null);
  readonly currentPartIndex = new Observable<PartIndex>(0);
  readonly permissionError = new Observable<string | null>(null);
  readonly clapCalibrationResult = new Observable<ClapCalibrationResult | null>(
    null,
  );
  readonly latencyCorrectionSec = new Observable<number>(0);
  readonly calibrationConfidence =
    new Observable<ClapCalibrationConfidence | null>(null);
  readonly isCalibrated = new Observable<boolean>(false);

  readonly partStates = new Observable<PartState[]>(
    createIdlePartStates(this.totalPartsInput.get()),
  );

  readonly arrangementInfo = new Observable<ArrangementInfo>(
    this.computeArrangementInfo(),
  );

  // Mutable runtime systems remain exposed.
  mixer: Mixer | null = null;
  compositor: CompositorHandle | null = null;

  readonly tracksModel = new TracksModel({
    totalParts: this.totalPartsInput.get(),
    getMixer: () => this.mixer,
  });

  readonly parsedChords = new Derived<Chord[]>(
    () => this.arrangementInfo.get().parsedChords,
    [this.arrangementInfo],
    { checkForEqualityOnNotify: false },
  );

  readonly harmonyVoicing = new Derived<HarmonyVoicing | null>(
    () => this.arrangementInfo.get().harmonyVoicing,
    [this.arrangementInfo],
    { checkForEqualityOnNotify: false },
  );

  constructor() {
    this.chordsInput.register(this.recomputeArrangement);
    this.tempoInput.register(this.recomputeArrangement);
    this.meterInput.register(this.recomputeArrangement);
    this.vocalRangeLow.register(this.recomputeArrangement);
    this.vocalRangeHigh.register(this.recomputeArrangement);

    this.totalPartsInput.register(() => {
      this.recomputeArrangement();
      this.resizePartCount(this.totalPartsInput.get());
    });
  }

  setArrangementInput(patch: Partial<ArrangementInput>): void {
    if (patch.chordsInput != null) {
      this.chordsInput.set(patch.chordsInput);
    }
    if (patch.tempo != null) {
      this.tempoInput.set(patch.tempo);
    }
    if (patch.meter != null) {
      this.meterInput.set(patch.meter);
    }
    if (patch.vocalRangeLow != null) {
      this.vocalRangeLow.set(patch.vocalRangeLow);
    }
    if (patch.vocalRangeHigh != null) {
      this.vocalRangeHigh.set(patch.vocalRangeHigh);
    }
    if (patch.totalParts != null) {
      this.totalPartsInput.set(patch.totalParts);
    }
  }

  recomputeArrangement = (): void => {
    this.arrangementInfo.set(this.computeArrangementInfo());
  };

  updatePartState(index: number, state: PartState): void {
    const current = this.partStates.get();
    if (index < 0 || index >= current.length) return;

    const next = [...current];
    next[index] = state;
    this.partStates.set(next);
  }

  keepRecordedTake(input: KeepTakeInput): void {
    const { laneIndex, blob, url, trimOffsetSec } = input;

    this.updatePartState(laneIndex, {
      status: "kept",
      blob,
      url,
      trimOffsetSec,
    });

    const takeId = this.makeTakeId();
    const arrangement = this.arrangementInfo.get();

    const take: TakeRecord = {
      id: takeId,
      laneIndex,
      blob,
      url,
      trimOffsetSec,
    };

    const replacedTake = this.tracksModel.stageKeptTake({
      laneIndex,
      take,
      sourceStartSec: Math.max(0, trimOffsetSec),
      durationSec: Math.max(0, arrangement.progressionDurationSec),
    });

    if (replacedTake != null) {
      URL.revokeObjectURL(replacedTake.url);
      this.removeTakeRuntimeMedia(replacedTake.id);
    }
  }

  async ingestTakeRuntimeMedia(
    input: RuntimeTakeMediaIngestInput,
  ): Promise<boolean> {
    const {
      takeId,
      laneIndex,
      blob,
      trimOffsetSec,
      ctx,
      videoEl,
      maxDurationSec,
      waveformBuckets = 400,
    } = input;

    this.videoElByTakeId.set(takeId, videoEl);

    const raw = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(raw);

    const current = this.tracksModel.tracks.get();
    if (current.laneTakeIds[laneIndex] !== takeId) {
      return false;
    }

    const sourceStartSec = Math.min(
      Math.max(0, trimOffsetSec),
      decoded.duration,
    );
    const rawDuration = Math.max(0, decoded.duration - sourceStartSec);
    const durationSec = Math.max(
      0,
      Math.min(rawDuration, Math.max(0, maxDurationSec)),
    );

    this.audioBuffersByTakeId.set(takeId, decoded);
    this.takeSourceWindowByTakeId.set(takeId, {
      sourceStartSec,
      durationSec,
    });
    this.waveformPeaksByTakeId.set(
      takeId,
      buildWaveformPeaks(decoded, sourceStartSec, durationSec, waveformBuckets),
    );

    this.tracksModel.initializeTrackFromTake(
      laneIndex,
      takeId,
      sourceStartSec,
      durationSec,
    );
    return true;
  }

  getTakeAudioBuffer(takeId: string): AudioBuffer | null {
    return this.audioBuffersByTakeId.get(takeId) ?? null;
  }

  getTakeWaveform(takeId: string): WaveformPeaks | null {
    return this.waveformPeaksByTakeId.get(takeId) ?? null;
  }

  getTakeSourceWindow(takeId: string): TakeSourceWindow | null {
    return this.takeSourceWindowByTakeId.get(takeId) ?? null;
  }

  getTakeVideoElement(takeId: string): HTMLVideoElement | null {
    return this.videoElByTakeId.get(takeId) ?? null;
  }

  getLaneRuntimeWaveform(laneIndex: number): LaneRuntimeWaveform {
    const takeId = this.tracksModel.tracks.get().laneTakeIds[laneIndex];
    if (takeId == null) return null;

    const peaks = this.getTakeWaveform(takeId);
    const sourceWindow = this.getTakeSourceWindow(takeId);
    if (peaks == null || sourceWindow == null) return null;

    return {
      takeId,
      peaks,
      sourceWindow,
    };
  }

  clearRuntimeTakeMedia(): void {
    this.audioBuffersByTakeId.clear();
    this.waveformPeaksByTakeId.clear();
    this.videoElByTakeId.clear();
    this.takeSourceWindowByTakeId.clear();
  }

  removeTakeRuntimeMedia(takeId: string): void {
    this.audioBuffersByTakeId.delete(takeId);
    this.waveformPeaksByTakeId.delete(takeId);
    this.videoElByTakeId.delete(takeId);
    this.takeSourceWindowByTakeId.delete(takeId);
  }

  redoPart(index: number): void {
    this.updatePartState(index, { status: "idle" });
    this.currentPartIndex.set(index);
    this.appScreen.set("recording");

    const removedTake = this.tracksModel.clearLane(index);
    if (removedTake != null) {
      URL.revokeObjectURL(removedTake.url);
      this.removeTakeRuntimeMedia(removedTake.id);
    }
  }

  getKeptBlobs(): (Blob | null)[] {
    return this.partStates
      .get()
      .map((state) => (state.status === "kept" ? state.blob : null));
  }

  setClapCalibrationResult(result: ClapCalibrationResult): void {
    this.clapCalibrationResult.set(result);
    this.latencyCorrectionSec.set(result.correctionSec);
    this.calibrationConfidence.set(result.confidence);
    this.isCalibrated.set(true);
  }

  clearClapCalibration(): void {
    this.clapCalibrationResult.set(null);
    this.latencyCorrectionSec.set(0);
    this.calibrationConfidence.set(null);
    this.isCalibrated.set(false);
  }

  resetSession(): void {
    this.currentPartIndex.set(0);
    this.partStates.set(createIdlePartStates(this.totalPartsInput.get()));
    this.permissionError.set(null);
    this.clearClapCalibration();

    const removedTakes = this.tracksModel.reset(this.totalPartsInput.get());
    for (const take of removedTakes) {
      URL.revokeObjectURL(take.url);
    }

    this.clearRuntimeTakeMedia();

    this.mixer?.dispose();
    this.mixer = null;

    this.compositor?.stop();
    this.compositor = null;
  }

  private computeArrangementInfo(): ArrangementInfo {
    const input: ArrangementInput = {
      chordsInput: this.chordsInput.get(),
      tempo: this.tempoInput.get(),
      meter: this.meterInput.get(),
      vocalRangeLow: this.vocalRangeLow.get(),
      vocalRangeHigh: this.vocalRangeHigh.get(),
      totalParts: this.totalPartsInput.get(),
    };

    const parsed = parseChordProgression(input.chordsInput, input.meter[0]);

    let voicing: HarmonyVoicing | null = null;
    try {
      const low = noteNameToMidi(input.vocalRangeLow);
      const high = noteNameToMidi(input.vocalRangeHigh);
      if (high > low && parsed.length > 0) {
        const harmonyPartCount = Math.max(1, input.totalParts - 1);
        voicing = generateHarmony(parsed, { low, high }, harmonyPartCount);
      }
    } catch {
      voicing = null;
    }

    const beatSec = input.tempo > 0 ? 60 / input.tempo : 0;

    return {
      input,
      parsedChords: parsed,
      harmonyVoicing: voicing,
      beatSec,
      progressionDurationSec:
        parsed.length > 0 && input.tempo > 0
          ? progressionDurationSec(parsed, input.tempo)
          : 0,
      isValid: parsed.length > 0 && voicing != null,
    };
  }

  private resizePartCount(totalParts: number): void {
    this.partStates.set(
      this.resizePartStates(this.partStates.get(), totalParts),
    );

    const clampedPartIndex = Math.min(
      Math.max(0, this.currentPartIndex.get()),
      Math.max(0, totalParts - 1),
    );
    this.currentPartIndex.set(clampedPartIndex);

    const removedTakes = this.tracksModel.resizeForPartCount(totalParts);
    for (const take of removedTakes) {
      URL.revokeObjectURL(take.url);
      this.removeTakeRuntimeMedia(take.id);
    }
  }

  private resizePartStates(
    current: PartState[],
    totalParts: number,
  ): PartState[] {
    const next = current.slice(0, totalParts);
    while (next.length < totalParts) {
      next.push({ status: "idle" });
    }
    return next;
  }

  private makeTakeId(): string {
    this.nextTakeId += 1;
    return `take-${this.nextTakeId}`;
  }
}

export function Model(): AppModel {
  return new AppModel();
}

export const model = Model();
