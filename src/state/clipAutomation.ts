export type VolumePoint = {
  id: string;
  timeSec: number;
  gainMultiplier: number;
};

export type ClipVolumeEnvelope = {
  points: VolumePoint[];
};

export type InsertClipVolumePointInput = {
  envelope: ClipVolumeEnvelope;
  durationSec: number;
  pointId: string;
  timeSec: number;
  gainMultiplier: number;
};

export type MoveClipVolumePointInput = {
  envelope: ClipVolumeEnvelope;
  durationSec: number;
  pointId: string;
  timeSec: number;
  gainMultiplier: number;
};

export type DeleteClipVolumePointInput = {
  envelope: ClipVolumeEnvelope;
  durationSec: number;
  pointId: string;
};

const EPSILON = 1e-6;
const VOLUME_GAIN_MIN = 0;
const VOLUME_GAIN_MAX = 2;
const DEFAULT_GAIN_MULTIPLIER = 1;

let pointIdCounter = 0;

export function createDefaultClipVolumeEnvelope(
  durationSec: number,
): ClipVolumeEnvelope {
  const duration = sanitizeDuration(durationSec);
  return {
    points: makeBoundaryPoints(duration, DEFAULT_GAIN_MULTIPLIER),
  };
}

export function createVolumePointId(): string {
  return makePointId();
}

export function evaluateClipVolumeAtTime(
  envelope: ClipVolumeEnvelope | undefined,
  timeSec: number,
  durationSec: number,
): number {
  const duration = sanitizeDuration(durationSec);
  const normalized = normalizeEnvelope(envelope, duration);
  const points = normalized.points;
  const sampleTime = clamp(timeSec, 0, duration);
  const first = points[0];
  if (first == null) return DEFAULT_GAIN_MULTIPLIER;
  if (sampleTime <= first.timeSec) return first.gainMultiplier;

  let prev = first;
  for (let i = 1; i < points.length; i++) {
    const next = points[i];
    if (next == null) continue;
    if (sampleTime <= next.timeSec + EPSILON) {
      const span = Math.max(EPSILON, next.timeSec - prev.timeSec);
      const ratio = clamp((sampleTime - prev.timeSec) / span, 0, 1);
      const gainMultiplier =
        prev.gainMultiplier +
        (next.gainMultiplier - prev.gainMultiplier) * ratio;
      return clamp(gainMultiplier, VOLUME_GAIN_MIN, VOLUME_GAIN_MAX);
    }
    prev = next;
  }
  return prev.gainMultiplier;
}

export function insertClipVolumePoint(
  input: InsertClipVolumePointInput,
): ClipVolumeEnvelope {
  const duration = sanitizeDuration(input.durationSec);
  const envelope = normalizeEnvelope(input.envelope, duration);

  return normalizeEnvelope(
    {
      points: [
        ...envelope.points,
        createPoint(
          clamp(input.timeSec, 0, duration),
          clamp(input.gainMultiplier, VOLUME_GAIN_MIN, VOLUME_GAIN_MAX),
          input.pointId,
        ),
      ],
    },
    duration,
  );
}

export function moveClipVolumePoint(
  input: MoveClipVolumePointInput,
): ClipVolumeEnvelope {
  const duration = sanitizeDuration(input.durationSec);
  const envelope = normalizeEnvelope(input.envelope, duration);
  const index = envelope.points.findIndex((point) => point.id === input.pointId);
  if (index < 0) return envelope;

  const point = envelope.points[index];
  if (point == null) return envelope;

  const isFirst = index === 0;
  const isLast = index === envelope.points.length - 1;
  const prev = isFirst ? null : envelope.points[index - 1] ?? null;
  const next = isLast ? null : envelope.points[index + 1] ?? null;
  const minTime = isFirst ? 0 : Math.max(0, (prev?.timeSec ?? 0) + EPSILON);
  const maxTime = isLast
    ? duration
    : Math.max(minTime, (next?.timeSec ?? duration) - EPSILON);

  const nextPoint: VolumePoint = {
    ...point,
    timeSec: isFirst ? 0 : isLast ? duration : clamp(input.timeSec, minTime, maxTime),
    gainMultiplier: clamp(
      input.gainMultiplier,
      VOLUME_GAIN_MIN,
      VOLUME_GAIN_MAX,
    ),
  };

  const nextPoints = [...envelope.points];
  nextPoints[index] = nextPoint;
  return normalizeEnvelope({ points: nextPoints }, duration);
}

export function deleteClipVolumePoint(
  input: DeleteClipVolumePointInput,
): ClipVolumeEnvelope {
  const duration = sanitizeDuration(input.durationSec);
  const envelope = normalizeEnvelope(input.envelope, duration);
  const index = envelope.points.findIndex((point) => point.id === input.pointId);
  if (index <= 0 || index >= envelope.points.length - 1) {
    return envelope;
  }

  return normalizeEnvelope(
    {
      points: envelope.points.filter((point) => point.id !== input.pointId),
    },
    duration,
  );
}

export function splitClipVolumeEnvelopeAtTime(
  envelope: ClipVolumeEnvelope | undefined,
  splitSec: number,
  durationSec: number,
): { left: ClipVolumeEnvelope; right: ClipVolumeEnvelope } {
  const duration = sanitizeDuration(durationSec);
  const split = clamp(splitSec, 0, duration);
  const normalized = normalizeEnvelope(envelope, duration);

  return {
    left: sliceEnvelopeRange(normalized, 0, split, duration),
    right: sliceEnvelopeRange(
      normalized,
      split,
      Math.max(0, duration - split),
      duration,
    ),
  };
}

