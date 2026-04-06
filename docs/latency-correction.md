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
- `Setup -> Calibration -> Recording`
- Mic selection happens in calibration.
- Calibration is session-scoped.

Calibration UX:
- User hears 2 bars (8 clicks).
- Bar 1: listen.
- Bar 2: say “one, two, three, four” on each beat.
- App shows:
  - speech waveform,
  - fixed beat markers (bar-2 targets emphasized),
  - draggable horizontal alignment.
- User can play a looped 2-bar preview (metronome + shifted speech) to verify alignment.
- Derived correction is computed from drag shift:
  - `latencyCorrectionSec = clamp(-manualShiftSec, min, max)`.

Recording integration:
- Recording still computes base trim from Web Audio clock timing.
- Session `latencyCorrectionSec` is added to base trim before take storage.
- Existing playback/export paths already use `trimOffsetSec`, so correction propagates naturally.

Key files:
- `src/recording/clapCalibration.ts` (capture + preview + shift conversion)
- `src/ui/ClapCalibrationScreen.tsx` (manual alignment UI)
- `src/recording/recorder.ts` (applies correction to trim offset)
- `src/state/model.ts` (session calibration state)

## Known limitations

- Alignment quality is user-dependent.
- Speech waveform can still be shaped by AEC/noise suppression.
- Bluetooth latency can vary during a session.

## Potential next steps

- Persist calibration by route fingerprint (mic + output device).
- Add quick recalibration prompts on device/route change.
- Add optional fine nudge in recording/review screens.
