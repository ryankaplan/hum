# Recording & Audio API Overview

## Web Audio API in 60 seconds

The Web Audio API models audio processing as a **directed graph of nodes** all tied to a single `AudioContext`. The context owns a high-resolution monotonic clock (`ctx.currentTime`, in seconds) that advances independently of `Date.now()` or `setTimeout`. Because every scheduling call—`oscillator.start(t)`, `AudioBufferSourceNode.start(t, offset)`, `gain.setValueAtTime(v, t)`—references this same clock, multiple sources can be started at **exactly** the same sample, regardless of JavaScript jitter.

Key node types used here:

| Node | Role |
|---|---|
| `OscillatorNode` | Generates a periodic waveform (sine, triangle, etc.) |
| `GainNode` | Scales amplitude; doubles as a mute/volume control |
| `ConvolverNode` | Convolves audio with an impulse response (reverb) |
| `AudioBufferSourceNode` | Plays a decoded PCM buffer; single-use, fire-and-forget |
| `MediaStreamAudioDestinationNode` | Exposes the audio graph as a `MediaStream` for capture |

---

## Phase 1 — MediaStream acquisition (`permissions.ts`)

Everything starts with `navigator.mediaDevices.getUserMedia()`. This must be called from within a user gesture (a button click). It returns a `MediaStream` containing both a video track and a mic audio track.

At the same time, a single `AudioContext` is created (or resumed if it already exists). Browsers require an `AudioContext` to be created or resumed inside a user gesture — so permission acquisition and context creation are intentionally co-located.

The `MediaStream` is stored in app state and reused throughout the session. Tracks are explicitly stopped (`track.stop()`) when permissions are released.

---

## Phase 2 — Recording a take (`recorder.ts` + `playback.ts`)

```
getUserMedia stream
       │
       ▼
 MediaRecorder ──── ondataavailable ──► Blob chunks ──► final Blob
       │
       │  (started ~half a beat before beat 1)
       │
  AudioContext clock ──► count-in clicks ──► recording playback
```

### Count-in (`playCountIn`)

All metronome clicks are **pre-scheduled** onto the `AudioContext` clock with `OscillatorNode.start(t)` before any of them fire. This means timing is sample-accurate and immune to JS event-loop delays.

`playCountIn` returns two things:
- `recordingStartTime` — the exact `ctx.currentTime` value at which beat 1 will land (plus `ctx.outputLatency` to account for Bluetooth headphone latency, which can be 150–300 ms)
- `promise` — resolves ~half a beat *before* `recordingStartTime`, giving the caller lead time to create the `MediaRecorder`

### MediaRecorder

`MediaRecorder` is created and `.start(100)` is called right as the promise resolves. The `100` is the timeslice in ms — it fires `ondataavailable` every 100 ms rather than waiting until stop. At `.start()` time, `ctx.currentTime` is captured as `recorderStartCtxTime`.

```
trimOffsetSec = recordingStartTime − recorderStartCtxTime
```

This is the number of seconds of leading silence before beat 1 in every blob. It is stored with the take so future playback can skip over it.

`MediaRecorder` produces compressed video (`video/webm; codecs=vp9,opus`). The audio inside is **lossy-compressed Opus**, not PCM.

### Beat tracker

Because `AudioContext` scheduling is decoupled from the JS event loop, UI beat callbacks can't be scheduled with the audio. Instead, a `setInterval` at ~60 fps polls `ctx.currentTime` and fires callbacks when the time has passed a pre-computed beat timestamp. This is "good enough" for visual feedback but is not sample-accurate.

---

## Phase 3 — Monitor playback between takes (`monitorPlayer.ts`)

After a take is kept, the app plays back prior takes while the user records the next one. This is where we **move to `AudioContext`** for audio rather than playing the video element's audio track.

### Why not just use `<video>.play()`?

