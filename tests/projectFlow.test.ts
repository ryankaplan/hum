import { describe, expect, it } from "vitest";
import { resolvePostPermissionAppScreen } from "../src/recording/permissions";
import { resolveRestoredAppScreen } from "../src/state/model";
import { createEmptyTracksDocument } from "../src/state/tracksModel";

describe("resolveRestoredAppScreen", () => {
  it("reopens drafts without takes in setup", () => {
    expect(
      resolveRestoredAppScreen({
        tracks: createEmptyTracksDocument(4),
      }),
    ).toBe("setup");
  });

  it("reopens drafts with takes in final review", () => {
    const tracks = createEmptyTracksDocument(4);
    const trackId = tracks.trackOrder[0]!;
    tracks.recordingsById["recording-1"] = {
      id: "recording-1",
      trackId,
      mediaAssetId: "media-asset-1",
    };

    expect(resolveRestoredAppScreen({ tracks })).toBe("review");
  });
});

describe("resolvePostPermissionAppScreen", () => {
  it("sends users to calibration until latency is confirmed", () => {
    expect(
      resolvePostPermissionAppScreen({
        isCalibrated: false,
        hasPendingRecordingTarget: false,
      }),
    ).toBe("calibration");

    expect(
      resolvePostPermissionAppScreen({
        isCalibrated: false,
        hasPendingRecordingTarget: true,
      }),
    ).toBe("calibration");
  });

  it("returns to review when setup flow is already calibrated", () => {
    expect(
      resolvePostPermissionAppScreen({
        isCalibrated: true,
        hasPendingRecordingTarget: false,
      }),
    ).toBe("review");
  });

  it("continues into recording when review requested a take and calibration is ready", () => {
    expect(
      resolvePostPermissionAppScreen({
        isCalibrated: true,
        hasPendingRecordingTarget: true,
      }),
    ).toBe("recording");
  });
});
