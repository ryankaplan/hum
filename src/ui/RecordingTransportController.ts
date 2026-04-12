import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  createMonitorPlayer,
  decodeMonitorLanes,
  type EncodedMonitorSegment,
  type MonitorLane,
  type MonitorPlayer,
} from "../audio/monitorPlayer";
import type { ArrangementVoice } from "../music/arrangementScore";
import {
  progressionDurationSec,
  startRecordingPlayback,
  stopAllPlayback,
  type PlaybackSession,
} from "../music/playback";
import type { Chord, HarmonyLine, MidiNote } from "../music/types";
import {
  isRecordingCancelledError,
  startRecordTake,
  type RecordingSession,
} from "../recording/recorder";
import { model, type TrackId, type TracksDocumentState } from "../state/model";
import {
  buildReferenceWaveform,
  type ReferenceWaveform,
} from "./waveformRendering";
import {
  gradeHarmonyTake,
  type HarmonyTakeScores,
  type ScoringAudioSegment,
} from "../recording/takeScoring";

export type RecordPhase =
  | "pre-roll"
  | "listening"
  | "counting-in"
  | "recording"
  | "review";

export type RecordingTransportSnapshot = {
  phase: RecordPhase;
  activeChordIndex: number;
  countInBeat: number;
  currentAbsoluteBeat: number;
  reviewUrl: string | null;
  reviewScores: HarmonyTakeScores | null;
  guideToneEnabled: boolean;
  mutedParts: boolean[];
  referenceWaveform: ReferenceWaveform | null;
};

export type RecordingTransportInputs = {
  ctx: AudioContext | null;
  stream: MediaStream | null;
  partIndex: number;
  totalParts: number;
  orderedTrackIds: TrackId[];
  tracksRevision: TracksDocumentState;
  chords: Chord[];
  harmonyLine: HarmonyLine | null;
  arrangementVoice: ArrangementVoice | null;
  melodyBackingLines: HarmonyLine[];
  backingArrangementVoices: ArrangementVoice[];
  countInCueMidi?: MidiNote | null;
  beatsPerBar: number;
  tempo: number;
  alignmentCorrectionSec: number;
  guideToneVolume: number;
  beatVolume: number;
  priorHarmonyLevel: number;
};

export function selectReferenceWaveformLane<
  T extends { trackId: TrackId; segments: ArrayLike<unknown> },
>(
  lanes: readonly T[],
  referenceWaveformTrackId: TrackId | null,
): T | null {
  if (referenceWaveformTrackId == null) return null;
  return (
    lanes.find(
      (lane) =>
        lane.trackId === referenceWaveformTrackId && lane.segments.length > 0,
    ) ?? null
  );
}

export function selectMonitorTrackIndices(
  orderedTrackIds: readonly TrackId[],
  currentTrackId: TrackId | null,
): number[] {
  return orderedTrackIds.flatMap((trackId, index) =>
    trackId !== currentTrackId ? [index] : [],
  );
}

type EncodedMonitorLane = {
  trackId: TrackId;
  partIndex: number;
  segments: EncodedMonitorSegment[];
};

type ScoredMonitorSegment = ScoringAudioSegment;

type PendingTake = {
  blob: Blob;
  alignmentOffsetSec: number;
};

const INITIAL_SNAPSHOT: RecordingTransportSnapshot = {
  phase: "pre-roll",
  activeChordIndex: 0,
  countInBeat: 0,
  currentAbsoluteBeat: -1,
  reviewUrl: null,
  reviewScores: null,
  guideToneEnabled: true,
  mutedParts: [],
  referenceWaveform: null,
};

async function decodeBlobAudio(
  ctx: AudioContext,
  blob: Blob,
): Promise<AudioBuffer> {
  const raw = await blob.arrayBuffer();
  return await ctx.decodeAudioData(raw);
}

export class RecordingTransportController {
  private snapshot: RecordingTransportSnapshot = INITIAL_SNAPSHOT;
  private listeners = new Set<() => void>();
  private inputs: RecordingTransportInputs | null = null;

