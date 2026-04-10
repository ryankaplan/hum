import { describe, expect, it } from "vitest";
import {
  createDefaultClipVolumeEnvelope,
  deleteClipVolumePoint,
  evaluateClipVolumeAtTime,
  insertClipVolumePoint,
  moveClipVolumePoint,
} from "../src/state/clipAutomation";

describe("clip volume keyframes", () => {
  it("inserts a keyframe without changing the existing line shape", () => {
    const envelope = createDefaultClipVolumeEnvelope(10);

    const next = insertClipVolumePoint({
      envelope,
      durationSec: 10,
      pointId: "mid",
      timeSec: 4,
      gainMultiplier: 1,
    });

    expect(next.points.map((point) => point.id)).toEqual([
      envelope.points[0]?.id,
      "mid",
      envelope.points[1]?.id,
    ]);
    expect(evaluateClipVolumeAtTime(next, 4, 10)).toBeCloseTo(1);
  });

  it("moves an interior keyframe in time and gain while clamping between neighbors", () => {
    const withFirstPoint = insertClipVolumePoint({
      envelope: createDefaultClipVolumeEnvelope(10),
      durationSec: 10,
      pointId: "mid",
      timeSec: 4,
      gainMultiplier: 1,
    });
    const inserted = insertClipVolumePoint({
      envelope: withFirstPoint,
      durationSec: 10,
      pointId: "next",
      timeSec: 6,
      gainMultiplier: 1,
    });

    const moved = moveClipVolumePoint({
      envelope: inserted,
      durationSec: 10,
      pointId: "mid",
      timeSec: 12,
      gainMultiplier: 0.5,
    });

    const movedPoint = moved.points.find((point) => point.id === "mid");
    expect(movedPoint?.timeSec).toBeLessThan(6);
    expect(movedPoint?.gainMultiplier).toBeCloseTo(0.5);
  });

  it("pins boundary keyframes in time while allowing vertical adjustment", () => {
    const envelope = createDefaultClipVolumeEnvelope(10);
    const startId = envelope.points[0]?.id;
    expect(startId).toBeDefined();

    const moved = moveClipVolumePoint({
      envelope,
      durationSec: 10,
      pointId: startId!,
      timeSec: 5,
      gainMultiplier: 1.5,
    });

    expect(moved.points[0]?.timeSec).toBe(0);
    expect(moved.points[0]?.gainMultiplier).toBeCloseTo(1.5);
  });

  it("deletes interior keyframes but keeps boundary keyframes", () => {
    const inserted = insertClipVolumePoint({
      envelope: createDefaultClipVolumeEnvelope(10),
      durationSec: 10,
      pointId: "mid",
      timeSec: 4,
      gainMultiplier: 0.25,
    });

    const deletedMid = deleteClipVolumePoint({
      envelope: inserted,
      durationSec: 10,
      pointId: "mid",
    });

    expect(deletedMid.points).toHaveLength(2);
    expect(deletedMid.points.some((point) => point.id === "mid")).toBe(false);

    const deletedBoundary = deleteClipVolumePoint({
      envelope: inserted,
      durationSec: 10,
      pointId: inserted.points[0]!.id,
    });

    expect(deletedBoundary.points).toHaveLength(3);
  });
});
