export const VOLUME_AUTOMATION_PARAM = "volume" as const;

export type AutomationParam = typeof VOLUME_AUTOMATION_PARAM;

export type AutomationPointKind = "boundary" | "control" | "generated";

export type AutomationPoint = {
  id: string;
  timeSec: number;
  value: number;
  kind: AutomationPointKind;
};

export type ClipAutomationLane = {
  param: AutomationParam;
  min: number;
  max: number;
  defaultValue: number;
  points: AutomationPoint[];
};

export type ClipAutomation = Record<AutomationParam, ClipAutomationLane>;

export type ApplyAutomationBrushInput = {
  lane: ClipAutomationLane;
  durationSec: number;
  centerSec: number;
  deltaValue: number;
  radiusSec: number;
};

export type UpsertVolumeControlPointInput = {
  lane: ClipAutomationLane;
  durationSec: number;
  timeSec: number;
  value?: number;
  pointId?: string;
};

export type MoveVolumeControlPointInput = {
  lane: ClipAutomationLane;
  durationSec: number;
  pointId: string;
  timeSec: number;
  value: number;
};

export type RemoveVolumeControlPointInput = {
  lane: ClipAutomationLane;
  durationSec: number;
  pointId: string;
};

const EPSILON = 1e-6;
const VOLUME_MIN = 0;
const VOLUME_MAX = 2;
const VOLUME_DEFAULT = 1;
const SAMPLE_STEP_SEC = 0.08;
const SIMPLIFY_TOLERANCE = 0.008;
const MAX_SIMPLIFIED_GAP_SEC = 0.32;
const CONTROL_EDGE_GUARD_SEC = 0.005;

let pointIdCounter = 0;

export function createDefaultClipAutomation(durationSec: number): ClipAutomation {
  return {
    [VOLUME_AUTOMATION_PARAM]: createDefaultVolumeLane(durationSec),
  };
}

export function createDefaultVolumeLane(durationSec: number): ClipAutomationLane {
  const duration = sanitizeDuration(durationSec);
  return {
    param: VOLUME_AUTOMATION_PARAM,
    min: VOLUME_MIN,
    max: VOLUME_MAX,
    defaultValue: VOLUME_DEFAULT,
    points: makeBoundaryPoints(duration, VOLUME_DEFAULT),
  };
}

export function getVolumeAutomationLane(
  automation: ClipAutomation | undefined,
  durationSec: number,
): ClipAutomationLane {
  const lane = automation?.[VOLUME_AUTOMATION_PARAM];
  if (lane == null) {
    return createDefaultVolumeLane(durationSec);
  }
  return normalizeLane(lane, durationSec);
}

export function withUpdatedVolumeLane(
  automation: ClipAutomation | undefined,
  lane: ClipAutomationLane,
  durationSec: number,
): ClipAutomation {
  const base = automation ?? createDefaultClipAutomation(durationSec);
  return {
    ...base,
    [VOLUME_AUTOMATION_PARAM]: normalizeLane(lane, durationSec),
  };
}

export function evaluateAutomationLaneAtTime(
  lane: ClipAutomationLane,
  timeSec: number,
  durationSec: number,
): number {
  const duration = sanitizeDuration(durationSec);
  const normalized = normalizeLane(lane, duration);
  const points = normalized.points;
  const sampleTime = clamp(timeSec, 0, duration);
  const first = points[0];
  if (first == null) {
    return clamp(normalized.defaultValue, normalized.min, normalized.max);
  }
  if (sampleTime <= first.timeSec) return first.value;

  let prev = first;
  for (let i = 1; i < points.length; i++) {
    const next = points[i];
    if (next == null) continue;
    if (sampleTime <= next.timeSec + EPSILON) {
      const span = Math.max(EPSILON, next.timeSec - prev.timeSec);
      const ratio = clamp((sampleTime - prev.timeSec) / span, 0, 1);
      const value = prev.value + (next.value - prev.value) * ratio;
      return clamp(value, normalized.min, normalized.max);
    }
    prev = next;
  }
  return prev.value;
}

