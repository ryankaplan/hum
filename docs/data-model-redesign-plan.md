# Data Model Redesign Plan

## Summary

Introduce a single global state entrypoint:

- `export const model = Model()` from `src/state/model.ts`

This model will become the canonical app state for setup, arrangement derivation, recording progress, tracks/timeline editing, and runtime media assets. React UI will bind to model observables via `useObservable`.

Key constraints for this redesign:

- No separate `MutableAssetsStore`; runtime mutable assets live directly on `Model`.
- No separate `actions` namespace; mutator methods are inlined directly on `Model`.

## Target Model Shape

```ts
// src/state/model.ts
export const model = Model();

type Model = {
  // existing app/session flow
  appScreen: Observable<AppScreen>;
  mediaStream: Observable<MediaStream | null>;
  audioContext: Observable<AudioContext | null>;
  permissionError: Observable<string | null>;
  currentPartIndex: Observable<PartIndex>;

  // immutable setup + derived arrangement
  arrangementInfo: Observable<ArrangementInfo>;

  // immutable recording/takes + timeline clips/tracks
  tracks: Observable<TracksState>;

  // mutable runtime assets (inlined on Model)
  audioBuffersByTakeId: Map<string, AudioBuffer>;
  waveformPeaksByTakeId: Map<string, WaveformPeaks>;
  videoElByTakeId: Map<string, HTMLVideoElement>;
  mixer: Mixer | null;
  compositor: CompositorHandle | null;

  // inlined mutator methods (no model.actions)
  setArrangementInput(patch: Partial<ArrangementInput>): void;
  recomputeArrangement(): void;
  keepRecordedTake(input: KeepTakeInput): void;
  initializeTrackFromTake(laneIndex: number, takeId: string): void;
  splitSelectedClipAtPlayhead(): void;
  moveClip(laneIndex: number, clipId: string, desiredStartSec: number): void;
  deleteSelectedClip(): void;
  setPlayhead(sec: number): void;
  setSelection(selection: EditorSelection): void;
  setSnapToBeat(enabled: boolean): void;
  setTrackVolume(laneIndex: number, volume: number): void;
  setTrackMuted(laneIndex: number, muted: boolean): void;
  setReverbWet(wet: number): void;
  redoPart(laneIndex: number): void;
  resetSession(): void;
};
```

## Data Contracts

### `arrangementInfo` (immutable)

Contains setup screen input + derived arrangement:

- Input:
  - `chordsInput: string`
  - `tempo: number`
  - `meter: Meter`
  - `vocalRangeLow: string`
  - `vocalRangeHigh: string`
- Derived:
  - `parsedChords: Chord[]`
  - `harmonyVoicing: HarmonyVoicing | null`
  - `beatSec: number`
  - `progressionDurationSec: number`
  - `isValid: boolean`

Update rule: replace entire `ArrangementInfo` object on writes/derivations. No in-place mutation of nested fields.

### `tracks` (immutable)

Tracks model used for both early recording flow and final review:

- `takesById: Record<TakeId, TakeRecord>`
- `lanes: TrackLane[]` (4 lanes for now)
- `editor: { selection, playheadSec, snapToBeat }`
- `mix: { volumes: number[4], muted: boolean[4], reverbWet: number }`
- `export: { exporting, progress, exportedUrl }`

Each lane contains `clips: TrackClip[]`, where each clip includes:

- `id`, `laneIndex`
- `takeId`
- `timelineStartSec`
- `sourceStartSec`
- `durationSec`

Update rule: all clip/lane/editor/mix/export updates return brand-new `tracks` object graphs.

### Runtime mutable assets (on `Model`)

Runtime-only values that should not drive UI through direct mutation:

- decoded `AudioBuffer`s
- waveform peak caches
- HTML video elements
- mixer/compositor handles

These are keyed by stable ids (prefer `takeId`) and mutated only inside model methods. UI reactivity still comes from immutable observables (`arrangementInfo`, `tracks`, etc).

## Migration Steps

1. Create model root and compatibility bridge
- Add `src/state/model.ts` with `Model()` + `export const model`.
- Keep `src/state/appState.ts` as temporary adapter that re-exports fields from `model` so existing imports keep working.

2. Move setup and derived arrangement into `arrangementInfo`
- Replace standalone setup observables (`chordsInput`, `tempoInput`, etc.) with `model.arrangementInfo`.
- Add model methods to update setup inputs and recompute derived arrangement.
- Update `SetupScreen.tsx` to read/write `model.arrangementInfo`.
- Preserve existing persisted localStorage keys (`hum.chords`, `hum.tempo`, etc.) via migration-aware reads/writes at model init.

3. Move timeline/editor/mix state into `tracks`
- Lift `FinalReview.tsx` local state (`timelines`, `selection`, `playheadSec`, `snapToBeat`, `volumes`, `muted`, `reverbWet`, export state) into `model.tracks`.
- Convert split/move/delete/seek/mix handlers to call inlined model methods.

4. Move take lifecycle earlier in flow
- On keep in `RecordingWizard.tsx`, create/update take records in `model.tracks.takesById` immediately.
- Initialize first clip for each kept take through model methods, so tracks exist before entering final review.

5. Inline runtime asset orchestration on model
- Move decode/cache/lifecycle orchestration currently in `FinalReview.tsx` refs/effects to model methods/fields.
- Keep disposal responsibilities explicit (`resetSession`, screen transitions, unmount cleanup).

6. Remove adapter layer
- After all screens/modules import `model` directly, remove legacy standalone exports from `appState.ts`.

## Files To Touch

- `src/state/model.ts` (new)
- `src/state/appState.ts` (temporary bridge, then cleanup)
- `src/ui/SetupScreen.tsx`
- `src/ui/RecordingWizard.tsx`
- `src/ui/FinalReview.tsx`
- `src/recording/permissions.ts`

## Test Plan

1. Arrangement derivation
- Input changes update `arrangementInfo` immutably.
- `isValid` flips correctly for invalid chord/range combinations.
- Parsed chords and voicing stay in sync with meter/range changes.

2. Tracks/clip operations
- Split creates two clips with correct timing/source offsets.
- Move clamps against neighbor clips and lane start.
- Delete updates selection safely.
- Redo part removes/invalidates related takes and clips as intended.

3. Recording + review integration
- Keeping a take creates track/take state before review.
- Entering review with existing takes hydrates timeline correctly.
- Export progress/url updates through `tracks.export`.

4. Runtime assets behavior
- Decoded buffers/cache keys stay stable by `takeId`.
- Asset cleanup runs on reset/start-over and when replacing takes.
- Mixer/compositor disposal does not leak between sessions.

## Assumptions / Defaults

- Current 4-lane structure remains unchanged in this redesign.
- Existing observable implementation (`src/observable.ts`) remains the reactive foundation.
- Persistence is only required for setup input fields, not for timeline edit state or runtime assets.
- `tracks` and `arrangementInfo` remain immutable-by-replacement even if internal helper functions use local mutable temporaries before setting.
