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
  connectForExport(dest: MediaStreamAudioDestinationNode): void;
  disconnectExport(dest: MediaStreamAudioDestinationNode): void;
  dispose(): void;
};

export function createMixer(
  ctx: AudioContext,
  trackCount: number,
): Mixer {
  const trackGains: GainNode[] = [];
  const volumes: number[] = [];
  const mutedFlags: boolean[] = [];

  // Master: always connected to ctx.destination; also connected to
  // MediaStreamDestination during export.
  const masterGain = ctx.createGain();
  masterGain.gain.value = 1.0;
  masterGain.connect(ctx.destination);

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

    connectForExport(dest) {
      masterGain.connect(dest);
    },

    // Disconnects only the export destination, leaving ctx.destination intact.
    disconnectExport(dest) {
      masterGain.disconnect(dest);
    },

    dispose() {
      masterGain.disconnect();
      dryGain.disconnect();
      convolver.disconnect();
      wetGain.disconnect();
      for (const g of trackGains) {
        g.disconnect();
      }
    },
  };
}

// Generates a simple exponentially-decaying white noise impulse response,
// which produces a convincing small-room reverb without any async work.
function buildImpulseBuffer(
  ctx: AudioContext,
  durationSec: number,
  decay: number,
): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * durationSec);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}