export function applyAutomationBrush(input: ApplyAutomationBrushInput): ClipAutomationLane {
  const duration = sanitizeDuration(input.durationSec);
  const radius = Math.max(0, input.radiusSec);
  if (
    duration <= 0 ||
    radius <= EPSILON ||
    Math.abs(input.deltaValue) <= EPSILON
  ) {
    return normalizeLane(input.lane, duration);
  }

  const lane = normalizeLane(input.lane, duration);
  const center = clamp(input.centerSec, 0, duration);
  const start = Math.max(0, center - radius);
  const end = Math.min(duration, center + radius);

  const applyDelta = (timeSec: number): number => {
    const base = evaluateAutomationLaneAtTime(lane, timeSec, duration);
    const dist = Math.abs(timeSec - center);
    const weight =
      dist >= radius
        ? 0
        : 0.5 * (Math.cos((dist / radius) * Math.PI) + 1);
    return clamp(base + input.deltaValue * weight, lane.min, lane.max);
  };

  const sampleTimes = buildSampleTimes({
    durationSec: duration,
    startSec: start,
    centerSec: center,
    endSec: end,
    points: lane.points,
  });

  const generatedSamples: AutomationPoint[] = sampleTimes.map((timeSec) =>
    createPoint(timeSec, applyDelta(timeSec), "generated"),
  );

  const preservedControls = lane.points
    .filter((point) => point.kind === "control")
    .map((point) =>
      createPoint(point.timeSec, applyDelta(point.timeSec), "control", point.id),
    );

  return normalizeLane(
    {
      ...lane,
      points: simplifyPoints(
        [...generatedSamples, ...preservedControls],
        lane.defaultValue,
        duration,
      ),
    },
    duration,
  );
}

export function upsertVolumeControlPoint(
  input: UpsertVolumeControlPointInput,
): { lane: ClipAutomationLane; pointId: string } {
  const duration = sanitizeDuration(input.durationSec);
  const lane = normalizeLane(input.lane, duration);

  const controlTime = clampControlTime(input.timeSec, duration);
  const controlValue = clamp(
    input.value ?? evaluateAutomationLaneAtTime(lane, controlTime, duration),
    lane.min,
    lane.max,
  );

  const existing =
    input.pointId == null
      ? null
      : lane.points.find(
          (point) => point.kind === "control" && point.id === input.pointId,
        ) ?? null;

  const pointId = existing?.id ?? input.pointId ?? makePointId();
  const nextPoints = lane.points.filter((point) => point.id !== pointId);
  nextPoints.push(createPoint(controlTime, controlValue, "control", pointId));

  return {
    lane: normalizeLane(
      {
        ...lane,
        points: simplifyPoints(nextPoints, lane.defaultValue, duration),
      },
      duration,
    ),
    pointId,
  };
}

export function moveVolumeControlPoint(
  input: MoveVolumeControlPointInput,
): { lane: ClipAutomationLane; pointId: string } {
  return upsertVolumeControlPoint({
    lane: input.lane,
    durationSec: input.durationSec,
    pointId: input.pointId,
    timeSec: input.timeSec,
    value: input.value,
  });
}

export function removeVolumeControlPoint(
  input: RemoveVolumeControlPointInput,
): ClipAutomationLane {
  const duration = sanitizeDuration(input.durationSec);
  const lane = normalizeLane(input.lane, duration);

  const points = lane.points.filter(
    (point) => !(point.kind === "control" && point.id === input.pointId),
  );

  return normalizeLane(
    {
      ...lane,
      points: simplifyPoints(points, lane.defaultValue, duration),
    },
    duration,
  );
}

export function splitClipAutomationAtTime(
  automation: ClipAutomation | undefined,
  splitSec: number,
  durationSec: number,
): { left: ClipAutomation; right: ClipAutomation } {
  const duration = sanitizeDuration(durationSec);
  const split = clamp(splitSec, 0, duration);
  const leftDuration = split;
  const rightDuration = Math.max(0, duration - split);
  const lane = getVolumeAutomationLane(automation, duration);

  const leftLane = sliceLaneRange(lane, 0, leftDuration, duration);
  const rightLane = sliceLaneRange(lane, split, rightDuration, duration);

  return {
    left: {
      [VOLUME_AUTOMATION_PARAM]: leftLane,
    },
    right: {
      [VOLUME_AUTOMATION_PARAM]: rightLane,
    },
  };
}

function buildSampleTimes(input: {
  durationSec: number;
  startSec: number;
  centerSec: number;
  endSec: number;
  points: AutomationPoint[];
}): number[] {
  const times: number[] = [
    0,
    input.durationSec,
    input.startSec,
    input.centerSec,
    input.endSec,
  ];

  for (const point of input.points) {
    times.push(point.timeSec);
  }

  for (let t = 0; t < input.durationSec; t += SAMPLE_STEP_SEC) {
    times.push(t);
  }

  const normalized = times
    .map((timeSec) => clamp(timeSec, 0, input.durationSec))
    .sort((a, b) => a - b);

  const deduped: number[] = [];
  for (const timeSec of normalized) {
    const last = deduped[deduped.length - 1];
    if (last == null || Math.abs(last - timeSec) > EPSILON) {
      deduped.push(timeSec);
    }
  }
  return deduped;
}

