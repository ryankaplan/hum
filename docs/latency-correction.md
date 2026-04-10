# Latency Correction Approaches

This document summarizes practical approaches for latency correction in browser-based multitrack recording, including the hybrid flow currently used in this repo.

## Why this matters

Layered vocal recording depends on beat-accurate alignment. If take 1 is captured late/early relative to beat 1, all later takes can feel offset.

In browsers, latency is a combination of:

- output/render latency (headphones, especially Bluetooth),
- input/capture latency (mic + browser pipeline),
- DSP effects (AEC/noise suppression/AGC),
- scheduling and codec/container behavior.

The important distinction in this repo is that we do not treat latency as a single fixed property of "these headphones + this mic". We use Web Audio timing plus a user calibration pass, and the saved calibration value is a residual correction for the current session, not a pure device-profile latency.

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
- Session-specific and user-verifiable.
- Captures the residual real-world offset left over after the browser's reported output latency is applied.
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
2. Reported output latency baseline (`ctx.outputLatency`) at playback/capture time.
3. One-time calibration per session for the remaining residual offset.
4. Preview/verification UX.
5. Manual fallback when needed.

This repo uses that hybrid model.

## What is implemented in this repo

Current flow:

- `Setup -> Calibration` when the session is not calibrated.
- `Calibrate Microphone` acquires camera/mic and routes to calibration.
- On a fresh session, permission acquisition resets recording state; when draft work already exists, calibration state is preserved unless the active mic route changes.
- Pressing `Continue` on calibration stores the session correction and returns to review; later takes consume that stored correction.
- If a session is already calibrated, reacquiring permissions can return directly to review.
- Mic selection is owned by calibration.
- Calibration is session-scoped only (`latencyCorrectionSec`, `isCalibrated`).
- Despite the name, `latencyCorrectionSec` is not a pure "mic latency" measurement. It is the residual correction still needed after the browser's current `ctx.outputLatency` estimate has already been accounted for.

Calibration capture UX:

- User hears 2 bars (8 beats) at current tempo.
- Bar 1: listen.
- Bar 2: say “one, two, three, four” on the beats.
- While capturing, the UI shows a live 8-beat indicator (`LISTEN` for bar 1, `SPEAK` for bar 2).
- Changing microphone replaces the active audio track and clears any existing calibration.
- The app requests `echoCancellation: false`, `noiseSuppression: false`, and `autoGainControl: false`, but device- or browser-level processing can still shape the recorded speech in some routes.

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
- `Continue` is enabled after a successful capture, even if drag is left at `0 ms`.

Mental model:

- During calibration capture, the expected beat positions in the recorded media already include `ctx.outputLatency`.
- During real take recording, beat 1 alignment is again computed with the current `ctx.outputLatency`.
- The saved calibration value is therefore the remaining residual offset, not the whole end-to-end route latency.

Recording integration:

- Calibration capture builds expected beat times like:
  - `beatTimeInCapture = scheduledBeatTime + ctx.outputLatency - recorderStartCtxTime`.
- Count-in for a real take computes:
  - `alignmentStartTime = gridStartTime + ctx.outputLatency`.
- Recording computes a clock-based baseline trim:
  - `baseTrimOffsetSec = alignmentStartTime - recorderStartCtxTime`.
- Final per-take alignment applies the saved session correction:
  - `alignmentOffsetSec = baseTrimOffsetSec + latencyCorrectionSec`.
- In practice, the effective alignment is approximately:
  - `current output latency + saved residual correction`.
- Stored `alignmentOffsetSec` drives multitrack alignment in later takes/review/export.
- Because the correction is a single constant per take, it compensates for route/session offset but does not model continuous drift within a take.

Key files:

- `src/recording/latencyCalibration.ts` (capture, waveform extraction, preview loop, shift->correction conversion)
- `src/ui/LatencyCalibrationScreen.tsx` (mic picker, capture flow, manual alignment UI, preview controls)
- `src/recording/recorder.ts` (applies correction into final take trim)
- `src/recording/permissions.ts` (setup->calibration transition and session reset)
- `src/state/model.ts` (session calibration state + clear/set APIs)

## Known limitations

- Alignment quality is user-dependent.
- Speech onset matching is still an estimate based on only four spoken beats.
- Even with the same named devices, run-to-run corrections can differ because Bluetooth buffering, browser-reported `outputLatency`, `MediaRecorder` startup timing, and speech onset detection all vary a bit.
- That run-to-run variation does not necessarily imply continuous drift within a take. The current model is a constant offset, and true drift would usually present as "starts in sync, ends out of sync."
- The alignment window is only one bar, so rushed or very sparse speech can make visual alignment harder.

## Potential next steps

- Persist calibration by route fingerprint (mic + output device).
- Surface calibration diagnostics such as `ctx.outputLatency`, auto-alignment confidence, matched beats, and mean alignment error.
- Add quick recalibration prompts on device/route change.
- Add optional fine nudge in recording/review screens.
