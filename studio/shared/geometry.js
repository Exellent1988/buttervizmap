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

export function normalizePointsToBounds(points, bounds = getPolygonBounds(points), inset = 0) {
  const width = Math.max(bounds.maxX - bounds.minX, Number.EPSILON);
  const height = Math.max(bounds.maxY - bounds.minY, Number.EPSILON);
  const normalizedInset = Math.max(0, Math.min(0.49, inset));
  const innerWidth = 1 - normalizedInset * 2;
  const innerHeight = 1 - normalizedInset * 2;

  return points.map((point) => ({
    x: normalizedInset + ((point.x - bounds.minX) / width) * innerWidth,
    y: normalizedInset + ((point.y - bounds.minY) / height) * innerHeight,
  }));
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

export function getSignedPolygonArea(points) {
  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const nextIndex = (index + 1) % points.length;
    area +=
      points[index].x * points[nextIndex].y - points[nextIndex].x * points[index].y;
  }

  return area / 2;
}

function getTriangleCross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function orientation(a, b, c) {
  return getTriangleCross(a, b, c);
}

function onSegment(a, point, b) {
  return (
    Math.min(a.x, b.x) - 1e-9 <= point.x &&
    point.x <= Math.max(a.x, b.x) + 1e-9 &&
    Math.min(a.y, b.y) - 1e-9 <= point.y &&
    point.y <= Math.max(a.y, b.y) + 1e-9
  );
}

function segmentsIntersect(a1, a2, b1, b2) {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (Math.abs(o1) < 1e-9 && onSegment(a1, b1, a2)) {
    return true;
  }
  if (Math.abs(o2) < 1e-9 && onSegment(a1, b2, a2)) {
    return true;
  }
  if (Math.abs(o3) < 1e-9 && onSegment(b1, a1, b2)) {
    return true;
  }
  if (Math.abs(o4) < 1e-9 && onSegment(b1, a2, b2)) {
    return true;
  }

  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function pointInTriangle(point, a, b, c) {
  const denominator =
    (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);

  if (Math.abs(denominator) < 1e-9) {
    return false;
  }

  const alpha =
    ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) /
    denominator;
  const beta =
    ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) /
    denominator;
  const gamma = 1 - alpha - beta;

  return alpha >= -1e-6 && beta >= -1e-6 && gamma >= -1e-6;
}

export function triangulatePolygon(points) {
  if (!Array.isArray(points) || points.length < 3) {
    return [];
  }

  if (points.length === 3) {
    return [[0, 1, 2]];
  }

  const remaining = points.map((_, index) => index);
  const triangles = [];
  const orientation = Math.sign(getSignedPolygonArea(points)) || 1;
  let guard = 0;

  while (remaining.length > 3 && guard < points.length * points.length) {
    let clippedEar = false;

    for (let index = 0; index < remaining.length; index += 1) {
      const previousIndex = remaining[(index - 1 + remaining.length) % remaining.length];
      const currentIndex = remaining[index];
      const nextIndex = remaining[(index + 1) % remaining.length];

      const previousPoint = points[previousIndex];
      const currentPoint = points[currentIndex];
      const nextPoint = points[nextIndex];
      const cross = getTriangleCross(previousPoint, currentPoint, nextPoint);

      if (orientation * cross <= 1e-9) {
        continue;
      }

      const containsOtherPoint = remaining.some((candidateIndex) => {
        if (
          candidateIndex === previousIndex ||
          candidateIndex === currentIndex ||
          candidateIndex === nextIndex
        ) {
          return false;
        }

        return pointInTriangle(
          points[candidateIndex],
          previousPoint,
          currentPoint,
          nextPoint
        );
      });

      if (containsOtherPoint) {
        continue;
      }

      triangles.push([previousIndex, currentIndex, nextIndex]);
      remaining.splice(index, 1);
      clippedEar = true;
      break;
    }

    if (!clippedEar) {
      break;
    }

    guard += 1;
  }

  if (remaining.length === 3) {
    triangles.push([remaining[0], remaining[1], remaining[2]]);
  }

  if (!triangles.length) {
    for (let index = 1; index < points.length - 1; index += 1) {
      triangles.push([0, index, index + 1]);
    }
  }

  return triangles;
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

export function polygonsIntersect(leftPoints, rightPoints) {
  if (
    leftPoints.some((point) => pointInPolygon(point, rightPoints)) ||
    rightPoints.some((point) => pointInPolygon(point, leftPoints))
  ) {
    return true;
  }

  for (let leftIndex = 0; leftIndex < leftPoints.length; leftIndex += 1) {
    const leftNextIndex = (leftIndex + 1) % leftPoints.length;
    for (let rightIndex = 0; rightIndex < rightPoints.length; rightIndex += 1) {
      const rightNextIndex = (rightIndex + 1) % rightPoints.length;
      if (
        segmentsIntersect(
          leftPoints[leftIndex],
          leftPoints[leftNextIndex],
          rightPoints[rightIndex],
          rightPoints[rightNextIndex]
        )
      ) {
        return true;
      }
    }
  }

  return false;
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