  private monitorPlayer: MonitorPlayer | null = null;
  private beatGain: GainNode | null = null;
  private guideToneGain: GainNode | null = null;
  private monitorLanePartIndices: number[] = [];
  private listenSession: PlaybackSession | null = null;
  private recordSession: RecordingSession | null = null;
  private pendingTake: PendingTake | null = null;
  private listenTimeoutId: number | null = null;
  private monitorBuildVersion = 0;
  private reviewScoreVersion = 0;
  private disposed = false;

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  syncInputs(next: RecordingTransportInputs): void {
    if (this.disposed) return;

    const prev = this.inputs;
    this.inputs = next;

    if (prev == null || prev.totalParts !== next.totalParts) {
      this.resizeMutedParts(next.totalParts);
    }

    const monitorNeedsRebuild =
      prev == null ||
      prev.ctx !== next.ctx ||
      prev.partIndex !== next.partIndex ||
      prev.tracksRevision !== next.tracksRevision ||
      prev.chords !== next.chords ||
      prev.tempo !== next.tempo;

    if (monitorNeedsRebuild) {
      this.invalidateMonitorPlayer();
    }

    if (prev != null && prev.partIndex !== next.partIndex) {
      this.resetForPartChange();
    }

    if (prev == null || prev.ctx !== next.ctx) {
      this.rebuildOutputGains();
    }

    if (prev == null || prev.beatVolume !== next.beatVolume || prev.ctx !== next.ctx) {
      this.applyBeatVolume();
    }

    if (
      prev == null ||
      prev.guideToneVolume !== next.guideToneVolume ||
      prev.ctx !== next.ctx
    ) {
      this.applyGuideToneLevel();
    }

    if (
      prev == null ||
      prev.priorHarmonyLevel !== next.priorHarmonyLevel ||
      monitorNeedsRebuild
    ) {
      this.monitorPlayer?.setLevel(next.priorHarmonyLevel);
    }

    if (monitorNeedsRebuild) {
      void this.rebuildMonitorPlayer();
    }
  }

  toggleMute(index: number): void {
    const nextMutedParts = [...this.snapshot.mutedParts];
    nextMutedParts[index] = !(nextMutedParts[index] ?? false);
    this.updateSnapshot({ mutedParts: nextMutedParts });
    this.applyMutedParts();
  }

  setGuideToneEnabled(enabled: boolean): void {
    if (this.snapshot.guideToneEnabled === enabled) return;
    this.updateSnapshot({ guideToneEnabled: enabled });
    this.applyGuideToneLevel();
  }

  toggleGuideToneEnabled = () => {
    this.setGuideToneEnabled(!this.snapshot.guideToneEnabled);
  };

  getPendingTake(): PendingTake | null {
    return this.pendingTake;
  }

  stopTransport(): void {
    this.stopTransportAudio();
  }

  discardTake(): void {
    this.stopTransportAudio();
    this.setPhase("pre-roll");
    this.clearReviewUrl();
    this.pendingTake = null;
    this.reviewScoreVersion += 1;
    this.updateSnapshot({ reviewScores: null });
  }

  listen(): void {
    const inputs = this.inputs;
    if (inputs == null || inputs.ctx == null) return;

    this.stopTransportAudio();
    this.setPhase("listening");
    this.updateSnapshot({
      activeChordIndex: 0,
      currentAbsoluteBeat: -1,
    });

    const session = startRecordingPlayback({
      ctx: inputs.ctx,
      chords: inputs.chords,
      harmonyLine: this.snapshot.guideToneEnabled ? inputs.harmonyLine : null,
      arrangementVoice: this.snapshot.guideToneEnabled
        ? inputs.arrangementVoice
        : null,
      backingHarmonyLines: inputs.melodyBackingLines,
      backingArrangementVoices: inputs.backingArrangementVoices,
      beatsPerBar: inputs.beatsPerBar,
      tempo: inputs.tempo,
      beatLevel: 1,
      guideToneLevel: 1,
      beatDestination: this.beatGain,
      guideToneDestination: this.guideToneGain,
      monitorPlayer: this.monitorPlayer,
      onBeat: (beat) => {
        this.updateBeatPosition(beat);
      },
      onChordChange: (index) => {
        this.updateSnapshot({ activeChordIndex: index });
      },
    });

    this.listenSession = session;
    this.clearListenTimeout();
    const durationMs = progressionDurationSec(inputs.chords, inputs.tempo) * 1000 + 400;
    this.listenTimeoutId = window.setTimeout(() => {
      if (this.listenSession !== session) return;
      session.stop();
      this.listenSession = null;
      this.setPhase("pre-roll");
      this.updateSnapshot({
        activeChordIndex: 0,
        currentAbsoluteBeat: -1,
      });
    }, durationMs);
  }

