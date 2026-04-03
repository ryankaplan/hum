// Short-lived synthesizer helpers built on raw Web Audio nodes.
// Each playClick / playGuideTone call creates fresh short-lived nodes that
// the browser GCs after they stop. A module-level set allows stopAllSynths()
// to cut off anything that hasn't finished yet.

type ActiveNode = { stop: () => void };
const activeNodes = new Set<ActiveNode>();

export function stopAllSynths(): void {
  for (const node of activeNodes) {
    node.stop();
  }
  activeNodes.clear();
}

// Synthesize a single metronome click at the given AudioContext time.
// Mimics a MembraneSynth: fast pitched sweep + exponential amplitude decay.
export function playClick(
  ctx: AudioContext,
  time: number,
  isDownbeat: boolean,
): void {
  const gain = ctx.createGain();
  gain.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.connect(gain);

  // Pitch sweep: start high, drop quickly (membrane-like thump)
  const startFreq = isDownbeat ? 220 : 160;
  const endFreq = isDownbeat ? 55 : 45;
  osc.frequency.setValueAtTime(startFreq, time);
  osc.frequency.exponentialRampToValueAtTime(endFreq, time + 0.04);

  // Amplitude: instant attack, fast exponential decay
  gain.gain.setValueAtTime(0.001, time);
  gain.gain.exponentialRampToValueAtTime(0.9, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);

  osc.start(time);
  osc.stop(time + 0.12);

  const node: ActiveNode = {
    stop() {
      try {
        osc.stop();
      } catch {
        // already stopped
      }
      gain.disconnect();
    },
  };
  activeNodes.add(node);
  osc.onended = () => {
    gain.disconnect();
    activeNodes.delete(node);
  };
}

// Play a sustained guide tone (triangle oscillator + ADSR envelope).
// Returns a stop function for early cutoff.
export function playGuideTone(
  ctx: AudioContext,
  frequency: number,
  startTime: number,
  durationSec: number,
): () => void {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = frequency;
  osc.connect(gain);

  // Envelope matching Tone.js PolySynth(Synth, { attack: 0.02, decay: 0.1,
  // sustain: 0.8, release: 0.3, volume: -6 }). Peak gain ≈ 0.5 (−6 dB).
  const peak = 0.5;
  const attack = 0.02;
  const decay = 0.1;
  const sustainLevel = peak * 0.8;
  const release = 0.3;
  const sustainEnd = Math.max(startTime + attack + decay, startTime + durationSec - release);

  gain.gain.setValueAtTime(0.001, startTime);
  gain.gain.exponentialRampToValueAtTime(peak, startTime + attack);
  gain.gain.exponentialRampToValueAtTime(sustainLevel, startTime + attack + decay);
  gain.gain.setValueAtTime(sustainLevel, sustainEnd);
  gain.gain.exponentialRampToValueAtTime(0.001, sustainEnd + release);

  osc.start(startTime);
  osc.stop(sustainEnd + release + 0.05);

  const node: ActiveNode = {
    stop() {
      try {
        osc.stop();
      } catch {
        // already stopped
      }
      gain.disconnect();
    },
  };
  activeNodes.add(node);
  osc.onended = () => {
    gain.disconnect();
    activeNodes.delete(node);
  };

  return () => node.stop();
}
