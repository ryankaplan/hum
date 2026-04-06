export type VolumePoint = {
  id: string;
  timeSec: number;
  gainMultiplier: number;
};

export type ClipVolumeEnvelope = {
  points: VolumePoint[];
};

export type ApplyClipVolumeBrushInput = {
  envelope: ClipVolumeEnvelope;
  durationSec: number;
  centerSec: number;
  deltaGainMultiplier: number;
  radiusSec: number;
};

const EPSILON = 1e-6;
const VOLUME_GAIN_MIN = 0;
const VOLUME_GAIN_MAX = 2;
const DEFAULT_GAIN_MULTIPLIER = 1;
const SAMPLE_STEP_SEC = 0.08;
const SIMPLIFY_TOLERANCE = 0.008;
const MAX_SIMPLIFIED_GAP_SEC = 0.32;

let pointIdCounter = 0;

export function createDefaultClipVolumeEnvelope(
  durationSec: number,
): ClipVolumeEnvelope {
  const duration = sanitizeDuration(durationSec);
  return {
    points: makeBoundaryPoints(duration, DEFAULT_GAIN_MULTIPLIER),
  };
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

export function applyClipVolumeBrush(
  input: ApplyClipVolumeBrushInput,
): ClipVolumeEnvelope {
  const duration = sanitizeDuration(input.durationSec);
  const radius = Math.max(0, input.radiusSec);
  if (
    duration <= 0 ||
    radius <= EPSILON ||
    Math.abs(input.deltaGainMultiplier) <= EPSILON
  ) {
    return normalizeEnvelope(input.envelope, duration);
  }

  const envelope = normalizeEnvelope(input.envelope, duration);
  const center = clamp(input.centerSec, 0, duration);
  const start = Math.max(0, center - radius);
  const end = Math.min(duration, center + radius);

  const sampleTimes = buildSampleTimes({
    durationSec: duration,
    startSec: start,
    centerSec: center,
    endSec: end,
    points: envelope.points,
  });

  const points = sampleTimes.map((timeSec) => {
    const base = evaluateClipVolumeAtTime(envelope, timeSec, duration);
    const distanceFromCenter = Math.abs(timeSec - center);
    const weight =
      distanceFromCenter >= radius
        ? 0
        : 0.5 * (Math.cos((distanceFromCenter / radius) * Math.PI) + 1);
    return createPoint(
      timeSec,
      clamp(
        base + input.deltaGainMultiplier * weight,
        VOLUME_GAIN_MIN,
        VOLUME_GAIN_MAX,
      ),
    );
  });

  return {
    points: simplifyPoints(points, duration),
  };
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
    right: sliceEnvelopeRange(normalized, split, Math.max(0, duration - split), duration),
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
        createPoint(0, evaluateClipVolumeAtTime(envelope, start, sourceDurationSec)),
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

  return {
    points: simplifyPoints(points, duration),
  };
}

function buildSampleTimes(input: {
  durationSec: number;
  startSec: number;
  centerSec: number;
  endSec: number;
  points: VolumePoint[];
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

  const deduped: number[] = [];
  const sorted = times
    .map((timeSec) => clamp(timeSec, 0, input.durationSec))
    .sort((a, b) => a - b);

  for (const timeSec of sorted) {
    const last = deduped[deduped.length - 1];
    if (last == null || Math.abs(last - timeSec) > EPSILON) {
      deduped.push(timeSec);
    }
  }

  return deduped;
}

function normalizeEnvelope(
  envelope: ClipVolumeEnvelope | undefined,
  durationSec: number,
): ClipVolumeEnvelope {
  const duration = sanitizeDuration(durationSec);
  const normalizedPoints = normalizePoints(envelope?.points ?? [], duration);
  const withBoundaries = ensureBoundaryPoints(normalizedPoints, duration);
  return {
    points: simplifyPoints(withBoundaries, duration),
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
    return [createPoint(0, points[0]?.gainMultiplier ?? DEFAULT_GAIN_MULTIPLIER)];
  }

  const interior = points.filter(
    (point) => point.timeSec > EPSILON && point.timeSec < durationSec - EPSILON,
  );
  const startGainMultiplier = evaluatePointsWithFallback(points, 0, durationSec);
  const endGainMultiplier = evaluatePointsWithFallback(
    points,
    durationSec,
    durationSec,
  );

  return normalizePoints(
    [
      createPoint(0, startGainMultiplier),
      ...interior,
      createPoint(durationSec, endGainMultiplier),
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

function simplifyPoints(
  points: VolumePoint[],
  durationSec: number,
): VolumePoint[] {
  if (points.length <= 2) {
    return normalizePoints(points, durationSec);
  }

  const normalized = normalizePoints(points, durationSec);
  const kept: VolumePoint[] = [];

  for (let i = 0; i < normalized.length; i++) {
    const point = normalized[i];
    if (point == null) continue;

    if (i === 0 || i === normalized.length - 1) {
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
    const linear =
      prev.gainMultiplier +
      (next.gainMultiplier - prev.gainMultiplier) * ratio;
    const linearError = Math.abs(point.gainMultiplier - linear);
    const gapFromPrev = point.timeSec - prev.timeSec;

    if (
      linearError > SIMPLIFY_TOLERANCE ||
      gapFromPrev > MAX_SIMPLIFIED_GAP_SEC
    ) {
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
    return [createPoint(0, kept[0]?.gainMultiplier ?? DEFAULT_GAIN_MULTIPLIER)];
  }

  const start = kept[0];
  const end = kept[kept.length - 1];
  if (start == null || end == null) {
    return makeBoundaryPoints(durationSec, DEFAULT_GAIN_MULTIPLIER);
  }

  if (
    kept.length === 2 &&
    Math.abs(start.gainMultiplier - DEFAULT_GAIN_MULTIPLIER) <=
      SIMPLIFY_TOLERANCE &&
    Math.abs(end.gainMultiplier - DEFAULT_GAIN_MULTIPLIER) <=
      SIMPLIFY_TOLERANCE
  ) {
    return makeBoundaryPoints(durationSec, DEFAULT_GAIN_MULTIPLIER);
  }

  return kept;
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