  stopListening = () => {
    this.stopTransportAudio();
    this.setPhase("pre-roll");
    this.updateSnapshot({
      activeChordIndex: 0,
      currentAbsoluteBeat: -1,
    });
  };

  async record(): Promise<void> {
    const inputs = this.inputs;
    if (
      inputs == null ||
      inputs.ctx == null ||
      inputs.stream == null ||
      this.recordSession != null
    ) {
      return;
    }

    this.stopTransportAudio();
    this.setPhase("counting-in");
    this.updateSnapshot({
      activeChordIndex: 0,
      countInBeat: 0,
      currentAbsoluteBeat: -1,
      reviewScores: null,
    });

    let session: RecordingSession | null = null;
    try {
      session = startRecordTake({
        ctx: inputs.ctx,
        stream: inputs.stream,
        chords: inputs.chords,
        harmonyLine: this.snapshot.guideToneEnabled ? inputs.harmonyLine : null,
        arrangementVoice: this.snapshot.guideToneEnabled
          ? inputs.arrangementVoice
          : null,
        backingHarmonyLines: inputs.melodyBackingLines,
        backingArrangementVoices: inputs.backingArrangementVoices,
        countInCueMidi: inputs.countInCueMidi,
        beatsPerBar: inputs.beatsPerBar,
        tempo: inputs.tempo,
        latencyCorrectionSec: inputs.alignmentCorrectionSec,
        monitorPlayer: this.monitorPlayer,
        beatLevel: 1,
        guideToneLevel: 1,
        beatDestination: this.beatGain,
        guideToneDestination: this.guideToneGain,
        callbacks: {
          onCountInBeat: (beat) => {
            this.updateSnapshot({ countInBeat: beat + 1 });
          },
          onRecordingStart: () => {
            this.setPhase("recording");
            this.updateSnapshot({ activeChordIndex: 0 });
          },
          onBeat: (beat) => {
            this.updateBeatPosition(beat);
          },
        },
      });
      this.recordSession = session;

      const result = await session.promise;
      this.pendingTake = {
        blob: result.blob,
        alignmentOffsetSec: result.alignmentOffsetSec,
      };

      const scoreVersion = this.reviewScoreVersion + 1;
      this.reviewScoreVersion = scoreVersion;
      this.clearReviewUrl();
      this.updateSnapshot({
        reviewUrl: result.url,
        reviewScores: null,
      });
      this.setPhase("review");
      void this.resolveReviewScores({
        blob: result.blob,
        alignmentOffsetSec: result.alignmentOffsetSec,
        scoreVersion,
      });
    } catch (error) {
      if (isRecordingCancelledError(error)) {
        this.setPhase("pre-roll");
        this.updateSnapshot({
          activeChordIndex: 0,
          countInBeat: 0,
          currentAbsoluteBeat: -1,
          reviewScores: null,
        });
        return;
      }

      console.error("Recording failed", error);
      this.setPhase("pre-roll");
    } finally {
      if (session != null && this.recordSession === session) {
        this.recordSession = null;
      }
    }
  }