`HTMLMediaElement` playback is not sample-accurate — start time has ~50–100 ms of jitter. Using `AudioBufferSourceNode.start(when)` puts all prior takes on the same clock as the live click track, achieving sub-millisecond alignment.

### The decode step (slow)

> **Slow operation:** `blob.arrayBuffer()` + `ctx.decodeAudioData(arrayBuffer)`

The WebM blob from `MediaRecorder` contains compressed Opus audio. To play it back through the Web Audio graph it must be fully decoded to raw PCM first. `decodeAudioData` is asynchronous and CPU-bound — for a 30-second take it typically takes a few hundred milliseconds. It is called once per take, in `decodeMonitorTracks`, and the resulting `AudioBuffer` is reused for all subsequent playbacks.

### Playback

`createMonitorPlayer` builds one `GainNode` per track (persistent, for mute state) and creates fresh `AudioBufferSourceNode`s each time `start(when)` is called. The `trimOffsetSec` is passed as the second argument to `source.start(when, trimOffsetSec)`, which tells the buffer source to begin reading from that offset — effectively skipping the leading silence so beat 1 of every take aligns to `when`.

---

## Phase 4 — Final review & mix (`mixer.ts`, `FinalReview.tsx`)

### Audio graph

```
[AudioBufferSourceNode ×4]
         │
         ▼
  [trackGain ×4] ──────────────────────────────────► [dryGain (0.85)]  ─┐
         │                                                               ├──► [masterGain] ──► ctx.destination
         └──► [ConvolverNode (impulse reverb)] ──► [wetGain (0.15)] ─────┘
                                                                         │
                                                           (during export only)
                                                                         └──► [MediaStreamAudioDestinationNode]
```

The mixer is built **once at mount time**. `AudioBufferSourceNode`s are created fresh per playback and connected to their track's `GainNode` via `connectSource(i, node)`.

### Reverb

The `ConvolverNode` uses a **programmatically-generated impulse response** (`buildImpulseBuffer`) — exponentially-decaying white noise. No async file fetch needed. This runs synchronously at graph setup time.

### The decode step (slow, again)

> **Slow operation:** `blob.arrayBuffer()` + `ctx.decodeAudioData(ab)`

The same decode is repeated in `FinalReview` for each kept take on mount. The decoded `AudioBuffer`s are stored in a ref and reused for preview playback and the export pass. If a user navigates away and back, the decode runs again.

---

## Phase 5 — Export (`exporter.ts` + `compositor.ts`)

### Video compositing

The compositor runs a `requestAnimationFrame` loop that draws four muted `<video>` elements into a 2×2 grid on an `HTMLCanvasElement` at 540×960 (9:16). `canvas.captureStream(30)` returns a `MediaStream` with a video track that reflects whatever the canvas is currently rendering.

### Audio capture

`audioContext.createMediaStreamDestination()` creates a `MediaStreamAudioDestinationNode`. The mixer's master gain is temporarily connected to it via `connectForExport`. This exposes the entire mixed audio graph — gains, reverb, everything — as a `MediaStream` audio track. No decoding/re-encoding of individual files; the graph output is captured live.

### Recording

A second `MediaRecorder` records the combined `MediaStream` (canvas video track + audio destination track) for the full duration of the progression. This is effectively a screen-capture of the composition pass.

The exporter now prefers MP4 (`video/mp4`) when supported by `MediaRecorder` and automatically falls back to WebM when MP4 is unavailable in the current browser. The selected output format is reflected in the export/download UI.

---

## Slow operations summary

| Where | Operation | Why slow |
|---|---|---|
| `decodeMonitorTracks` | `blob.arrayBuffer()` + `ctx.decodeAudioData()` | Full Opus→PCM decode of each take; CPU-bound; proportional to take duration |
| `FinalReview` mount | Same decode, repeated per take | Same reason |
| Export | Real-time `MediaRecorder` pass | Must run in real time; can't be faster than the take duration |
