const DEFAULT_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  aspectRatio: { ideal: 9 / 16 },
  width: { ideal: 720 },
  height: { ideal: 1280 },
  facingMode: { ideal: "user" },
};

export const DEFAULT_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

type AcquireConfiguredMediaStreamOpts = {
  audioDeviceId?: string | null;
  includeVideo?: boolean;
};

export async function acquireConfiguredMediaStream(
  opts: AcquireConfiguredMediaStreamOpts = {},
): Promise<MediaStream> {
  const { audioDeviceId = null, includeVideo = true } = opts;
  return await navigator.mediaDevices.getUserMedia({
    video: includeVideo ? DEFAULT_VIDEO_CONSTRAINTS : false,
    audio: buildAudioConstraints(audioDeviceId),
  });
}

export function getStreamAudioDeviceId(stream: MediaStream | null): string | null {
  const track = stream?.getAudioTracks()[0] ?? null;
  if (track == null) return null;

  const settingsDeviceId = track.getSettings().deviceId;
  if (typeof settingsDeviceId === "string" && settingsDeviceId !== "") {
    return settingsDeviceId;
  }

  const constraintsDeviceId = track.getConstraints().deviceId;
  if (typeof constraintsDeviceId === "string" && constraintsDeviceId !== "") {
    return constraintsDeviceId;
  }
  if (
    constraintsDeviceId != null &&
    typeof constraintsDeviceId === "object" &&
    Array.isArray(constraintsDeviceId) === false &&
    typeof constraintsDeviceId.exact === "string" &&
    constraintsDeviceId.exact !== ""
  ) {
    return constraintsDeviceId.exact;
  }

  return null;
}

export function streamMatchesAudioDeviceId(
  stream: MediaStream | null,
  expectedDeviceId: string | null | undefined,
): boolean {
  if (expectedDeviceId == null || expectedDeviceId === "") {
    return false;
  }
  return getStreamAudioDeviceId(stream) === expectedDeviceId;
}

function buildAudioConstraints(
  audioDeviceId: string | null,
): MediaTrackConstraints {
  if (audioDeviceId == null || audioDeviceId === "") {
    return { ...DEFAULT_AUDIO_CONSTRAINTS };
  }
  return {
    ...DEFAULT_AUDIO_CONSTRAINTS,
    deviceId: { exact: audioDeviceId },
  };
}
