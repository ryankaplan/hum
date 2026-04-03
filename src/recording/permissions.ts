import * as Tone from "tone";
import {
  appScreen,
  audioContext,
  mediaStream,
  permissionError,
  resetSession,
} from "../state/appState";

// Called when the user clicks "Start Recording" on the setup screen.
// Acquires camera + mic, sets up AudioContext, then transitions to recording.
export async function acquirePermissionsAndStart(): Promise<void> {
  permissionError.set(null);

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
    permissionError.set(message);
    return;
  }

  // Stop any previously held stream tracks before replacing
  const existing = mediaStream.get();
  if (existing != null) {
    for (const track of existing.getTracks()) {
      track.stop();
    }
  }

  mediaStream.set(stream);

  // Create (or resume) the AudioContext. We let Tone.js own it so all timing
  // goes through the same context.
  await Tone.start();
  audioContext.set(Tone.getContext().rawContext as AudioContext);

  resetSession();
  appScreen.set("recording");
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
  const stream = mediaStream.get();
  if (stream != null) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
  mediaStream.set(null);
}
