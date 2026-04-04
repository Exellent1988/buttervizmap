const DEFAULT_QUAD_POINTS = [
  { x: 0.15, y: 0.15 },
  { x: 0.85, y: 0.15 },
  { x: 0.85, y: 0.85 },
  { x: 0.15, y: 0.85 },
];

export function clampUnit(value) {
  return Math.max(0, Math.min(1, value));
}

export function normalizePoint(point = {}) {
  return {
    x: clampUnit(Number(point.x ?? 0)),
    y: clampUnit(Number(point.y ?? 0)),
  };
}

export function normalizeGeometry(geometry = {}) {
  const kind = geometry.kind === "polygon" ? "polygon" : "quad";
  let points = Array.isArray(geometry.points)
    ? geometry.points.map(normalizePoint)
    : [];

  if (kind === "quad") {
    if (points.length !== 4) {
      points = DEFAULT_QUAD_POINTS.map((point) => ({ ...point }));
    }
  } else if (points.length < 3) {
    points = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.25 },
      { x: 0.55, y: 0.8 },
    ];
  }

  return { kind, points };
}

export function getPolygonBounds(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

export function getPolygonCentroid(points) {
  const total = points.reduce(
    (accumulator, point) => ({
      x: accumulator.x + point.x,
      y: accumulator.y + point.y,
    }),
    { x: 0, y: 0 }
  );

  return {
    x: total.x / points.length,
    y: total.y / points.length,
  };
}

export function pointInPolygon(point, points) {
  let inside = false;

  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;

    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + Number.EPSILON) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

export function distanceToSegment(point, segmentStart, segmentEnd) {
  const dx = segmentEnd.x - segmentStart.x;
  const dy = segmentEnd.y - segmentStart.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - segmentStart.x, point.y - segmentStart.y);
  }

  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.x - segmentStart.x) * dx + (point.y - segmentStart.y) * dy) /
        lengthSquared
    )
  );

  const px = segmentStart.x + projection * dx;
  const py = segmentStart.y + projection * dy;
  return Math.hypot(point.x - px, point.y - py);
}

export function distanceToPolygonEdge(point, points) {
  let minDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < points.length; index += 1) {
    const nextIndex = (index + 1) % points.length;
    minDistance = Math.min(
      minDistance,
      distanceToSegment(point, points[index], points[nextIndex])
    );
  }

  return minDistance;
}

export function getMaxDistanceFromCentroid(points) {
  const centroid = getPolygonCentroid(points);
  return Math.max(
    ...points.map((point) => Math.hypot(point.x - centroid.x, point.y - centroid.y))
  );
}

export function interpolateQuadPoint(points, u, v) {
  const [topLeft, topRight, bottomRight, bottomLeft] = points;
  const top = {
    x: topLeft.x + (topRight.x - topLeft.x) * u,
    y: topLeft.y + (topRight.y - topLeft.y) * u,
  };
  const bottom = {
    x: bottomLeft.x + (bottomRight.x - bottomLeft.x) * u,
    y: bottomLeft.y + (bottomRight.y - bottomLeft.y) * u,
  };

  return {
    x: top.x + (bottom.x - top.x) * v,
    y: top.y + (bottom.y - top.y) * v,
  };
}
