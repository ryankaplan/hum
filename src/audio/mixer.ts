// Creates and manages the Web Audio graph for the FinalReview screen.
// The graph is built once at mount time so the same gain nodes serve both
// live preview playback and the export recording pass.
//
//  [MediaElementSource] ──> [trackGain] ──┬──> [dryGain] ──────────────────> [masterGain] ──> ctx.destination
//                                         └──> [convolver] ──> [wetGain] ──> [masterGain]
//
// During export masterGain is also connected to a MediaStreamDestination.

export type Mixer = {
  setTrackVolume(index: number, value: number): void;
  setTrackMuted(index: number, muted: boolean): void;
  setReverbWet(wet: number): void;
  connectForExport(dest: MediaStreamAudioDestinationNode): void;
  disconnectExport(dest: MediaStreamAudioDestinationNode): void;
  dispose(): void;
};

export function createMixer(
  ctx: AudioContext,
  sources: MediaElementAudioSourceNode[],
): Mixer {
  const trackGains: GainNode[] = [];
  const volumes: number[] = sources.map(() => 1.0);
  const mutedFlags: boolean[] = sources.map(() => false);

  // Master: always connected to ctx.destination; also connected to
  // MediaStreamDestination during export.
  const masterGain = ctx.createGain();
  masterGain.gain.value = 1.0;
  masterGain.connect(ctx.destination);

  // Dry path
  const dryGain = ctx.createGain();
  dryGain.gain.value = 0.85;
  dryGain.connect(masterGain);

  // Wet (reverb) path
  const convolver = ctx.createConvolver();
  convolver.buffer = buildImpulseBuffer(ctx, 1.5, 2.5);
  const wetGain = ctx.createGain();
  wetGain.gain.value = 0.15;
  convolver.connect(wetGain);
  wetGain.connect(masterGain);

  // Per-track gain nodes
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (source == null) continue;
    const gain = ctx.createGain();
    gain.gain.value = 1.0;
    source.connect(gain);
    gain.connect(dryGain);
    gain.connect(convolver);
    trackGains.push(gain);
  }

  return {
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
