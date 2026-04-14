import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { createMixer } from "../audio/mixer";
import {
  buildPlannedAudioClips,
  scheduleClipVolumeGain,
} from "../audio/reviewAudioPlan";
import { model, type TrackClip, type TrackId } from "../state/model";
import {
  AUDIO_SCHEDULE_LEAD_SEC,
  FRAME_READY_TIMEOUT_MS,
} from "../transport/core";
import { startCompositor } from "../video/compositor";
import { exportVideo } from "../video/exporter";
import {
  createReviewTransport,
  type ReviewTransport,
} from "../video/reviewTransport";
import type { EditorSelection } from "./timeline";
import { FINAL_REVIEW_WAVEFORM_BUCKETS_PER_SEC } from "./waveformRendering";

export type FinalReviewRuntimeStatus =
  | "idle"
  | "priming-preview"
  | "previewing"
  | "priming-export"
  | "exporting";

export type FinalReviewRuntimeSnapshot = {
  status: FinalReviewRuntimeStatus;
  unavailableLanes: number[];
  mediaRevision: number;
};

export type FinalReviewRuntimeInputs = {
  ctx: AudioContext | null;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  trackOrder: TrackId[];
  orderedTracks: Array<{ volume: number; muted: boolean }>;
  timelines: TrackClip[][];
  runtimeMediaKey: string;
  committedPlayheadSec: number;
  selection: EditorSelection;
  timelineEndSec: number;
  reverbWet: number;
};

const INITIAL_SNAPSHOT: FinalReviewRuntimeSnapshot = {
  status: "idle",
  unavailableLanes: [],
  mediaRevision: 0,
};

export class FinalReviewRuntimeController {
  private snapshot: FinalReviewRuntimeSnapshot = INITIAL_SNAPSHOT;
  private listeners = new Set<() => void>();
  private inputs: FinalReviewRuntimeInputs | null = null;
  private activeVideoMask: boolean[] = [];
  private activeSources: AudioBufferSourceNode[] = [];
  private reviewTransport: ReviewTransport | null = null;
  private videos: HTMLVideoElement[] = [];
  private requestToken = 0;
  private runtimeBuildVersion = 0;
  private disposed = false;

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  syncInputs(next: FinalReviewRuntimeInputs): void {
    if (this.disposed) return;

    const prev = this.inputs;
    this.inputs = next;

    const needsRuntimeRebuild =
      prev == null ||
      prev.ctx !== next.ctx ||
      prev.runtimeMediaKey !== next.runtimeMediaKey ||
      prev.trackOrder.length !== next.trackOrder.length;

    if (needsRuntimeRebuild) {
      this.rebuildRuntime();
      return;
    }

    this.applyMixerState();

    if (
      this.snapshot.status === "idle" &&
      (prev.committedPlayheadSec !== next.committedPlayheadSec ||
        prev.timelines !== next.timelines)
    ) {
      this.reviewTransport?.syncPaused(next.committedPlayheadSec);
    }
  }

  async togglePreview(): Promise<void> {
    const inputs = this.inputs;
    if (inputs == null || inputs.ctx == null) return;
    if (inputs.timelineEndSec <= 0) return;

    if (this.snapshot.status === "previewing") {
      this.stopPlayback(true);
      return;
    }

    if (this.snapshot.status !== "idle") return;

    this.clearSelectedVolumePoint();

    const startTimelineSec =
      inputs.committedPlayheadSec >= inputs.timelineEndSec
        ? 0
        : inputs.committedPlayheadSec;
    const requestToken = this.requestToken + 1;
    this.requestToken = requestToken;
    this.setStatus("priming-preview");
    this.updateSnapshot({ unavailableLanes: [] });

    let previewStarted = false;
    try {
      const transport = this.reviewTransport;
      if (transport == null) {
        this.setStatus("idle");
        return;
      }

      const unavailableLanes = await transport.primeForStart({
        startTimelineSec,
        frameReadyTimeoutMs: FRAME_READY_TIMEOUT_MS,
      });
      if (this.requestToken !== requestToken) return;

      const ctx = this.inputs?.ctx;
      const endTimelineSec = this.inputs?.timelineEndSec ?? 0;
      if (ctx == null || this.reviewTransport == null || endTimelineSec <= 0) {
        this.setStatus("idle");
        return;
      }

      this.updateSnapshot({ unavailableLanes });

      const startCtxTime = ctx.currentTime + AUDIO_SCHEDULE_LEAD_SEC;
      model.tracksEditor.setPlayhead(startTimelineSec);
      this.startAudioFromTimeline(startCtxTime, startTimelineSec, endTimelineSec);

      this.reviewTransport.startRun({
        mode: "preview",
        startCtxTimeSec: startCtxTime,
        startTimelineSec,
        endTimelineSec,
        onTick: (timelineSec) => {
          model.tracksEditor.setPlaybackPlayhead(timelineSec);
        },
        onEnded: () => {
          this.stopAudio();
          if (this.requestToken !== requestToken) return;
          this.setStatus("idle");
          model.tracksEditor.setPlayhead(endTimelineSec);
          this.reviewTransport?.syncPaused(endTimelineSec);
        },
      });

      model.tracksEditor.setPlaybackPlayhead(startTimelineSec);
      this.setStatus("previewing");
      previewStarted = true;
    } finally {
      if (this.requestToken === requestToken && !previewStarted) {
        this.setStatus("idle");
      }
    }
  }