function sliceLaneRange(
  lane: ClipAutomationLane,
  rangeStartSec: number,
  rangeDurationSec: number,
  sourceDurationSec: number,
): ClipAutomationLane {
  const duration = sanitizeDuration(rangeDurationSec);
  const start = clamp(rangeStartSec, 0, sourceDurationSec);
  const end = clamp(start + duration, 0, sourceDurationSec);

  if (duration <= EPSILON) {
    const value = evaluateAutomationLaneAtTime(lane, start, sourceDurationSec);
    return {
      ...lane,
      points: [createPoint(0, value, "boundary")],
    };
  }

  const points: AutomationPoint[] = [
    createPoint(
      0,
      evaluateAutomationLaneAtTime(lane, start, sourceDurationSec),
      "boundary",
    ),
  ];

  for (const point of lane.points) {
    if (point.timeSec <= start + EPSILON || point.timeSec >= end - EPSILON) {
      continue;
    }
    points.push({
      ...point,
      timeSec: point.timeSec - start,
    });
  }

  points.push(
    createPoint(
      duration,
      evaluateAutomationLaneAtTime(lane, end, sourceDurationSec),
      "boundary",
    ),
  );

  return normalizeLane(
    {
      ...lane,
      points: simplifyPoints(points, lane.defaultValue, duration),
    },
    duration,
  );
}

function normalizeLane(lane: ClipAutomationLane, durationSec: number): ClipAutomationLane {
  const duration = sanitizeDuration(durationSec);
  const min = Number.isFinite(lane.min) ? lane.min : VOLUME_MIN;
  const max = Number.isFinite(lane.max) ? Math.max(min, lane.max) : VOLUME_MAX;
  const defaultValue = clamp(
    Number.isFinite(lane.defaultValue) ? lane.defaultValue : VOLUME_DEFAULT,
    min,
    max,
  );

  const sorted = normalizePoints(lane.points, duration, min, max);
  const withBoundaries = ensureBoundaryPoints(sorted, duration, defaultValue, min, max);
  const points = simplifyPoints(withBoundaries, defaultValue, duration);

  return {
    param: VOLUME_AUTOMATION_PARAM,
    min,
    max,
    defaultValue,
    points,
  };
}

function normalizePoints(
  points: AutomationPoint[],
  durationSec: number,
  min: number,
  max: number,
): AutomationPoint[] {
  const normalized = [...points]
    .map((point) => ({
      id: point.id || makePointId(),
      timeSec: clamp(point.timeSec, 0, durationSec),
      value: clamp(point.value, min, max),
      kind: point.kind ?? "generated",
    }))
    .sort((a, b) => a.timeSec - b.timeSec);

  const deduped: AutomationPoint[] = [];
  for (const point of normalized) {
    const prev = deduped[deduped.length - 1];
    if (prev == null || Math.abs(prev.timeSec - point.timeSec) > EPSILON) {
      deduped.push(point);
      continue;
    }

    const prevRank = kindRank(prev.kind);
    const nextRank = kindRank(point.kind);
    deduped[deduped.length - 1] =
      nextRank >= prevRank
        ? {
            ...point,
            timeSec: prev.timeSec,
          }
        : prev;
  }

  return deduped;
}

function ensureBoundaryPoints(
  points: AutomationPoint[],
  durationSec: number,
  defaultValue: number,
  min: number,
  max: number,
): AutomationPoint[] {
  if (durationSec <= EPSILON) {
    const value = clamp(points[0]?.value ?? defaultValue, min, max);
    return [createPoint(0, value, "boundary")];
  }

  const interior = points.filter(
    (point) => point.timeSec > EPSILON && point.timeSec < durationSec - EPSILON,
  );

  const startValue = evaluatePointsWithFallback(points, 0, durationSec, defaultValue);
  const endValue = evaluatePointsWithFallback(
    points,
    durationSec,
    durationSec,
    defaultValue,
  );

  return normalizePoints(
    [
      createPoint(0, startValue, "boundary"),
      ...interior,
      createPoint(durationSec, endValue, "boundary"),
    ],
    durationSec,
    min,
    max,
  );
}