  stopRecording = () => {
    const session = this.recordSession;
    if (session == null) return;
    session.stop();
    this.recordSession = null;
    this.setPhase("pre-roll");
    this.updateSnapshot({
      activeChordIndex: 0,
      countInBeat: 0,
      currentAbsoluteBeat: -1,
      reviewScores: null,
    });
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.monitorBuildVersion += 1;
    this.stopTransportAudio();
    this.invalidateMonitorPlayer();
    this.destroyOutputGains();
    this.clearReviewUrl();
    this.listeners.clear();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private updateSnapshot(patch: Partial<RecordingTransportSnapshot>): void {
    if (this.disposed) return;

    let changed = false;
    const nextSnapshot = { ...this.snapshot };
    for (const [key, value] of Object.entries(patch)) {
      if ((nextSnapshot as Record<string, unknown>)[key] === value) continue;
      (nextSnapshot as Record<string, unknown>)[key] = value;
      changed = true;
    }

    if (!changed) return;
    this.snapshot = nextSnapshot;
    this.emit();
  }

  private setPhase(nextPhase: RecordPhase): void {
    const prevPhase = this.snapshot.phase;
    if (prevPhase === nextPhase) return;
    this.updateSnapshot({ phase: nextPhase });
    if (prevPhase === "pre-roll") {
      this.monitorPlayer?.stop();
    }
  }

  private resizeMutedParts(totalParts: number): void {
    const nextMutedParts = Array.from(
      { length: totalParts },
      (_, index) => this.snapshot.mutedParts[index] ?? false,
    );

    if (
      nextMutedParts.length === this.snapshot.mutedParts.length &&
      nextMutedParts.every((value, index) => value === this.snapshot.mutedParts[index])
    ) {
      return;
    }

    this.updateSnapshot({ mutedParts: nextMutedParts });
  }

  private rebuildOutputGains(): void {
    this.destroyOutputGains();

    const ctx = this.inputs?.ctx;
    if (ctx == null) return;

    const beatGain = ctx.createGain();
    beatGain.connect(ctx.destination);
    this.beatGain = beatGain;

    const guideToneGain = ctx.createGain();
    guideToneGain.connect(ctx.destination);
    this.guideToneGain = guideToneGain;
  }

  private destroyOutputGains(): void {
    this.beatGain?.disconnect();
    this.guideToneGain?.disconnect();
    this.beatGain = null;
    this.guideToneGain = null;
  }

  private applyBeatVolume(): void {
    const inputs = this.inputs;
    if (inputs?.ctx == null || this.beatGain == null) return;
    this.beatGain.gain.setValueAtTime(inputs.beatVolume, inputs.ctx.currentTime);
  }

  private applyGuideToneLevel(): void {
    const inputs = this.inputs;
    if (inputs?.ctx == null || this.guideToneGain == null) return;
    const guideToneLevel = this.snapshot.guideToneEnabled
      ? inputs.guideToneVolume
      : 0;
    this.guideToneGain.gain.setValueAtTime(
      guideToneLevel,
      inputs.ctx.currentTime,
    );
  }

  private invalidateMonitorPlayer(): void {
    this.monitorBuildVersion += 1;
    this.monitorPlayer?.dispose();
    this.monitorPlayer = null;
    this.monitorLanePartIndices = [];
    this.updateSnapshot({ referenceWaveform: null });
  }

  private async rebuildMonitorPlayer(): Promise<void> {
    const inputs = this.inputs;
    if (inputs == null || inputs.ctx == null) return;

    const buildVersion = this.monitorBuildVersion;
    const encodedLanes = this.buildEncodedMonitorLanes(
      inputs.orderedTrackIds,
      inputs.orderedTrackIds[inputs.partIndex] ?? null,
    );
    const lanes =
      encodedLanes.length > 0
        ? await decodeMonitorLanes(inputs.ctx, encodedLanes)
        : [];
    if (
      this.disposed ||
      this.monitorBuildVersion !== buildVersion ||
      this.inputs?.ctx !== inputs.ctx
    ) {
      return;
    }

    this.monitorLanePartIndices = encodedLanes.map((lane) => lane.partIndex);
    const arrangementDurationSec = progressionDurationSec(
      inputs.chords,
      inputs.tempo,
    );
    const referenceWaveform = await this.resolveReferenceWaveform({
      ctx: inputs.ctx,
      arrangementDurationSec,
      encodedLanes,
      lanes,
      referenceWaveformTrackId: inputs.tracksRevision.referenceWaveformTrackId,
    });
    if (
      this.disposed ||
      this.monitorBuildVersion !== buildVersion ||
      this.inputs?.ctx !== inputs.ctx
    ) {
      return;
    }
    this.updateSnapshot({
      referenceWaveform,
    });

    if (encodedLanes.length === 0) return;

    const player = createMonitorPlayer(inputs.ctx, lanes, arrangementDurationSec);
    for (let laneIndex = 0; laneIndex < encodedLanes.length; laneIndex++) {
      const lane = encodedLanes[laneIndex];
      if (lane == null) continue;
      player.setMuted(
        laneIndex,
        this.snapshot.mutedParts[lane.partIndex] ?? false,
      );
    }
    player.setLevel(inputs.priorHarmonyLevel);
    this.monitorPlayer = player;
  }

  private buildEncodedMonitorLanes(
    orderedTrackIds: TrackId[],
    currentTrackId: TrackId | null,
  ): EncodedMonitorLane[] {
    const encodedLanes: EncodedMonitorLane[] = [];

    for (const index of selectMonitorTrackIndices(
      orderedTrackIds,
      currentTrackId,
    )) {
      const trackId = orderedTrackIds[index];
      if (trackId == null) continue;

      const lane = this.buildEncodedMonitorLane(trackId, index);
      if (lane == null) continue;
      encodedLanes.push(lane);
    }

    return encodedLanes;
  }

  private buildEncodedMonitorLane(
    trackId: TrackId,
    partIndex: number,
  ): EncodedMonitorLane | null {
    const clips = model.tracksDocument.getOrderedClipsForTrack(trackId);
    const segments: EncodedMonitorSegment[] = [];
    for (const clip of clips) {
      const blob = model.getRecordingBlob(clip.recordingId);
      if (blob == null) continue;
      segments.push({
        recordingId: clip.recordingId,
        blob,
        timelineStartSec: clip.timelineStartSec,
        sourceStartSec: clip.sourceStartSec,
        durationSec: clip.durationSec,
      });
    }

    if (segments.length === 0) return null;
    return {
      trackId,
      partIndex,
      segments,
    };
  }

  private async resolveReferenceWaveform(input: {
    ctx: AudioContext;
    arrangementDurationSec: number;
    encodedLanes: EncodedMonitorLane[];
    lanes: MonitorLane[];
    referenceWaveformTrackId: TrackId | null;
  }): Promise<ReferenceWaveform | null> {
    const {
      ctx,
      arrangementDurationSec,
      encodedLanes,
      lanes,
      referenceWaveformTrackId,
    } = input;

    const decodedReferenceLane = selectReferenceWaveformLane(
      encodedLanes.map((lane, index) => ({
        trackId: lane.trackId,
        segments: lanes[index]?.segments ?? [],
      })),
      referenceWaveformTrackId,
    );
    if (decodedReferenceLane != null) {
      return buildReferenceWaveform({
        segments: decodedReferenceLane.segments,
        maxDurationSec: arrangementDurationSec,
      });
    }

    if (referenceWaveformTrackId == null) return null;

    const encodedReferenceLane = this.buildEncodedMonitorLane(
      referenceWaveformTrackId,
      -1,
    );
    if (encodedReferenceLane == null) return null;

    const [decodedLane] = await decodeMonitorLanes(ctx, [encodedReferenceLane]);
    if (decodedLane == null || decodedLane.segments.length === 0) {
      return null;
    }

    return buildReferenceWaveform({
      segments: decodedLane.segments,
      maxDurationSec: arrangementDurationSec,
    });
  }

  private applyMutedParts(): void {
    const player = this.monitorPlayer;
    if (player == null) return;

    for (let laneIndex = 0; laneIndex < this.monitorLanePartIndices.length; laneIndex++) {
      const partIndex = this.monitorLanePartIndices[laneIndex];
      if (partIndex == null) continue;
      player.setMuted(laneIndex, this.snapshot.mutedParts[partIndex] ?? false);
    }
  }

  private resetForPartChange(): void {
    this.stopTransportAudio();
    this.pendingTake = null;
    this.clearReviewUrl();
    this.updateSnapshot({
      phase: "pre-roll",
      activeChordIndex: 0,
      countInBeat: 0,
      currentAbsoluteBeat: -1,
      reviewScores: null,
    });
  }

  private clearReviewUrl(): void {
    const reviewUrl = this.snapshot.reviewUrl;
    if (reviewUrl == null) return;
    URL.revokeObjectURL(reviewUrl);
    this.updateSnapshot({ reviewUrl: null });
  }

  private async resolveReviewScores(input: {
    blob: Blob;
    alignmentOffsetSec: number;
    scoreVersion: number;
  }): Promise<void> {
    const inputs = this.inputs;
    if (
      inputs == null ||
      inputs.ctx == null ||
      (inputs.harmonyLine == null && inputs.arrangementVoice == null)
    ) {
      return;
    }

    let takeBuffer: AudioBuffer | null = null;
    try {
      takeBuffer = await decodeBlobAudio(inputs.ctx, input.blob);
    } catch {
      return;
    }
    if (
      this.disposed ||
      this.reviewScoreVersion !== input.scoreVersion ||
      this.inputs !== inputs
    ) {
      return;
    }

    let referenceSegments: ScoredMonitorSegment[] = [];
    const referenceTrackId = inputs.tracksRevision.referenceWaveformTrackId;
    if (referenceTrackId != null) {
      const encodedReferenceLane = this.buildEncodedMonitorLane(
        referenceTrackId,
        -1,
      );
      if (encodedReferenceLane != null) {
        const [decodedLane] = await decodeMonitorLanes(inputs.ctx, [
          encodedReferenceLane,
        ]);
        if (
          this.disposed ||
          this.reviewScoreVersion !== input.scoreVersion ||
          this.inputs !== inputs
        ) {
          return;
        }
        referenceSegments = decodedLane?.segments ?? [];
      }
    }

    const reviewScores = gradeHarmonyTake({
      takeBuffer,
      takeAlignmentOffsetSec: input.alignmentOffsetSec,
      referenceSegments,
      arrangementDurationSec: progressionDurationSec(inputs.chords, inputs.tempo),
      tempo: inputs.tempo,
      chords: inputs.chords,
      harmonyLine: inputs.harmonyLine,
      arrangementVoice: inputs.arrangementVoice,
    });

    if (
      reviewScores == null ||
      this.disposed ||
      this.reviewScoreVersion !== input.scoreVersion ||
      this.inputs !== inputs
    ) {
      return;
    }

    this.updateSnapshot({ reviewScores });
  }

  private stopTransportAudio(): void {
    this.clearListenTimeout();
    this.listenSession?.stop();
    this.listenSession = null;
    this.recordSession?.stop();
    this.recordSession = null;
    this.monitorPlayer?.stop();
    stopAllPlayback();
  }

  private clearListenTimeout(): void {
    if (this.listenTimeoutId != null) {
      window.clearTimeout(this.listenTimeoutId);
      this.listenTimeoutId = null;
    }
  }

  private updateBeatPosition(beat: number): void {
    const chords = this.inputs?.chords ?? [];
    let activeChordIndex = 0;
    let remaining = beat;
    for (let index = 0; index < chords.length; index++) {
      const chord = chords[index];
      if (chord == null) continue;
      if (remaining < chord.beats) {
        activeChordIndex = index;
        break;
      }
      remaining -= chord.beats;
    }

    this.updateSnapshot({
      currentAbsoluteBeat: beat,
      activeChordIndex,
    });
  }
}

export function useRecordingTransportController(
  inputs: RecordingTransportInputs,
): {
  controller: RecordingTransportController;
  snapshot: RecordingTransportSnapshot;
} {
  const controllerRef = useRef<RecordingTransportController | null>(null);
  if (controllerRef.current == null) {
    controllerRef.current = new RecordingTransportController();
  }

  const controller = controllerRef.current;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    controller.syncInputs(inputs);
  }, [controller, inputs]);

  useEffect(() => {
    return () => {
      controller.dispose();
    };
  }, [controller]);

  return { controller, snapshot };
}