function sliceEnvelopeRange(
  envelope: ClipVolumeEnvelope,
  rangeStartSec: number,
  rangeDurationSec: number,
  sourceDurationSec: number,
): ClipVolumeEnvelope {
  const duration = sanitizeDuration(rangeDurationSec);
  const start = clamp(rangeStartSec, 0, sourceDurationSec);
  const end = clamp(start + duration, 0, sourceDurationSec);

  if (duration <= EPSILON) {
    return {
      points: [
        createPoint(
          0,
          evaluateClipVolumeAtTime(envelope, start, sourceDurationSec),
        ),
      ],
    };
  }

  const points: VolumePoint[] = [
    createPoint(0, evaluateClipVolumeAtTime(envelope, start, sourceDurationSec)),
  ];

  for (const point of envelope.points) {
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
      evaluateClipVolumeAtTime(envelope, end, sourceDurationSec),
    ),
  );

  return normalizeEnvelope({ points }, duration);
}

function normalizeEnvelope(
  envelope: ClipVolumeEnvelope | undefined,
  durationSec: number,
): ClipVolumeEnvelope {
  const duration = sanitizeDuration(durationSec);
  const normalizedPoints = normalizePoints(envelope?.points ?? [], duration);
  return {
    points: ensureBoundaryPoints(normalizedPoints, duration),
  };
}

function normalizePoints(
  points: VolumePoint[],
  durationSec: number,
): VolumePoint[] {
  const normalized = [...points]
    .map((point) => ({
      id: point.id || makePointId(),
      timeSec: clamp(point.timeSec, 0, durationSec),
      gainMultiplier: clamp(
        point.gainMultiplier,
        VOLUME_GAIN_MIN,
        VOLUME_GAIN_MAX,
      ),
    }))
    .sort((a, b) => a.timeSec - b.timeSec);

  const deduped: VolumePoint[] = [];
  for (const point of normalized) {
    const prev = deduped[deduped.length - 1];
    if (prev == null || Math.abs(prev.timeSec - point.timeSec) > EPSILON) {
      deduped.push(point);
    } else {
      deduped[deduped.length - 1] = {
        ...point,
        timeSec: prev.timeSec,
      };
    }
  }
  return deduped;
}

function ensureBoundaryPoints(
  points: VolumePoint[],
  durationSec: number,
): VolumePoint[] {
  if (durationSec <= EPSILON) {
    const gainMultiplier = points[0]?.gainMultiplier ?? DEFAULT_GAIN_MULTIPLIER;
    const existingBoundary =
      points.find((point) => Math.abs(point.timeSec) <= EPSILON) ?? points[0] ?? null;
    return [createPoint(0, gainMultiplier, existingBoundary?.id)];
  }

  const interior = points.filter(
    (point) => point.timeSec > EPSILON && point.timeSec < durationSec - EPSILON,
  );
  const existingStart =
    points.find((point) => Math.abs(point.timeSec) <= EPSILON) ?? null;
  const existingEnd =
    [...points].reverse().find((point) => Math.abs(point.timeSec - durationSec) <= EPSILON) ??
    null;
  const startGainMultiplier = evaluatePointsWithFallback(points, 0, durationSec);
  const endGainMultiplier = evaluatePointsWithFallback(
    points,
    durationSec,
    durationSec,
  );

  return normalizePoints(
    [
      createPoint(0, startGainMultiplier, existingStart?.id),
      ...interior,
      createPoint(durationSec, endGainMultiplier, existingEnd?.id),
    ],
    durationSec,
  );
}

function evaluatePointsWithFallback(
  points: VolumePoint[],
  timeSec: number,
  durationSec: number,
): number {
  if (points.length === 0) return DEFAULT_GAIN_MULTIPLIER;
  const t = clamp(timeSec, 0, durationSec);
  const first = points[0];
  if (first == null) return DEFAULT_GAIN_MULTIPLIER;
  if (t <= first.timeSec) {
    if (Math.abs(first.timeSec) <= EPSILON) return first.gainMultiplier;
    const ratio = first.timeSec <= EPSILON ? 0 : t / first.timeSec;
    return (
      DEFAULT_GAIN_MULTIPLIER +
      (first.gainMultiplier - DEFAULT_GAIN_MULTIPLIER) * ratio
    );
  }

  let prev = first;
  for (let i = 1; i < points.length; i++) {
    const next = points[i];
    if (next == null) continue;
    if (t <= next.timeSec + EPSILON) {
      const span = Math.max(EPSILON, next.timeSec - prev.timeSec);
      const ratio = clamp((t - prev.timeSec) / span, 0, 1);
      return (
        prev.gainMultiplier +
        (next.gainMultiplier - prev.gainMultiplier) * ratio
      );
    }
    prev = next;
  }

  if (prev.timeSec >= durationSec - EPSILON) return prev.gainMultiplier;
  const remain = Math.max(EPSILON, durationSec - prev.timeSec);
  const ratio = clamp((t - prev.timeSec) / remain, 0, 1);
  return (
    prev.gainMultiplier +
    (DEFAULT_GAIN_MULTIPLIER - prev.gainMultiplier) * ratio
  );
}

function makeBoundaryPoints(
  durationSec: number,
  gainMultiplier: number,
): VolumePoint[] {
  if (durationSec <= EPSILON) {
    return [createPoint(0, gainMultiplier)];
  }
  return [
    createPoint(0, gainMultiplier),
    createPoint(durationSec, gainMultiplier),
  ];
}

function createPoint(
  timeSec: number,
  gainMultiplier: number,
  id?: string,
): VolumePoint {
  return {
    id: id ?? makePointId(),
    timeSec,
    gainMultiplier,
  };
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
