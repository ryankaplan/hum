// Sample-accurate prior-take monitoring via AudioBufferSourceNodes.
//
// Each kept take is pre-decoded into an AudioBuffer. When start(when) is
// called, a fresh AudioBufferSourceNode is created for each buffer and
// scheduled to begin at the exact AudioContext.currentTime value `when`.
// Because AudioBufferSourceNode.start(when) and Tone's Transport.start(when)
// both use the same AudioContext clock, all audio is aligned to the sample.
//
// trimOffsetSec: each recording has a small amount of leading silence before
// the music began (the gap between MediaRecorder.start() and the transport
// start). This offset is stored with each take and applied as a negative
// offset to the buffer start so that beat-1 of every take aligns to `when`.

export type MonitorTrack = {
  buffer: AudioBuffer;
  // How many seconds into the buffer the music actually starts
  trimOffsetSec: number;
};

export type MonitorPlayer = {
  // Schedule all tracks to start at AudioContext time `when`.
  // Safe to call multiple times; stops any previously running sources first.
  start(when: number): void;
  // Start all tracks looping from their trim offset for idle preview.
  // Uses the same gain nodes as start(), so mute state is respected.
  startLooping(): void;
  stop(): void;
  setMuted(trackIndex: number, muted: boolean): void;
  dispose(): void;
};

// Decodes an array of blobs into MonitorTracks. Returns null entries for
// blobs that fail to decode (so caller indices stay stable).
export async function decodeMonitorTracks(
  ctx: AudioContext,
  blobs: Blob[],
  trimOffsets: number[],
): Promise<(MonitorTrack | null)[]> {
  const results: (MonitorTrack | null)[] = [];
  for (let i = 0; i < blobs.length; i++) {
    const blob = blobs[i];
    const trimOffsetSec = trimOffsets[i] ?? 0;
    if (blob == null) {
      results.push(null);
      continue;
    }
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      results.push({ buffer: audioBuffer, trimOffsetSec });
    } catch {
      results.push(null);
    }
  }
  return results;
}

export function createMonitorPlayer(
  ctx: AudioContext,
  tracks: (MonitorTrack | null)[],
): MonitorPlayer {
  // Per-track gain nodes (persistent; control mute state)
  const gainNodes: (GainNode | null)[] = tracks.map((track) => {
    if (track == null) return null;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    g.connect(ctx.destination);
    return g;
  });

  const muted: boolean[] = tracks.map(() => false);

  // Active source nodes — created fresh each time start() is called
  let activeSources: (AudioBufferSourceNode | null)[] = [];

  function stopActiveSources() {
    for (const source of activeSources) {
      try {
        source?.stop();
      } catch {
        // stop() throws if node was never started or already stopped; safe to ignore
      }
    }
    activeSources = [];
  }

  return {
    start(when: number) {
      stopActiveSources();
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const gain = gainNodes[i];
        if (track == null || gain == null) {
          activeSources.push(null);
          continue;
        }
        const source = ctx.createBufferSource();
        source.buffer = track.buffer;
        source.connect(gain);
        // Offset into the buffer where the music begins, so beat-1 aligns
        // to `when` regardless of how much leading silence the blob has.
        const startOffset = Math.max(0, track.trimOffsetSec);
        source.start(when, startOffset);
        activeSources.push(source);
      }
    },

    startLooping() {
      stopActiveSources();
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const gain = gainNodes[i];
        if (track == null || gain == null) {
          activeSources.push(null);
          continue;
        }
        const source = ctx.createBufferSource();
        source.buffer = track.buffer;
        source.loop = true;
        source.loopStart = Math.max(0, track.trimOffsetSec);
        source.loopEnd = track.buffer.duration;
        source.connect(gain);
        source.start(ctx.currentTime + 0.05, Math.max(0, track.trimOffsetSec));
        activeSources.push(source);
      }
    },

    stop() {
      stopActiveSources();
    },

    setMuted(trackIndex: number, isMuted: boolean) {
      muted[trackIndex] = isMuted;
      const gain = gainNodes[trackIndex];
      if (gain != null) {
        gain.gain.value = isMuted ? 0 : 0.5;
      }
    },

    dispose() {
      stopActiveSources();
      for (const gain of gainNodes) {
        gain?.disconnect();
      }
    },
  };
}
