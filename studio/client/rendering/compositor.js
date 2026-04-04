import { buildInteractionSummary } from "../../shared/composition.js";
import {
  distanceToPolygonEdge,
  getMaxDistanceFromCentroid,
  getPolygonBounds,
  getPolygonCentroid,
  interpolateQuadPoint,
  normalizePointsToBounds,
  polygonsIntersect,
  pointInPolygon,
  triangulatePolygon,
} from "../../shared/geometry.js";
import { AdaptiveRenderer } from "./adaptiveRenderer.js";

const FULL_CANVAS_GEOMETRY = {
  kind: "quad",
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
};

function drawGeometryPath(context, geometry, width, height) {
  context.beginPath();
  geometry.points.forEach((point, index) => {
    const x = point.x * width;
    const y = point.y * height;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.closePath();
}

function fillRawGeometry(
  context,
  geometry,
  width,
  height,
  color,
  opacity,
  feather = 0,
  composite = "source-over"
) {
  const blurRadius = Math.round(Math.min(width, height) * Math.max(0, feather) * 0.18);

  if (blurRadius <= 0) {
    context.save();
    context.globalCompositeOperation = composite;
    context.globalAlpha = opacity;
    context.fillStyle = color;
    drawGeometryPath(context, geometry, width, height);
    context.fill();
    context.restore();
    return;
  }

  const maskCanvas = createSizedCanvas(width, height);
  const maskContext = maskCanvas.getContext("2d");
  maskContext.fillStyle = color;
  drawGeometryPath(maskContext, geometry, width, height);
  maskContext.fill();

  context.save();
  context.globalCompositeOperation = composite;
  context.globalAlpha = opacity;
  context.filter = `blur(${blurRadius}px)`;
  context.drawImage(maskCanvas, 0, 0, width, height);
  context.restore();
}

function fillGeometry(context, element, width, height, color, opacity, composite = "source-over") {
  fillRawGeometry(
    context,
    element.geometry,
    width,
    height,
    color,
    opacity,
    element.style?.feather ?? 0,
    composite
  );
}

function strokeRawGeometry(
  context,
  geometry,
  width,
  height,
  color,
  opacity,
  lineWidth,
  feather = 0,
  composite = "source-over"
) {
  const blurRadius = Math.round(Math.min(width, height) * Math.max(0, feather) * 0.12);
  const drawStroke = (targetContext) => {
    targetContext.lineJoin = "round";
    targetContext.lineCap = "round";
    targetContext.strokeStyle = color;
    targetContext.lineWidth = Math.max(1, lineWidth);
    drawGeometryPath(targetContext, geometry, width, height);
    targetContext.stroke();
  };

  if (blurRadius <= 0) {
    context.save();
    context.globalCompositeOperation = composite;
    context.globalAlpha = opacity;
    drawStroke(context);
    context.restore();
    return;
  }

  const strokeCanvas = createSizedCanvas(width, height);
  const strokeContext = strokeCanvas.getContext("2d");
  drawStroke(strokeContext);

  context.save();
  context.globalCompositeOperation = composite;
  context.globalAlpha = opacity;
  context.filter = `blur(${blurRadius}px)`;
  context.drawImage(strokeCanvas, 0, 0, width, height);
  context.restore();
}

function applyFinalClipFill(context, clipElements, width, height, fillColor) {
  if (!clipElements.length) {
    return;
  }

  clipElements.forEach((element) => {
    fillGeometry(context, element, width, height, fillColor, 1, "source-over");
  });
}

function createSizedCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function createMaskedCanvas(sourceCanvas, maskCanvas, width, height) {
  const maskedCanvas = createSizedCanvas(width, height);
  const maskedContext = maskedCanvas.getContext("2d");
  maskedContext.drawImage(maskCanvas, 0, 0, width, height);
  maskedContext.globalCompositeOperation = "source-in";
  maskedContext.drawImage(sourceCanvas, 0, 0, width, height);
  return maskedCanvas;
}

function mapBlendMode(mode = "normal") {
  if (mode === "screen") {
    return "screen";
  }
  if (mode === "add") {
    return "lighter";
  }
  if (mode === "multiply") {
    return "multiply";
  }
  if (mode === "overlay") {
    return "overlay";
  }
  return "source-over";
}

function normalizeToBounds(value, min, size) {
  if (size <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(1, (value - min) / size));
}

function remapInteractionSummaryToBounds(interactionSummary, bounds) {
  const width = Math.max(bounds.maxX - bounds.minX, 0.001);
  const height = Math.max(bounds.maxY - bounds.minY, 0.001);
  const scale = Math.max(width, height);

  return interactionSummary.map((field) => ({
    ...field,
    geometry: {
      ...field.geometry,
      points: field.geometry.points.map((point) => ({
        x: normalizeToBounds(point.x, bounds.minX, width),
        y: normalizeToBounds(point.y, bounds.minY, height),
      })),
    },
    centroid: {
      x: normalizeToBounds(field.centroid.x, bounds.minX, width),
      y: normalizeToBounds(field.centroid.y, bounds.minY, height),
    },
    maxDistance: field.maxDistance / scale,
    edgeDistanceAtCentroid: field.edgeDistanceAtCentroid / scale,
  }));
}

function getBoundsArea(bounds) {
  return Math.max(0.000001, (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY));
}

function getBoundsIntersectionArea(leftBounds, rightBounds) {
  const width = Math.max(
    0,
    Math.min(leftBounds.maxX, rightBounds.maxX) - Math.max(leftBounds.minX, rightBounds.minX)
  );
  const height = Math.max(
    0,
    Math.min(leftBounds.maxY, rightBounds.maxY) - Math.max(leftBounds.minY, rightBounds.minY)
  );

  return width * height;
}

function estimateFieldOverlapWeight(field, surfaceGeometry, surfaceBounds, surfaceCentroid) {
  const fieldBounds = getPolygonBounds(field.geometry.points);
  const intersectionArea = getBoundsIntersectionArea(fieldBounds, surfaceBounds);
  const fieldArea = getBoundsArea(fieldBounds);
  const surfaceArea = getBoundsArea(surfaceBounds);
  const overlapByField = intersectionArea / fieldArea;
  const overlapBySurface = intersectionArea / surfaceArea;
  const centroidInsideSurface = pointInPolygon(field.centroid, surfaceGeometry.points);
  const surfaceCentroidInsideField = pointInPolygon(surfaceCentroid, field.geometry.points);
  const edgesIntersect = polygonsIntersect(field.geometry.points, surfaceGeometry.points);

  if (
    intersectionArea <= 0 &&
    !centroidInsideSurface &&
    !surfaceCentroidInsideField &&
    !edgesIntersect
  ) {
    return 0;
  }

  return Math.min(
    1,
    Math.max(
      edgesIntersect ? 0.38 : 0,
      overlapByField,
      overlapBySurface * 0.75,
      centroidInsideSurface ? 0.7 : 0,
      surfaceCentroidInsideField ? 0.45 : 0
    )
  );
}

function buildSurfaceContourField(geometry) {
  const centroid = getPolygonCentroid(geometry.points);
  return {
    elementId: `surface:${geometry.kind}`,
    sourceRole: "surface",
    contourOnly: true,
    geometry,
    centroid,
    maxDistance: getMaxDistanceFromCentroid(geometry.points),
    edgeDistanceAtCentroid: distanceToPolygonEdge(centroid, geometry.points),
    alpha: geometry.kind === "polygon" ? 0.44 : 0.26,
    color: "#ffffff",
    distance: geometry.kind === "polygon" ? 0.28 : 0.18,
    feather: 0,
    pulse: geometry.kind === "polygon" ? 0.14 : 0.08,
    swirl: 0,
    influence: geometry.kind === "polygon" ? 0.74 : 0.46,
  };
}

export function filterInteractionSummaryForGeometry(interactionSummary, geometry) {
  const bounds = getPolygonBounds(geometry.points);
  const surfaceCentroid = getPolygonCentroid(geometry.points);
  return interactionSummary
    .map((field) => {
      const overlapWeight = estimateFieldOverlapWeight(
        field,
        geometry,
        bounds,
        surfaceCentroid
      );
      if (overlapWeight <= 0.015) {
        return null;
      }

      return {
        ...field,
        overlapWeight,
        alpha: Math.min(1, field.alpha * (0.35 + overlapWeight * 0.65)),
        influence: Math.min(1, field.influence * (0.35 + overlapWeight * 0.65)),
        pulse: field.pulse * (0.35 + overlapWeight * 0.65),
        swirl: field.swirl * overlapWeight,
      };
    })
    .filter(Boolean);
}

export function localizeInteractionSummaryToGeometry(interactionSummary, geometry) {
  const bounds = getPolygonBounds(geometry.points);
  return remapInteractionSummaryToBounds(
    filterInteractionSummaryForGeometry(interactionSummary, geometry),
    bounds
  );
}

function summarizeInteraction(interactionSummary, referenceGeometry = FULL_CANVAS_GEOMETRY) {
  if (!interactionSummary.length) {
    return {
      energy: 0,
      pulse: 0,
      swirl: 0,
      color: "rgba(255,255,255,0)",
      offsetX: 0,
      offsetY: 0,
    };
  }

  let totalWeight = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  let pulse = 0;
  let swirl = 0;
  let offsetX = 0;
  let offsetY = 0;
  const referenceCentroid = getPolygonCentroid(referenceGeometry.points);
  const referenceBounds = getPolygonBounds(referenceGeometry.points);
  const referenceWidth = Math.max(referenceBounds.maxX - referenceBounds.minX, 0.001);
  const referenceHeight = Math.max(referenceBounds.maxY - referenceBounds.minY, 0.001);

  interactionSummary.forEach((field) => {
    const weight = Math.max(0.001, field.alpha * (0.5 + field.influence));
    totalWeight += weight;
    pulse += field.pulse * weight;
    swirl += field.swirl * weight;
    offsetX += ((field.centroid.x - referenceCentroid.x) / referenceWidth) * weight;
    offsetY += ((field.centroid.y - referenceCentroid.y) / referenceHeight) * weight;

    const normalized = field.color.replace("#", "");
    const sixChar = normalized.length === 3
      ? normalized
          .split("")
          .map((value) => `${value}${value}`)
          .join("")
      : normalized.padEnd(6, "0").slice(0, 6);
    red += parseInt(sixChar.slice(0, 2), 16) * weight;
    green += parseInt(sixChar.slice(2, 4), 16) * weight;
    blue += parseInt(sixChar.slice(4, 6), 16) * weight;
  });

  return {
    energy: Math.min(1, totalWeight / Math.max(1, interactionSummary.length)),
    pulse: pulse / totalWeight,
    swirl: swirl / totalWeight,
    offsetX: Math.max(-1, Math.min(1, offsetX / totalWeight)),
    offsetY: Math.max(-1, Math.min(1, offsetY / totalWeight)),
    color: `rgb(${Math.round(red / totalWeight)}, ${Math.round(green / totalWeight)}, ${Math.round(
      blue / totalWeight
    )})`,
  };
}

function buildInteractionReactionMasks({
  interactionSources,
  surfaceGeometry,
  width,
  height,
  includeSurfaceContour = true,
}) {
  const fillMask = createSizedCanvas(width, height);
  const fillColor = createSizedCanvas(width, height);
  const contourMask = createSizedCanvas(width, height);
  const contourColor = createSizedCanvas(width, height);
  const fillMaskContext = fillMask.getContext("2d");
  const fillColorContext = fillColor.getContext("2d");
  const contourMaskContext = contourMask.getContext("2d");
  const contourColorContext = contourColor.getContext("2d");
  const effectSources = includeSurfaceContour
    ? [...interactionSources, buildSurfaceContourField(surfaceGeometry)]
    : interactionSources;

  effectSources.forEach((field) => {
    const overlapWeight = field.overlapWeight ?? 1;
    const roleBoost =
      field.sourceRole === "clip" ? 1.22 : field.sourceRole === "surface" ? 1.08 : 0.92;
    const fillOpacity = field.contourOnly
      ? 0
      : Math.min(
          0.92,
          field.alpha * overlapWeight * (0.16 + field.influence * 0.26) * roleBoost
        );
    const contourOpacity = Math.min(
      0.96,
      field.alpha * overlapWeight * (0.24 + field.influence * 0.36) * roleBoost
    );
    const contourWidth =
      Math.max(2, Math.min(width, height) * (0.004 + field.distance * 0.014 + field.feather * 0.01)) *
      roleBoost;

    if (fillOpacity > 0.001) {
      fillRawGeometry(
        fillMaskContext,
        field.geometry,
        width,
        height,
        "#ffffff",
        fillOpacity,
        field.feather
      );
      fillRawGeometry(
        fillColorContext,
        field.geometry,
        width,
        height,
        field.color,
        fillOpacity,
        field.feather
      );
    }

    strokeRawGeometry(
      contourMaskContext,
      field.geometry,
      width,
      height,
      "#ffffff",
      contourOpacity,
      contourWidth,
      field.feather
    );
    strokeRawGeometry(
      contourColorContext,
      field.geometry,
      width,
      height,
      field.sourceRole === "surface" ? "#ffffff" : field.color,
      contourOpacity,
      Math.max(1.5, contourWidth * 0.68),
      field.feather * 0.7
    );
  });

  return {
    fillMask,
    fillColor,
    contourMask,
    contourColor,
  };
}

function applySurfaceInteractionEffect({
  context,
  surfaceGeometry,
  interactionSources,
  interactionState,
  binding,
  width,
  height,
  includeSurfaceContour = true,
}) {
  if ((binding.interactionMix ?? 0) <= 0.001 || !interactionSources.length) {
    return;
  }

  const reactionMode = binding.reactionMode ?? "tint";
  const reactionMix = (binding.interactionMix ?? 0) * Math.max(0.25, interactionState.energy || 0);
  const snapshot = createSizedCanvas(width, height);
  snapshot.getContext("2d").drawImage(context.canvas, 0, 0, width, height);
  const masks = buildInteractionReactionMasks({
    interactionSources,
    surfaceGeometry,
    width,
    height,
    includeSurfaceContour,
  });
  const fillTexture = createMaskedCanvas(snapshot, masks.fillMask, width, height);
  const contourTexture = createMaskedCanvas(snapshot, masks.contourMask, width, height);
  const surfaceCentroid = getPolygonCentroid(surfaceGeometry.points);
  const centroidX = surfaceCentroid.x * width;
  const centroidY = surfaceCentroid.y * height;
  const shiftX = interactionState.offsetX * width * (0.04 + reactionMix * 0.1);
  const shiftY = interactionState.offsetY * height * (0.04 + reactionMix * 0.1);
  const tangentX = -interactionState.offsetY * width * (0.03 + interactionState.swirl * 0.06);
  const tangentY = interactionState.offsetX * height * (0.03 + interactionState.swirl * 0.06);

  context.save();
  drawGeometryPath(context, surfaceGeometry, width, height);
  context.clip();

  if (reactionMode === "glow") {
    context.globalCompositeOperation = "screen";
    context.globalAlpha = 0.16 + reactionMix * 0.22;
    context.drawImage(masks.contourColor, 0, 0, width, height);
    context.globalCompositeOperation = "lighter";
    context.globalAlpha = 0.1 + reactionMix * 0.18;
    context.drawImage(contourTexture, 0, 0, width, height);
    context.globalAlpha = 0.08 + reactionMix * 0.14;
    context.drawImage(contourTexture, shiftX, shiftY, width, height);
    context.globalAlpha = 0.06 + reactionMix * 0.12;
    context.drawImage(contourTexture, -shiftX, -shiftY, width, height);
    context.globalCompositeOperation = "soft-light";
    context.globalAlpha = 0.08 + reactionMix * 0.12;
    context.drawImage(masks.fillColor, 0, 0, width, height);
  } else if (reactionMode === "warp") {
    context.globalCompositeOperation = "screen";
    context.globalAlpha = 0.09 + reactionMix * 0.14;
    context.drawImage(fillTexture, shiftX, shiftY, width, height);
    context.globalCompositeOperation = "overlay";
    context.globalAlpha = 0.08 + reactionMix * 0.12;
    context.drawImage(fillTexture, -shiftX * 0.55 + tangentX, -shiftY * 0.55 + tangentY, width, height);
    context.globalCompositeOperation = "lighter";
    context.globalAlpha = 0.08 + reactionMix * 0.14;
    context.drawImage(contourTexture, tangentX, tangentY, width, height);
    context.globalCompositeOperation = "screen";
    context.globalAlpha = 0.07 + reactionMix * 0.1;
    context.drawImage(masks.contourColor, 0, 0, width, height);
  } else if (reactionMode === "pulse") {
    const growth = 1 + reactionMix * (0.06 + interactionState.pulse * 0.08);
    context.save();
    context.translate(centroidX, centroidY);
    context.scale(growth, growth);
    context.translate(-centroidX, -centroidY);
    context.globalCompositeOperation = "lighter";
    context.globalAlpha = 0.1 + reactionMix * 0.18;
    context.drawImage(fillTexture, 0, 0, width, height);
    context.restore();
    context.globalCompositeOperation = "screen";
    context.globalAlpha = 0.09 + reactionMix * 0.12;
    context.drawImage(contourTexture, 0, 0, width, height);
    context.globalCompositeOperation = "soft-light";
    context.globalAlpha = 0.08 + reactionMix * 0.12;
    context.drawImage(masks.fillColor, 0, 0, width, height);
  } else if (reactionMode === "reflect") {
    context.save();
    context.translate(centroidX, centroidY);
    context.scale(-1, 1);
    context.translate(-centroidX, -centroidY);
    context.globalCompositeOperation = "screen";
    context.globalAlpha = 0.08 + reactionMix * 0.14;
    context.drawImage(fillTexture, 0, 0, width, height);
    context.restore();
    context.globalCompositeOperation = "lighter";
    context.globalAlpha = 0.08 + reactionMix * 0.14;
    context.drawImage(contourTexture, -shiftX * 0.4, -shiftY * 0.4, width, height);
    context.globalCompositeOperation = "screen";
    context.globalAlpha = 0.06 + reactionMix * 0.1;
    context.drawImage(masks.contourColor, 0, 0, width, height);
  } else {
    context.globalCompositeOperation = "soft-light";
    context.globalAlpha = 0.12 + reactionMix * 0.2;
    context.drawImage(masks.fillColor, 0, 0, width, height);
    context.globalCompositeOperation = "screen";
    context.globalAlpha = 0.08 + reactionMix * 0.12;
    context.drawImage(contourTexture, 0, 0, width, height);
    context.globalAlpha = 0.06 + reactionMix * 0.08;
    context.drawImage(masks.contourColor, 0, 0, width, height);
  }

  context.restore();
}

function drawTexturedTriangle(
  context,
  image,
  sx0,
  sy0,
  sx1,
  sy1,
  sx2,
  sy2,
  dx0,
  dy0,
  dx1,
  dy1,
  dx2,
  dy2
) {
  const determinant = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
  if (Math.abs(determinant) < 1e-6) {
    return;
  }

  const a =
    (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) / determinant;
  const b =
    (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) / determinant;
  const c =
    (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) / determinant;
  const d =
    (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) / determinant;
  const e =
    (dx0 * (sx1 * sy2 - sx2 * sy1) +
      dx1 * (sx2 * sy0 - sx0 * sy2) +
      dx2 * (sx0 * sy1 - sx1 * sy0)) /
    determinant;
  const f =
    (dy0 * (sx1 * sy2 - sx2 * sy1) +
      dy1 * (sx2 * sy0 - sx0 * sy2) +
      dy2 * (sx0 * sy1 - sx1 * sy0)) /
    determinant;

  context.save();
  context.beginPath();
  context.moveTo(dx0, dy0);
  context.lineTo(dx1, dy1);
  context.lineTo(dx2, dy2);
  context.closePath();
  context.clip();
  context.transform(a, b, c, d, e, f);
  context.drawImage(image, 0, 0);
  context.restore();
}

function drawWarpedQuad(context, sourceCanvas, geometry, binding, outputWidth, outputHeight) {
  const subdivisions = 14;
  const pixelPoints = geometry.points.map((point) => ({
    x: point.x * outputWidth,
    y: point.y * outputHeight,
  }));

  for (let yIndex = 0; yIndex < subdivisions; yIndex += 1) {
    const v0 = yIndex / subdivisions;
    const v1 = (yIndex + 1) / subdivisions;

    for (let xIndex = 0; xIndex < subdivisions; xIndex += 1) {
      const u0 = xIndex / subdivisions;
      const u1 = (xIndex + 1) / subdivisions;

      const topLeft = interpolateQuadPoint(pixelPoints, u0, v0);
      const topRight = interpolateQuadPoint(pixelPoints, u1, v0);
      const bottomRight = interpolateQuadPoint(pixelPoints, u1, v1);
      const bottomLeft = interpolateQuadPoint(pixelPoints, u0, v1);
      const sourceTopLeft = transformSourceSamplePoint(
        sourceCanvas.width * u0,
        sourceCanvas.height * v0,
        sourceCanvas.width,
        sourceCanvas.height,
        binding
      );
      const sourceTopRight = transformSourceSamplePoint(
        sourceCanvas.width * u1,
        sourceCanvas.height * v0,
        sourceCanvas.width,
        sourceCanvas.height,
        binding
      );
      const sourceBottomRight = transformSourceSamplePoint(
        sourceCanvas.width * u1,
        sourceCanvas.height * v1,
        sourceCanvas.width,
        sourceCanvas.height,
        binding
      );
      const sourceBottomLeft = transformSourceSamplePoint(
        sourceCanvas.width * u0,
        sourceCanvas.height * v1,
        sourceCanvas.width,
        sourceCanvas.height,
        binding
      );

      drawTexturedTriangle(
        context,
        sourceCanvas,
        sourceTopLeft.x,
        sourceTopLeft.y,
        sourceTopRight.x,
        sourceTopRight.y,
        sourceBottomRight.x,
        sourceBottomRight.y,
        topLeft.x,
        topLeft.y,
        topRight.x,
        topRight.y,
        bottomRight.x,
        bottomRight.y
      );
      drawTexturedTriangle(
        context,
        sourceCanvas,
        sourceTopLeft.x,
        sourceTopLeft.y,
        sourceBottomRight.x,
        sourceBottomRight.y,
        sourceBottomLeft.x,
        sourceBottomLeft.y,
        topLeft.x,
        topLeft.y,
        bottomRight.x,
        bottomRight.y,
        bottomLeft.x,
        bottomLeft.y
      );
    }
  }
}

function transformSourceSamplePoint(
  sourceX,
  sourceY,
  sourceWidth,
  sourceHeight,
  binding
) {
  const sourceCenter = {
    x: sourceWidth / 2,
    y: sourceHeight / 2,
  };
  const scale = binding.scale ?? 1;
  const driftX = (binding.offsetX ?? 0) * sourceWidth * 0.5;
  const driftY = (binding.offsetY ?? 0) * sourceHeight * 0.5;
  const rotation = ((binding.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const localX = (sourceX - sourceCenter.x) * scale;
  const localY = (sourceY - sourceCenter.y) * scale;

  return {
    x: sourceCenter.x + driftX + localX * cos - localY * sin,
    y: sourceCenter.y + driftY + localX * sin + localY * cos,
  };
}

function drawWarpedPolygon(
  context,
  sourceCanvas,
  geometry,
  binding,
  outputWidth,
  outputHeight
) {
  const normalizedSourcePoints = normalizePointsToBounds(geometry.points, getPolygonBounds(geometry.points));
  const transformedSourcePoints = normalizedSourcePoints.map((point) =>
    transformSourceSamplePoint(
      point.x * sourceCanvas.width,
      point.y * sourceCanvas.height,
      sourceCanvas.width,
      sourceCanvas.height,
      binding
    )
  );
  const destinationPoints = geometry.points.map((point) => ({
    x: point.x * outputWidth,
    y: point.y * outputHeight,
  }));
  const triangles = triangulatePolygon(geometry.points);

  triangles.forEach(([firstIndex, secondIndex, thirdIndex]) => {
    const firstSource = transformedSourcePoints[firstIndex];
    const secondSource = transformedSourcePoints[secondIndex];
    const thirdSource = transformedSourcePoints[thirdIndex];
    const firstDestination = destinationPoints[firstIndex];
    const secondDestination = destinationPoints[secondIndex];
    const thirdDestination = destinationPoints[thirdIndex];

    drawTexturedTriangle(
      context,
      sourceCanvas,
      firstSource.x,
      firstSource.y,
      secondSource.x,
      secondSource.y,
      thirdSource.x,
      thirdSource.y,
      firstDestination.x,
      firstDestination.y,
      secondDestination.x,
      secondDestination.y,
      thirdDestination.x,
      thirdDestination.y
    );
  });
}

function drawCanvasWithBinding({
  context,
  sourceCanvas,
  drawX,
  drawY,
  drawWidth,
  drawHeight,
  binding,
  applySpatialBinding = true,
}) {
  const baseScale = binding.scale ?? 1;
  const driftX = (binding.offsetX ?? 0) * drawWidth * 0.5;
  const driftY = (binding.offsetY ?? 0) * drawHeight * 0.5;
  const rotation = ((binding.rotation ?? 0) * Math.PI) / 180;

  context.save();
  context.globalCompositeOperation = mapBlendMode(binding.blendMode);
  context.globalAlpha = binding.opacity;
  context.translate(
    drawX + drawWidth / 2 + (applySpatialBinding ? driftX : 0),
    drawY + drawHeight / 2 + (applySpatialBinding ? driftY : 0)
  );
  if (applySpatialBinding) {
    context.rotate(rotation);
    context.scale(baseScale, baseScale);
  }
  context.drawImage(sourceCanvas, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.restore();
}

export class StudioCompositor {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.project = null;
    this.audioFrame = null;
    this.globalRenderer = null;
    this.elementRenderers = new Map();
    this.loadedPresetIds = {
      global: null,
      elements: new Map(),
    };
  }

  async setProject(project) {
    this.project = project;
    await this.ensureRendererGraph();
  }

  setAudioFrame(audioFrame) {
    this.audioFrame = audioFrame;
  }

  async ensureRendererGraph() {
    if (!this.project) {
      return;
    }

    const { width, height } = this.project.output;
    const renderConfig = {
      canvasScale: this.project.output.rendering.canvasScale,
      meshWidth: this.project.output.rendering.meshWidth,
      meshHeight: this.project.output.rendering.meshHeight,
    };
    if (!this.globalRenderer) {
      this.globalRenderer = new AdaptiveRenderer(width, height);
    }
    await this.globalRenderer.setRenderConfig(renderConfig);
    await this.globalRenderer.resize(width, height);

    const globalPreset = this.project.presetLibrary.presets.find(
      (preset) => preset.id === this.project.globalLayer.presetId
    );
    if (globalPreset && this.loadedPresetIds.global !== globalPreset.id) {
      const didLoad = await this.globalRenderer.loadPreset(
        globalPreset,
        this.loadedPresetIds.global == null
          ? 0
          : this.project.output.presets.lastChangeMode === "auto"
            ? this.project.output.presets.autoBlendSeconds
            : this.project.output.presets.userBlendSeconds
      );
      if (didLoad) {
        this.loadedPresetIds.global = globalPreset.id;
      }
    }

    const activeShaderElements = this.project.elements.filter(
      (element) => element.enabled && element.roles.shaderSurface && element.shaderBinding.enabled
    );

    for (const element of activeShaderElements) {
      if (!this.elementRenderers.has(element.id)) {
        this.elementRenderers.set(element.id, new AdaptiveRenderer(width, height));
      }
      const renderer = this.elementRenderers.get(element.id);
      await renderer.setRenderConfig(renderConfig);
      const preset = this.project.presetLibrary.presets.find(
        (entry) => entry.id === element.shaderBinding.presetId
      );
      if (preset && this.loadedPresetIds.elements.get(element.id) !== preset.id) {
        const didLoad = await renderer.loadPreset(
          preset,
          this.loadedPresetIds.elements.has(element.id)
            ? this.project.output.presets.userBlendSeconds
            : 0
        );
        if (didLoad) {
          this.loadedPresetIds.elements.set(element.id, preset.id);
        }
      }
    }

    [...this.loadedPresetIds.elements.keys()].forEach((elementId) => {
      if (!activeShaderElements.find((element) => element.id === elementId)) {
        this.loadedPresetIds.elements.delete(elementId);
      }
    });
  }

  getDebugState() {
    const presetCatalog = this.project?.presetLibrary?.presets ?? [];
    return {
      globalRenderer: this.globalRenderer?.getDebugState?.() ?? null,
      elementRenderers: [...this.elementRenderers.entries()].map(([elementId, renderer]) => ({
        elementId,
        ...renderer.getDebugState(),
      })),
      loadedPresetIds: {
        global: this.loadedPresetIds.global,
        elements: Object.fromEntries(this.loadedPresetIds.elements.entries()),
      },
      presetCatalogSummary: {
        total: presetCatalog.length,
        solid: presetCatalog.filter((preset) => preset.sourceType === "solid").length,
        builtin: presetCatalog.filter((preset) => preset.sourceType === "builtin").length,
        file: presetCatalog.filter((preset) => preset.sourceType === "file").length,
      },
    };
  }

  ensureCanvasSize() {
    const width = this.project.output.width;
    const height = this.project.output.height;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  async render(timestamp) {
    if (!this.project) {
      return;
    }

    await this.ensureRendererGraph();
    this.ensureCanvasSize();

    const width = this.project.output.width;
    const height = this.project.output.height;
    const interactionSummary = buildInteractionSummary(this.project).map((field) => {
      const centroid = getPolygonCentroid(field.geometry.points);
      return {
        ...field,
        centroid,
        maxDistance: getMaxDistanceFromCentroid(field.geometry.points),
        edgeDistanceAtCentroid: distanceToPolygonEdge(centroid, field.geometry.points),
      };
    });

    this.context.clearRect(0, 0, width, height);
    this.context.fillStyle = this.project.output.background;
    this.context.fillRect(0, 0, width, height);

    if (this.project.globalLayer.enabled && this.globalRenderer) {
      const globalInteractionSources = filterInteractionSummaryForGeometry(
        interactionSummary,
        FULL_CANVAS_GEOMETRY
      );
      const globalInteraction = summarizeInteraction(
        globalInteractionSources,
        FULL_CANVAS_GEOMETRY
      );
      await this.globalRenderer.render({
        timestamp,
        audioFrame: this.audioFrame,
        interactionSummary,
      });
      this.context.save();
      drawCanvasWithBinding({
        context: this.context,
        sourceCanvas: this.globalRenderer.getCanvas(),
        drawX: 0,
        drawY: 0,
        drawWidth: width,
        drawHeight: height,
        binding: {
          opacity: this.project.globalLayer.opacity,
          blendMode: "normal",
          scale: this.project.globalLayer.scale,
          offsetX: globalInteraction.offsetX * this.project.globalLayer.drift,
          offsetY: globalInteraction.offsetY * this.project.globalLayer.drift,
          rotation: globalInteraction.swirl * this.project.globalLayer.drift * 14,
        },
      });
      this.context.restore();
      applySurfaceInteractionEffect({
        context: this.context,
        surfaceGeometry: FULL_CANVAS_GEOMETRY,
        interactionSources: globalInteractionSources,
        interactionState: globalInteraction,
        binding: {
          interactionMix: this.project.globalLayer.interactionMix,
          reactionMode: "glow",
        },
        width,
        height,
        includeSurfaceContour: false,
      });
    }

    const orderedElements = [...this.project.elements]
      .filter((element) => element.enabled)
      .sort((left, right) => left.zIndex - right.zIndex);
    const clipElements = orderedElements.filter((element) => element.roles.clip);

    for (const element of orderedElements) {
      if (element.roles.paint) {
        fillGeometry(
          this.context,
          element,
          width,
          height,
          element.style.color,
          element.style.opacity
        );
      }

      if (element.roles.shaderSurface && element.shaderBinding.enabled) {
        const renderer = this.elementRenderers.get(element.id);
        if (renderer) {
          const bounds = getPolygonBounds(element.geometry.points);
          const drawWidth = Math.max(1, Math.round((bounds.maxX - bounds.minX) * width));
          const drawHeight = Math.max(1, Math.round((bounds.maxY - bounds.minY) * height));
          await renderer.resize(drawWidth, drawHeight);
          const surfaceInteractionSources = filterInteractionSummaryForGeometry(
            interactionSummary,
            element.geometry
          );
          const localInteractionSummary = localizeInteractionSummaryToGeometry(
            interactionSummary,
            element.geometry
          );
          await renderer.render({
            timestamp,
            audioFrame: this.audioFrame,
            interactionSummary: localInteractionSummary,
          });
          const localInteraction = summarizeInteraction(
            surfaceInteractionSources,
            element.geometry
          );
          this.context.save();
          this.context.globalCompositeOperation = mapBlendMode(element.shaderBinding.blendMode);
          this.context.globalAlpha = element.shaderBinding.opacity;
          if (element.geometry.kind === "quad") {
            drawWarpedQuad(
              this.context,
              renderer.getCanvas(),
              element.geometry,
              element.shaderBinding,
              width,
              height
            );
          } else {
            drawWarpedPolygon(
              this.context,
              renderer.getCanvas(),
              element.geometry,
              element.shaderBinding,
              width,
              height
            );
          }
          this.context.restore();
          applySurfaceInteractionEffect({
            context: this.context,
            surfaceGeometry: element.geometry,
            interactionSources: surfaceInteractionSources,
            binding: element.shaderBinding,
            interactionState: localInteraction,
            width,
            height,
          });
        }
      }

      if (element.roles.clip) {
        fillGeometry(
          this.context,
          element,
          width,
          height,
          "#000000",
          1,
          "destination-out"
        );
      }
    }
    applyFinalClipFill(
      this.context,
      clipElements,
      width,
      height,
      this.project.output.background ?? "#000000"
    );
  }
}
