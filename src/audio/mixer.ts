// Creates and manages the Web Audio graph for the FinalReview screen.
// The graph is built once at mount time so the same gain nodes serve both
// live preview playback and the export recording pass.
//
//  [AudioBufferSourceNode] ──> [trackGain] ──┬──> [dryGain] ──────────────────> [masterGain] ──> ctx.destination
//                                            └──> [convolver] ──> [wetGain] ──> [masterGain]
//
// During export masterGain is also connected to a MediaStreamDestination.
//
// Sources are not wired at construction time. Instead call connectSource(i, node)
// to attach an AudioNode to a given track's gain input. This allows fresh
// AudioBufferSourceNodes to be created per playback without the "createMedia-
// ElementSource can only be called once" constraint.

export type Mixer = {
  // Connect an audio node (e.g. AudioBufferSourceNode) to a track's gain.
  connectSource(index: number, node: AudioNode): void;
  setTrackVolume(index: number, value: number): void;
  setTrackMuted(index: number, muted: boolean): void;
  setReverbWet(wet: number): void;
  setOutputEnabled(enabled: boolean): void;
  connectForExport(dest: MediaStreamAudioDestinationNode): void;
  disconnectExport(dest: MediaStreamAudioDestinationNode): void;
  dispose(): void;
};

export type MixerGraph = {
  connectSource(index: number, node: AudioNode): void;
  setTrackVolume(index: number, value: number): void;
  setTrackMuted(index: number, muted: boolean): void;
  setReverbWet(wet: number): void;
  setOutputEnabled(enabled: boolean): void;
  masterGain: GainNode;
  dispose(): void;
};

type CreateMixerGraphInput = {
  ctx: AudioContext | OfflineAudioContext;
  trackCount: number;
  connectToDestination: boolean;
};

export function createMixer(
  ctx: AudioContext,
  trackCount: number,
): Mixer {
  const graph = createMixerGraph({
    ctx,
    trackCount,
    connectToDestination: true,
  });

  return {
    ...graph,
    connectForExport(dest) {
      graph.masterGain.connect(dest);
    },

    disconnectExport(dest) {
      graph.masterGain.disconnect(dest);
    },
  };
}

export function createReviewMixerGraph(
  ctx: AudioContext | OfflineAudioContext,
  trackCount: number,
): MixerGraph {
  return createMixerGraph({
    ctx,
    trackCount,
    connectToDestination: true,
  });
}

function createMixerGraph({
  ctx,
  trackCount,
  connectToDestination,
}: CreateMixerGraphInput): MixerGraph {
  const trackGains: GainNode[] = [];
  const volumes: number[] = [];
  const mutedFlags: boolean[] = [];

  const masterGain = ctx.createGain();
  masterGain.gain.value = 1.0;
  if (connectToDestination) {
    masterGain.connect(ctx.destination);
  }
  let outputEnabled = connectToDestination;

  // Dry path
  const dryGain = ctx.createGain();
  dryGain.gain.value = 0.8;
  dryGain.connect(masterGain);

  // Wet (reverb) path
  const convolver = ctx.createConvolver();
  convolver.buffer = buildImpulseBuffer(ctx, 1.5, 2.5);
  const wetGain = ctx.createGain();
  wetGain.gain.value = 0.2;
  convolver.connect(wetGain);
  wetGain.connect(masterGain);

  // Per-track gain nodes (no sources connected yet)
  for (let i = 0; i < trackCount; i++) {
    const gain = ctx.createGain();
    gain.gain.value = 1.0;
    gain.connect(dryGain);
    gain.connect(convolver);
    trackGains.push(gain);
    volumes.push(1.0);
    mutedFlags.push(false);
  }

  return {
    connectSource(index, node) {
      const gain = trackGains[index];
      if (gain == null) return;
      node.connect(gain);
    },

    setTrackVolume(index, value) {
      volumes[index] = value;
      const gain = trackGains[index];
      if (gain == null) return;
      if (!(mutedFlags[index] ?? false)) {
        gain.gain.value = value;
      }
    },

    setTrackMuted(index, muted) {
      mutedFlags[index] = muted;
      const gain = trackGains[index];
      if (gain == null) return;
      gain.gain.value = muted ? 0 : (volumes[index] ?? 1);
    },

    setReverbWet(wet) {
      wetGain.gain.value = wet;
      dryGain.gain.value = 1 - wet;
    },

    setOutputEnabled(enabled) {
      if (enabled === outputEnabled) return;
      outputEnabled = enabled;
      if (enabled) {
        masterGain.connect(ctx.destination);
      } else {
        masterGain.disconnect(ctx.destination);
      }
    },

    masterGain,

    dispose() {
      masterGain.disconnect();
      dryGain.disconnect();
      convolver.disconnect();
      wetGain.disconnect();
      for (const g of trackGains) {
        g.disconnect();
      }
    },
  } satisfies MixerGraph;
}

// Generates a simple exponentially-decaying white noise impulse response,
// which produces a convincing small-room reverb without any async work.
function buildImpulseBuffer(
  ctx: AudioContext | OfflineAudioContext,
  durationSec: number,
  decay: number,
): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * durationSec);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const prng = createPrng(0x5f3759df);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] =
        (prng() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}

function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}
