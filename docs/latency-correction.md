# Latency Correction Approaches

This document summarizes practical approaches for timing-latency correction in browser-based multitrack recording, including the approach currently implemented in this repo.

## Why This Matters

In a layered recording workflow, the first take is recorded against a metronome and later takes are recorded against prior takes plus the metronome. If the first take is captured late (or early) relative to beat 1, every subsequent take inherits that misalignment.

Latency is not one value. It is a combination of:
- output/render latency (headphones/speakers, especially Bluetooth),
- input/capture latency (mic path + browser audio pipeline),
- DSP effects (AEC/noise suppression/AGC),
- scheduling and codec/container behavior.

## Approaches

### 1) Browser-Reported Latency Only (`outputLatency`, etc.)

How it works:
- Use Web Audio clock scheduling and adjust beat-1 timing using reported device latencies.

Pros:
- Zero extra UX.
- Fast and simple.

Cons:
- Reported values are often incomplete/inaccurate across devices.
- Usually does not model full input/capture path.
- Weak on Bluetooth edge cases.

Best for:
- Baseline correction, not full correction.

### 2) Fixed Heuristic Offsets by Device Class

How it works:
- Apply hardcoded offsets (for example, different defaults for wired vs Bluetooth).

Pros:
- Easy to ship.
- Better than no correction on obvious classes.

Cons:
- Fragile and coarse.
- Device-to-device variance remains large.

Best for:
- Temporary fallback, not primary strategy.

### 3) One-Time User Calibration (Clap/Tap) Per Session

How it works:
- Run a short calibration pass where the user performs rhythmic transients against known beat times.
- Detect those transients and estimate an offset from expected beat timestamps.

Pros:
- Device- and environment-specific.
- Usually much better than static heuristics.
- Low runtime cost after one calibration.

Cons:
- Requires extra onboarding step.
- Human timing variability can reduce confidence.

Best for:
- Consumer-facing recording apps with diverse hardware routes.

### 4) Per-Take Calibration

How it works:
- Repeat clap/tap alignment before each take.

Pros:
- Can track drift across route changes.

Cons:
- High UX friction.
- More likely to annoy users than help.

Best for:
- Specialized workflows where precision is critical and users accept overhead.

### 5) Programmatic Audio Correlation / Content-Based Alignment

How it works:
- Align tracks by cross-correlating guide/click leakage or known reference signals in captured audio.

Pros:
- Potentially automatic and very accurate when reference is recoverable.

Cons:
- Complex and brittle with clean isolation, voice-dominant content, or aggressive DSP.
- Harder to explain/debug for users.

Best for:
- Advanced pipelines with strong signal engineering and QA budget.

### 6) Physical/Acoustic Loopback Calibration Tone

How it works:
- Emit known chirp/click from output, detect return in mic, estimate round-trip latency.

Pros:
- Measures real end-to-end behavior directly.

Cons:
- Sensitive to room acoustics and leakage path.
- Can fail with headphones isolation.
- Requires careful UX and signal design.

Best for:
- Controlled environments or optional advanced calibration.

### 7) Manual Nudge Controls (User-Driven)

How it works:
- Let users shift track start offsets manually in milliseconds/beats.

Pros:
- Robust fallback.
- Transparent and recoverable.

Cons:
- Requires user effort/ear training.
- Not ideal as the only solution.

Best for:
- Final fallback and power-user control.

### 8) Hybrid (Recommended in Practice)

Typical order:
1. Web Audio scheduling + browser-reported latency baseline.
2. One-time calibration to estimate per-session correction.
3. Confidence gating + visualization.
4. Manual fallback if needed.

This usually gives the best quality/UX balance.

## What Is Implemented In This Repo

Current flow:
- `Setup -> Calibration -> Recording`
- Mic selection happens in calibration (not in recording wizard).
- Calibration is session-scoped.

Calibration UX:
- User hears 2 bars (8 clicks).
- First bar: listen.
- Second bar: clap every beat (4 target claps).
- Result view shows:
  - correction in ms,
  - confidence (`high`/`low`),
  - matched clap count,
  - timing score (`0-100`),
  - visualization (waveform + expected beat markers + detected clap markers).

Calibration algorithm (high level):
- Record calibration pass with `MediaRecorder`.
- Decode to PCM.
- Downmix to mono, high-pass, compute short-frame energy envelope.
- Detect transient peaks.
- Match peaks to expected clap beats in a constrained window.
- Compute residuals (`detected - expected`), use median residual as correction.
- Clamp correction to safe bounds.
- Compute a timing score based on clap completeness and interval evenness.
- Derive confidence from matched count, residual spread, and timing score.

Recording integration:
- Existing trim offset is still computed from Web Audio clock timing.
- Session `latencyCorrectionSec` is added to that base trim offset before take storage.
- All downstream playback/export already relies on stored `trimOffsetSec`, so calibration propagates naturally.

Key files:
- `src/recording/clapCalibration.ts`
- `src/ui/ClapCalibrationScreen.tsx`
- `src/recording/recorder.ts`
- `src/state/model.ts`

## Known Limitations

- Human claps are imperfect; bad timing lowers confidence.
- Noise suppression/AEC can smear transients.
- Bluetooth latency can still vary during a session.
- Confidence is heuristic, not absolute truth.

## Potential Next Steps

- Persist calibration by route fingerprint (mic + output device) for optional auto-skip.
- Add optional “quick recalibrate” trigger on route/device change detection.
- Add manual fine-nudge control in recording/review for low-confidence cases.
- Add offline synthetic tests for clap detection robustness at varying SNR.