function evaluatePointsWithFallback(
  points: AutomationPoint[],
  timeSec: number,
  durationSec: number,
  fallback: number,
): number {
  if (points.length === 0) return fallback;
  const t = clamp(timeSec, 0, durationSec);
  const first = points[0];
  if (first == null) return fallback;
  if (t <= first.timeSec) {
    if (Math.abs(first.timeSec) <= EPSILON) return first.value;
    const ratio = first.timeSec <= EPSILON ? 0 : t / first.timeSec;
    return fallback + (first.value - fallback) * ratio;
  }

  let prev = first;
  for (let i = 1; i < points.length; i++) {
    const next = points[i];
    if (next == null) continue;
    if (t <= next.timeSec + EPSILON) {
      const span = Math.max(EPSILON, next.timeSec - prev.timeSec);
      const ratio = clamp((t - prev.timeSec) / span, 0, 1);
      return prev.value + (next.value - prev.value) * ratio;
    }
    prev = next;
  }

  if (prev.timeSec >= durationSec - EPSILON) return prev.value;
  const remain = Math.max(EPSILON, durationSec - prev.timeSec);
  const ratio = clamp((t - prev.timeSec) / remain, 0, 1);
  return prev.value + (fallback - prev.value) * ratio;
}

function simplifyPoints(
  points: AutomationPoint[],
  defaultValue: number,
  durationSec: number,
): AutomationPoint[] {
  if (points.length <= 2) {
    return normalizePoints(points, durationSec, VOLUME_MIN, VOLUME_MAX);
  }

  const normalized = normalizePoints(points, durationSec, VOLUME_MIN, VOLUME_MAX);
  const kept: AutomationPoint[] = [];

  for (let i = 0; i < normalized.length; i++) {
    const point = normalized[i];
    if (point == null) continue;

    if (i === 0 || i === normalized.length - 1) {
      kept.push(point);
      continue;
    }

    if (point.kind !== "generated") {
      kept.push(point);
      continue;
    }

    const prev = kept[kept.length - 1];
    const next = normalized[i + 1];
    if (prev == null || next == null) {
      kept.push(point);
      continue;
    }

    const span = Math.max(EPSILON, next.timeSec - prev.timeSec);
    const ratio = clamp((point.timeSec - prev.timeSec) / span, 0, 1);
    const linear = prev.value + (next.value - prev.value) * ratio;
    const linearError = Math.abs(point.value - linear);
    const gapFromPrev = point.timeSec - prev.timeSec;

    if (linearError > SIMPLIFY_TOLERANCE || gapFromPrev > MAX_SIMPLIFIED_GAP_SEC) {
      kept.push(point);
    }
  }

  const last = normalized[normalized.length - 1];
  if (last != null) {
    const tail = kept[kept.length - 1];
    if (tail == null || Math.abs(tail.timeSec - last.timeSec) > EPSILON) {
      kept.push(last);
    }
  }

  if (durationSec <= EPSILON) {
    return [createPoint(0, kept[0]?.value ?? defaultValue, "boundary")];
  }

  const start = kept[0];
  const end = kept[kept.length - 1];
  if (start == null || end == null) {
    return makeBoundaryPoints(durationSec, defaultValue);
  }

  if (
    kept.length === 2 &&
    Math.abs(start.value - defaultValue) <= SIMPLIFY_TOLERANCE &&
    Math.abs(end.value - defaultValue) <= SIMPLIFY_TOLERANCE
  ) {
    return makeBoundaryPoints(durationSec, defaultValue);
  }

  return kept;
}

function makeBoundaryPoints(durationSec: number, value: number): AutomationPoint[] {
  if (durationSec <= EPSILON) {
    return [createPoint(0, value, "boundary")];
  }
  return [
    createPoint(0, value, "boundary"),
    createPoint(durationSec, value, "boundary"),
  ];
}

function createPoint(
  timeSec: number,
  value: number,
  kind: AutomationPointKind,
  id?: string,
): AutomationPoint {
  return {
    id: id ?? makePointId(),
    timeSec,
    value,
    kind,
  };
}

function clampControlTime(timeSec: number, durationSec: number): number {
  if (durationSec <= CONTROL_EDGE_GUARD_SEC * 2) {
    return clamp(timeSec, 0, durationSec);
  }
  return clamp(
    timeSec,
    CONTROL_EDGE_GUARD_SEC,
    durationSec - CONTROL_EDGE_GUARD_SEC,
  );
}

function kindRank(kind: AutomationPointKind): number {
  if (kind === "control") return 3;
  if (kind === "boundary") return 2;
  return 1;
}

function makePointId(): string {
  pointIdCounter += 1;
  return `pt-${pointIdCounter}`;
}

function sanitizeDuration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
