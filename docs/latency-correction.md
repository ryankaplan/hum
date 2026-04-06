# Latency Correction Approaches

This document summarizes practical approaches for latency correction in browser-based multitrack recording, including the manual speech-alignment flow currently used in this repo.

## Why this matters

Layered vocal recording depends on beat-accurate alignment. If take 1 is captured late/early relative to beat 1, all later takes can feel offset.

In browsers, latency is a combination of:

- output/render latency (headphones, especially Bluetooth),
- input/capture latency (mic + browser pipeline),
- DSP effects (AEC/noise suppression/AGC),
- scheduling and codec/container behavior.

## Approaches

### 1) Browser-reported latency only (`outputLatency`, etc.)

How it works:

- Use Web Audio scheduling and reported device latency fields.

Pros:

- No extra UX.
- Easy to implement.

Cons:

- Often incomplete/inaccurate across devices.
- Usually misses full capture-path delay.

### 2) Fixed heuristic offsets by device class

How it works:

- Apply defaults for wired/Bluetooth classes.

Pros:

- Fast to ship.

Cons:

- Coarse and brittle.
- Device variance remains high.

### 3) One-time user calibration (speech/manual)

How it works:

- Record user speech against metronome beats.
- Show waveform + beat markers.
- User manually aligns waveform and verifies by playback.

Pros:

- Works even when clap transients are suppressed (for example AirPods speech tuning).
- Device/session specific.
- Transparent and user-verifiable.

Cons:

- Adds an onboarding step.
- Depends on user alignment quality.

### 4) Per-take calibration

How it works:

- Repeat calibration before each take.

Pros:

- Tracks drift and route changes tightly.

Cons:

- High friction for normal users.

### 5) Content-based auto alignment (correlation/reference)

How it works:

- Auto-align from recovered reference signals in captured audio.

Pros:

- Can be very accurate in favorable conditions.

Cons:

- Complex and brittle with clean isolation or heavy DSP.

### 6) Loopback chirp/tone calibration

How it works:

- Emit known output signal and detect mic return to estimate round-trip latency.

Pros:

- Measures end-to-end path directly.

Cons:

- Environment- and hardware-sensitive.
- Can fail with strong isolation/headphones.

### 7) Manual nudge controls (editor-level)

How it works:

- Let users shift tracks in ms/beats after recording.

Pros:

- Reliable fallback.

Cons:

- Extra user effort.

### 8) Hybrid (common practical strategy)

Typical stack:

1. Web Audio scheduling baseline.
2. One-time calibration per session.
3. Preview/verification UX.
4. Manual fallback when needed.

## What is implemented in this repo

Current flow:

- `Setup -> Calibration -> Recording -> Review`.
- `Start Calibration` acquires camera/mic, resets session state, and routes to calibration.
- Mic selection is owned by calibration (recording view is mic-locked/read-only).
- Calibration is session-scoped only (`latencyCorrectionSec`, `isCalibrated`).

Calibration capture UX:

- User hears 2 bars (8 beats) at current tempo.
- Bar 1: listen.
- Bar 2: say “one, two, three, four” on the beats.
- While capturing, the UI shows a live 8-beat indicator (`LISTEN` for bar 1, `SPEAK` for bar 2).
- Changing microphone replaces the active audio track and clears any existing calibration.

Manual alignment + verification UX:

- Alignment view uses only bar 2 (the speaking bar), not bar 1.
- UI shows:
  - bar-2 speech waveform in gray,
  - fixed bar-2 beat lines,
  - draggable horizontal waveform shift.
- Drag is physically bounded to correction limits (no out-of-range drag state).
- Correction mapping:
  - `latencyCorrectionSec = clamp(-manualShiftSec, -0.8, 0.8)` (±800 ms).
- Preview loop plays bar 2 only (4 beats): metronome clicks + shifted speech.
- If shift/tempo changes during preview, playback is rescheduled so only one preview transport is active.
- `Continue to Recording` is enabled after a successful capture, even if drag is left at `0 ms`.

Recording integration:

- Recording computes a clock-based baseline trim:
  - `baseTrimOffsetSec = recordingStartTime - recorderStartCtxTime`.
- Final per-take trim applies session correction:
  - `trimOffsetSec = baseTrimOffsetSec + latencyCorrectionSec`.
- Stored `trimOffsetSec` drives multitrack alignment in later takes/review/export.

Key files:

- `src/recording/latencyCalibration.ts` (capture, waveform extraction, preview loop, shift->correction conversion)
- `src/ui/LatencyCalibrationScreen.tsx` (mic picker, capture flow, manual alignment UI, preview controls)
- `src/recording/recorder.ts` (applies correction into final take trim)
- `src/recording/permissions.ts` (setup->calibration transition and session reset)
- `src/state/model.ts` (session calibration state + clear/set APIs)

## Known limitations

- Alignment quality is user-dependent.
- Speech waveform can still be shaped by AEC/noise suppression.
- Bluetooth latency can vary during a session.
- The alignment window is only one bar, so rushed or very sparse speech can make visual alignment harder.

## Potential next steps

- Persist calibration by route fingerprint (mic + output device).
- Add quick recalibration prompts on device/route change.
- Add optional fine nudge in recording/review screens.
