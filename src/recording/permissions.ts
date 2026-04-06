import { model } from "../state/model";

// Called when the user clicks "Start Calibration" on the setup screen.
// Acquires camera + mic, sets up AudioContext, then transitions to calibration.
export async function acquirePermissionsAndStart(): Promise<void> {
  model.permissionError.set(null);

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        aspectRatio: { ideal: 9 / 16 },
        width: { ideal: 720 },
        height: { ideal: 1280 },
        facingMode: { ideal: "user" },
      },
      audio: true,
    });
  } catch (err) {
    const message =
      err instanceof DOMException
        ? formatPermissionError(err)
        : "Could not access camera or microphone.";
    model.permissionError.set(message);
    return;
  }

  // Stop any previously held stream tracks before replacing
  const existing = model.mediaStream.get();
  if (existing != null) {
    for (const track of existing.getTracks()) {
      track.stop();
    }
  }

  model.mediaStream.set(stream);

  // Create (or resume) the AudioContext. A user gesture is in scope here
  // (the button click that triggered this function), so browsers allow it.
  let ctx = model.audioContext.get();
  if (ctx == null) {
    ctx = new AudioContext();
  }
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  model.audioContext.set(ctx);

  model.resetSession();
  if (shouldSkipCalibrationFromUrl()) {
    // Debug path: bypass calibration and use zero correction.
    model.setCalibrationOffset(0);
    model.appScreen.set("recording");
    return;
  }
  model.appScreen.set("calibration");
}

function shouldSkipCalibrationFromUrl(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("skip-calibration")) return false;

  const raw = params.get("skip-calibration");
  if (raw == null || raw.trim() === "") return true;

  const normalized = raw.trim().toLowerCase();
  return !(
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  );
}

function formatPermissionError(err: DOMException): string {
  switch (err.name) {
    case "NotAllowedError":
      return "Camera and microphone access was denied. Please allow access in your browser settings and try again.";
    case "NotFoundError":
      return "No camera or microphone found. Please connect a device and try again.";
    case "NotReadableError":
      return "Your camera or microphone is already in use by another application.";
    default:
      return `Could not access camera or microphone: ${err.message}`;
  }
}

export function releasePermissions(): void {
  const stream = model.mediaStream.get();
  if (stream != null) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
  model.mediaStream.set(null);
}