  stopPlayback(preservePlayhead: boolean): void {
    this.requestToken += 1;
    this.reviewTransport?.stop();
    this.stopAudio();
    this.setStatus("idle");

    const nextPlayheadSec = preservePlayhead
      ? model.tracksEditor.playbackPlayheadSec.get()
      : 0;
    model.tracksEditor.setPlayhead(nextPlayheadSec);
    this.reviewTransport?.syncPaused(nextPlayheadSec);
  }

  async exportCurrentVideo(): Promise<void> {
    const inputs = this.inputs;
    if (inputs == null || inputs.ctx == null) {
      return;
    }
    if (inputs.timelineEndSec <= 0) return;
    if (
      this.snapshot.status !== "idle" &&
      this.snapshot.status !== "previewing"
    ) {
      return;
    }

    this.clearSelectedVolumePoint();
    this.stopPlayback(false);
    model.beginExport();

    const requestToken = this.requestToken + 1;
    this.requestToken = requestToken;
    this.setStatus("priming-export");
    this.updateSnapshot({ unavailableLanes: [] });

    try {
      this.updateSnapshot({ unavailableLanes: [] });
      this.setStatus("exporting");
      model.tracksEditor.setPlaybackPlayhead(0);

      const result = await exportVideo({
        timelines: inputs.timelines,
        orderedTracks: inputs.orderedTracks,
        reverbWet: inputs.reverbWet,
        durationSec: inputs.timelineEndSec,
        preferredFormat: model.exportPreferences.get().preferredFormat,
        loadRecordingBlob: (recordingId) => model.getRecordingBlob(recordingId),
        loadRecordingAudioBuffer: async (recordingId) => {
          const cached = model.getRecordingAudioBuffer(recordingId);
          if (cached != null) return cached;

          const blob = model.getRecordingBlob(recordingId);
          if (blob == null) {
            throw new Error(`Missing audio media for recording ${recordingId}.`);
          }

          const raw = await blob.arrayBuffer();
          return await inputs.ctx!.decodeAudioData(raw);
        },
        onProgress: (progress, timelineSec) => {
          if (this.requestToken !== requestToken) return;
          model.updateExportProgress(progress);
          model.tracksEditor.setPlaybackPlayhead(timelineSec);
        },
      });
      if (this.requestToken !== requestToken) return;

      const nextUrl = URL.createObjectURL(result.blob);
      model.completeExport({
        url: nextUrl,
        format: result.format,
        mimeType: result.mimeType,
      });
    } catch (error) {
      console.error("Export failed", error);
      if (this.requestToken === requestToken) {
        model.failOrResetExport();
      }
    } finally {
      if (this.requestToken === requestToken) {
        this.stopPlayback(false);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.runtimeBuildVersion += 1;
    this.requestToken += 1;
    this.teardownRuntime();
    this.listeners.clear();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private updateSnapshot(
    patch: Partial<FinalReviewRuntimeSnapshot>,
  ): void {
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

  private setStatus(status: FinalReviewRuntimeStatus): void {
    this.updateSnapshot({ status });
  }

  private bumpMediaRevision(): void {
    this.updateSnapshot({ mediaRevision: this.snapshot.mediaRevision + 1 });
  }

  private rebuildRuntime(): void {
    const inputs = this.inputs;
    this.runtimeBuildVersion += 1;
    const buildVersion = this.runtimeBuildVersion;

    this.teardownRuntime();
    this.updateSnapshot({ unavailableLanes: [] });

    if (inputs == null || inputs.ctx == null) return;

    const canvas = inputs.canvasRef.current;
    if (canvas == null) return;

    model.clearDecodedRuntimeMedia();
    model.tracksEditor.setPlayhead(0);
    model.tracksEditor.clearSelection();
    this.bumpMediaRevision();

    this.videos = inputs.trackOrder.map((trackId) => {
      const recordingId = model.tracksDocument.getPrimaryRecordingIdForTrack(trackId);
      const url = recordingId != null ? model.getRecordingUrl(recordingId) : null;
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.loop = false;
      video.preload = "auto";
      if (url != null) {
        video.src = url;
      }
      return video;
    });
    this.activeVideoMask = Array.from(
      { length: inputs.trackOrder.length },
      () => false,
    );

    const mixer = createMixer(inputs.ctx, inputs.trackOrder.length);
    model.mixer = mixer;
    this.applyMixerState();

    model.compositor = startCompositor(canvas, this.videos, {
      isVideoActive: (index) => this.activeVideoMask[index] ?? false,
    });

    this.reviewTransport = createReviewTransport({
      ctx: inputs.ctx,
      trackCount: inputs.trackOrder.length,
      videos: this.videos,
      getTimelines: () => this.inputs?.timelines ?? [],
      onActiveMask: (mask) => {
        this.activeVideoMask = mask;
      },
    });
    this.reviewTransport.syncPaused(0);

    for (let index = 0; index < inputs.trackOrder.length; index++) {
      const trackId = inputs.trackOrder[index];
      if (trackId == null) continue;

      const recordingId =
        model.tracksDocument.getPrimaryRecordingIdForTrack(trackId);
      if (recordingId == null) continue;

      const recording = model.tracksDocument.getRecording(recordingId);
      const videoEl = this.videos[index];
      if (recording == null || videoEl == null) continue;

      void model
        .ingestRecordingRuntimeMedia({
          recordingId,
          mediaAssetId: recording.mediaAssetId,
          ctx: inputs.ctx,
          videoEl,
          waveformBucketsPerSec: FINAL_REVIEW_WAVEFORM_BUCKETS_PER_SEC,
        })
        .then((ingested) => {
          if (
            !ingested ||
            this.disposed ||
            this.runtimeBuildVersion !== buildVersion ||
            this.inputs?.ctx !== inputs.ctx
          ) {
            return;
          }
          this.bumpMediaRevision();
        })
        .catch(() => {
          // Keep lane empty if decoding fails.
        });
    }
  }

  private teardownRuntime(): void {
    this.reviewTransport?.stop();
    this.stopAudio();
    this.setStatus("idle");

    this.reviewTransport?.dispose();
    this.reviewTransport = null;

    model.compositor?.stop();
    model.compositor = null;

    model.mixer?.dispose();
    model.mixer = null;

    for (const video of this.videos) {
      video.pause();
      video.src = "";
    }
    this.videos = [];
    this.activeVideoMask = [];
  }

  private applyMixerState(): void {
    const inputs = this.inputs;
    const mixer = model.mixer;
    if (inputs == null || mixer == null) return;

    for (let index = 0; index < inputs.orderedTracks.length; index++) {
      const track = inputs.orderedTracks[index];
      mixer.setTrackVolume(index, track?.volume ?? 1);
      mixer.setTrackMuted(index, track?.muted ?? false);
    }
    mixer.setReverbWet(inputs.reverbWet);
  }

  private stopAudio(): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // Safe to ignore if already stopped.
      }
    }
    this.activeSources = [];
  }

  private startAudioFromTimeline(
    startCtxTime: number,
    startTimelineSec: number,
    endTimelineSec: number,
  ): void {
    const inputs = this.inputs;
    const ctx = inputs?.ctx;
    const mixer = model.mixer;
    if (inputs == null || ctx == null || mixer == null) return;

    this.stopAudio();

    const clips = buildPlannedAudioClips({
      timelines: inputs.timelines,
      startTimelineSec,
      endTimelineSec,
      getBuffer: (recordingId) => model.getRecordingAudioBuffer(recordingId),
    });

    for (const clip of clips) {
      const source = ctx.createBufferSource();
      const clipGain = ctx.createGain();
      source.buffer = clip.buffer;

      const startAt = startCtxTime + clip.startOffsetSec;
      scheduleClipVolumeGain({
        gain: clipGain.gain,
        volumeEnvelope: clip.volumeEnvelope,
        segmentDurationSec: clip.segmentDurationSec,
        segmentStartSec: clip.segmentStartSec,
        playDurationSec: clip.durationSec,
        startAtSec: startAt,
      });

      source.connect(clipGain);
      mixer.connectSource(clip.laneIndex, clipGain);
      source.start(startAt, clip.sourceOffsetSec, clip.durationSec);
      this.activeSources.push(source);
    }
  }

  private clearSelectedVolumePoint(): void {
    const selection = this.inputs?.selection;
    if (selection?.volumePointId == null) return;
    model.tracksEditor.setSelection({
      trackId: selection.trackId,
      clipId: selection.clipId,
      volumePointId: null,
    });
  }
}

export function useFinalReviewRuntimeController(
  inputs: FinalReviewRuntimeInputs,
): {
  controller: FinalReviewRuntimeController;
  snapshot: FinalReviewRuntimeSnapshot;
} {
  const controllerRef = useRef<FinalReviewRuntimeController | null>(null);
  if (controllerRef.current == null) {
    controllerRef.current = new FinalReviewRuntimeController();
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
