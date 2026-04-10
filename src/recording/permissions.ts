import { model, type AppScreen } from "../state/model";
import {
  acquireConfiguredMediaStream,
  getStreamAudioDeviceId,
  streamMatchesAudioDeviceId,
} from "./mediaStream";

export function resolvePostPermissionAppScreen(input: {
  isCalibrated: boolean;
  hasPendingRecordingTarget: boolean;
}): AppScreen {
  if (!input.isCalibrated) return "calibration";
  return input.hasPendingRecordingTarget ? "recording" : "review";
}

// Acquires camera + mic, prepares AudioContext, then routes into the next
// transient step for either setup or record-from-review.
export async function acquirePermissionsAndStart(): Promise<void> {
  model.permissionError.set(null);
  const expectedMicId = model.selectedMicId.get();

  let stream: MediaStream;
  try {
    try {
      stream = await acquireConfiguredMediaStream({
        audioDeviceId: expectedMicId,
        includeVideo: true,
      });
    } catch (err) {
      if (expectedMicId != null) {
        stream = await acquireConfiguredMediaStream({
          includeVideo: true,
        });
      } else {
        throw err;
      }
    }
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
  model.setSelectedMicId(getStreamAudioDeviceId(stream));

  await model.ensureAudioContext();

  const hasDraftWork =
    Object.keys(model.tracksDocument.document.get().recordingsById).length > 0;
  if (!hasDraftWork) {
    model.resetSession();
  } else if (!streamMatchesAudioDeviceId(stream, expectedMicId)) {
    model.clearCalibration();
  }
  if (shouldSkipCalibrationFromUrl()) {
    // Debug path: bypass calibration and use zero correction.
    model.setCalibrationOffset(0);
    model.appScreen.set(
      resolvePostPermissionAppScreen({
        isCalibrated: true,
        hasPendingRecordingTarget: model.recordingTargetTrackId.get() != null,
      }),
    );
    return;
  }
  model.appScreen.set(
    resolvePostPermissionAppScreen({
      isCalibrated: model.isCalibrated.get(),
      hasPendingRecordingTarget: model.recordingTargetTrackId.get() != null,
    }),
  );
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
