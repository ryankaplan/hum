import { Derived, Observable, PersistedObservable } from "../observable";
import { generateHarmony } from "../music/harmony";
import { parseChordProgression } from "../music/parse";
import { noteNameToMidi } from "../music/types";
import type { HarmonyVoicing, Meter, PartIndex } from "../music/types";

export type AppScreen = "setup" | "recording" | "review";

// Per-part recording state
export type PartState =
  | { status: "idle" }
  | { status: "recording" }
  | { status: "review"; blob: Blob; url: string }
  | { status: "kept"; blob: Blob; url: string; trimOffsetSec: number };

export type TotalPartCount = 2 | 4;

function parseTotalPartCount(raw: unknown): TotalPartCount {
  return raw === 2 ? 2 : 4;
}

// ─── Persisted config (survives reload) ──────────────────────────────────────

export const chordsInput = new PersistedObservable<string>(
  "hum.chords",
  "A A F#m F#m D D E E",
);

export const tempoInput = new PersistedObservable<number>("hum.tempo", 80);

export const meterInput = new PersistedObservable<Meter>("hum.meter", [4, 4]);

export const vocalRangeLow = new PersistedObservable<string>(
  "hum.vocalRangeLow",
  "C3",
);

export const vocalRangeHigh = new PersistedObservable<string>(
  "hum.vocalRangeHigh",
  "C5",
);

export const totalPartsInput = new PersistedObservable<TotalPartCount>(
  "hum.totalParts",
  4,
  { schema: parseTotalPartCount },
);

// ─── Session state (ephemeral) ────────────────────────────────────────────────

export const appScreen = new Observable<AppScreen>("setup");

// The live MediaStream from getUserMedia — held for the whole session
export const mediaStream = new Observable<MediaStream | null>(null);

// The AudioContext — created once when permissions are granted
export const audioContext = new Observable<AudioContext | null>(null);

// Which part we're currently recording (last part is always melody)
export const currentPartIndex = new Observable<PartIndex>(0);

export function createIdlePartStates(totalParts: number): PartState[] {
  return Array.from({ length: totalParts }, () => ({ status: "idle" as const }));
}

// State for each active part in the current session.
export const partStates = new Observable<PartState[]>(
  createIdlePartStates(totalPartsInput.get()),
);

// Error message for permission failures etc.
export const permissionError = new Observable<string | null>(null);

// ─── Derived: parsed chords ───────────────────────────────────────────────────

export const parsedChords = new Derived(
  () => {
    const beatsPerBar = meterInput.get()[0];
    return parseChordProgression(chordsInput.get(), beatsPerBar);
  },
  [chordsInput, meterInput],
  { checkForEqualityOnNotify: false },
);

// ─── Derived: harmony voicing ─────────────────────────────────────────────────

export const harmonyVoicing = new Derived<HarmonyVoicing | null>(
  () => {
    const chords = parsedChords.get();
    if (chords.length === 0) return null;

    try {
      const low = noteNameToMidi(vocalRangeLow.get());
      const high = noteNameToMidi(vocalRangeHigh.get());
      if (high <= low) return null;
      const harmonyPartCount = Math.max(1, totalPartsInput.get() - 1);
      return generateHarmony(chords, { low, high }, harmonyPartCount);
    } catch {
      return null;
    }
  },
  [parsedChords, vocalRangeLow, vocalRangeHigh, totalPartsInput],
  { checkForEqualityOnNotify: false },
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function updatePartState(index: number, state: PartState): void {
  const current = partStates.get();
  const next = [...current];
  next[index] = state;
  partStates.set(next);
}

export function getKeptBlobs(): (Blob | null)[] {
  return partStates.get().map((p) => {
    if (p.status === "kept") return p.blob;
    return null;
  });
}

export function resetSession(): void {
  currentPartIndex.set(0);
  partStates.set(createIdlePartStates(totalPartsInput.get()));
  permissionError.set(null);
}
