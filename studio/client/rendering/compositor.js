import { getElementCutterType } from "../../shared/composition.js";
import {
  getPolygonBounds,
  intersectPolygonLoops,
  interpolateQuadPoint,
  mapPolygonPointsToUnitSquareBoundary,
  pointInPolygon,
  polygonsIntersect,
  subtractPolygonLoops,
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

const NEUTRAL_BINDING = {
  opacity: 1,
  blendMode: "normal",
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
};
const OUTPUT_BACKGROUND = "#000000";

function createSizedCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
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

function appendPolygonSubPath(context, points, width, height) {
  points.forEach((point, index) => {
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

function appendLoopsPath(context, loops, width, height) {
  context.beginPath();
  loops.forEach((loop) => {
    appendPolygonSubPath(context, loop, width, height);
  });
}

function fillRawGeometry(
  context,
  geometry,
  width,
  height,
  color,
  opacity,
  composite = "source-over"
) {
  context.save();
  context.globalCompositeOperation = composite;
  context.globalAlpha = opacity;
  context.fillStyle = color;
  drawGeometryPath(context, geometry, width, height);
  context.fill();
  context.restore();
}

function eraseGeometry(context, geometry, width, height) {
  fillRawGeometry(context, geometry, width, height, "#000000", 1, "destination-out");
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

function transformSourceSamplePoint(sourceX, sourceY, sourceWidth, sourceHeight, binding) {
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

function drawWarpedPolygon(context, sourceCanvas, geometry, binding, outputWidth, outputHeight) {
  const normalizedSourcePoints = mapPolygonPointsToUnitSquareBoundary(geometry.points);
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

function drawSurfaceCanvas(context, sourceCanvas, geometry, binding, outputWidth, outputHeight) {
  if (geometry.kind === "quad") {
    drawWarpedQuad(context, sourceCanvas, geometry, binding, outputWidth, outputHeight);
    return;
  }

  drawWarpedPolygon(context, sourceCanvas, geometry, binding, outputWidth, outputHeight);
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

function pointInTriangle2D(point, triangle) {
  const [a, b, c] = triangle;
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);

  if (Math.abs(denominator) < 1e-9) {
    return false;
  }

  const alpha =
    ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / denominator;
  const beta =
    ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / denominator;
  const gamma = 1 - alpha - beta;

  return alpha >= -1e-6 && beta >= -1e-6 && gamma >= -1e-6;
}

function getBarycentricCoordinates(point, triangle) {
  const [a, b, c] = triangle;
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);

  if (Math.abs(denominator) < 1e-9) {
    return null;
  }

  const alpha =
    ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / denominator;
  const beta =
    ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / denominator;
  const gamma = 1 - alpha - beta;

  return { alpha, beta, gamma };
}

function applyBarycentricCoordinates(barycentric, triangle) {
  const [a, b, c] = triangle;

  return {
    x: a.x * barycentric.alpha + b.x * barycentric.beta + c.x * barycentric.gamma,
    y: a.y * barycentric.alpha + b.y * barycentric.beta + c.y * barycentric.gamma,
  };
}

export function getSurfaceDomainGeometry(geometry) {
  if (geometry.kind === "quad") {
    return FULL_CANVAS_GEOMETRY;
  }

  return {
    kind: "polygon",
    points: mapPolygonPointsToUnitSquareBoundary(geometry.points),
  };
}

function buildSurfaceDomainMapping(geometry) {
  const domainGeometry = getSurfaceDomainGeometry(geometry);
  const triangles = triangulatePolygon(geometry.points).map((indices) => ({
    source: indices.map((index) => domainGeometry.points[index]),
    destination: indices.map((index) => geometry.points[index]),
  }));

  return {
    domainGeometry,
    triangles,
  };
}

export function mapDomainPointToSurfacePoint(mapping, domainPoint) {
  for (const triangle of mapping.triangles) {
    if (!pointInTriangle2D(domainPoint, triangle.source)) {
      continue;
    }

    const barycentric = getBarycentricCoordinates(domainPoint, triangle.source);
    if (!barycentric) {
      continue;
    }

    return applyBarycentricCoordinates(barycentric, triangle.destination);
  }

  return null;
}

function createCutterDescriptor(element, orderIndex) {
  const cutterType = getElementCutterType(element);
  if (!cutterType) {
    return null;
  }

  return {
    elementId: element.id,
    orderIndex,
    cutterType,
    geometry: element.geometry,
    shaderBinding: element.shaderBinding,
    shaderSurfaceEnabled: cutterType === "booleanCutterWithFill",
    clipRole: element.roles.clip,
  };
}

function elementNeedsShaderCanvas(element) {
  if (!element?.enabled) {
    return false;
  }

  if (getElementCutterType(element) === "booleanCutterWithFill") {
    return true;
  }

  return element.roles?.shaderSurface === true && element.shaderBinding?.enabled !== false;
}

function geometryContainsAnyPoint(sourceGeometry, candidateGeometry) {
  return candidateGeometry.points.some((point) => pointInPolygon(point, sourceGeometry.points));
}

function cutterAffectsTarget(targetGeometry, cutterGeometry) {
  return (
    polygonsIntersect(targetGeometry.points, cutterGeometry.points) ||
    geometryContainsAnyPoint(targetGeometry, cutterGeometry) ||
    geometryContainsAnyPoint(cutterGeometry, targetGeometry)
  );
}

function clonePoints(points) {
  return points.map((point) => ({ ...point }));
}

function pointsEqual(left, right, epsilon = 1e-6) {
  return Math.abs(left.x - right.x) <= epsilon && Math.abs(left.y - right.y) <= epsilon;
}

function loopsEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((point, index) => pointsEqual(point, right[index]));
}

function subtractGeometryFromLoops(loopEntries, cutterGeometry) {
  const nextLoops = [];

  loopEntries.forEach((entry) => {
    if (entry.hole) {
      nextLoops.push(entry);
      return;
    }

    const loop = entry.points;
    const cutterInsideLoop = cutterGeometry.points.every((point) => pointInPolygon(point, loop));
    const loopInsideCutter = loop.every((point) => pointInPolygon(point, cutterGeometry.points));
    const intersects = polygonsIntersect(loop, cutterGeometry.points);

    if (loopInsideCutter) {
      return;
    }

    if (intersects) {
      const subtracted = subtractPolygonLoops(loop, cutterGeometry.points);
      const unchanged = subtracted.length === 1 && loopsEqual(subtracted[0], loop);
      if (unchanged && cutterInsideLoop) {
        nextLoops.push(entry);
        nextLoops.push({
          points: clonePoints([...cutterGeometry.points].reverse()),
          hole: true,
        });
        return;
      }
      subtracted.forEach((subtractedLoop) => {
        if (subtractedLoop.length >= 3) {
          nextLoops.push({ points: subtractedLoop, hole: false });
        }
      });
      return;
    }

    nextLoops.push(entry);
    if (cutterInsideLoop) {
      nextLoops.push({
        points: clonePoints([...cutterGeometry.points].reverse()),
        hole: true,
      });
    }
  });

  return nextLoops;
}

export function applyBooleanCutSequence({ geometry, cutters = [] }) {
  let loops = [{ points: clonePoints(geometry.points), hole: false }];

  cutters.forEach((cutterGeometry) => {
    loops = subtractGeometryFromLoops(loops, cutterGeometry);
  });

  return loops.map((entry) => entry.points);
}

function cloneLoopEntries(loopEntries) {
  return loopEntries.map((entry) => ({
    points: clonePoints(entry.points),
    hole: entry.hole === true,
  }));
}

function mapLoopEntriesToLoops(loopEntries) {
  return loopEntries.map((entry) => entry.points);
}

function buildIntersectionLoops(previousVisibleLoopEntries, cutterGeometry) {
  const intersectionLoops = [];

  previousVisibleLoopEntries.forEach((entry) => {
    if (entry.hole || entry.points.length < 3) {
      return;
    }

    const intersections = intersectPolygonLoops(entry.points, cutterGeometry.points);
    intersections.forEach((loop) => {
      if (loop.length >= 3) {
        intersectionLoops.push(loop);
      }
    });
  });

  return intersectionLoops;
}

function toLoopGeometry(loop, fallbackGeometry) {
  if (fallbackGeometry.kind === "quad" && loopsEqual(loop, fallbackGeometry.points)) {
    return fallbackGeometry;
  }

  return {
    kind: "polygon",
    points: loop,
  };
}

export function buildTargetCutStateForTarget({ targetGeometry, cutters = [] }) {
  let visibleLoopEntries = [{ points: clonePoints(targetGeometry.points), hole: false }];
  const fillEvents = [];
  const maskCutters = [];

  cutters.forEach((cutter) => {
    if (!cutterAffectsTarget(targetGeometry, cutter.geometry)) {
      return;
    }

    if (cutter.cutterType === "maskCutter") {
      maskCutters.push(cutter);
      return;
    }

    if (
      cutter.cutterType !== "booleanCutterNoFill" &&
      cutter.cutterType !== "booleanCutterWithFill"
    ) {
      return;
    }

    const previousVisibleLoopEntries = cloneLoopEntries(visibleLoopEntries);
    visibleLoopEntries = subtractGeometryFromLoops(visibleLoopEntries, cutter.geometry);
    const intersectionLoops = buildIntersectionLoops(
      previousVisibleLoopEntries,
      cutter.geometry
    );
    fillEvents.push({
      kind: cutter.cutterType === "booleanCutterWithFill" ? "eraseAndFill" : "eraseOnly",
      cutter,
      previousVisibleLoopEntries,
      currentVisibleLoopEntries: cloneLoopEntries(visibleLoopEntries),
      intersectionLoops,
    });
  });

  return {
    visibleLoopEntries: cloneLoopEntries(visibleLoopEntries),
    fillEvents,
    maskCutters,
  };
}

function drawInteractionFillIntoCutArea({
  context,
  previousVisibleLoops,
  intersectionLoops,
  fillSourceCanvas,
  width,
  height,
}) {
  if (!fillSourceCanvas || !previousVisibleLoops.length || !intersectionLoops.length) {
    return;
  }

  context.save();
  appendLoopsPath(context, previousVisibleLoops, width, height);
  context.clip("evenodd");
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  intersectionLoops.forEach((loop) => {
    if (loop.length < 3) {
      return;
    }
    drawSurfaceCanvas(
      context,
      fillSourceCanvas,
      {
        kind: "polygon",
        points: loop,
      },
      NEUTRAL_BINDING,
      width,
      height
    );
  });
  context.restore();
}

function buildFillLayer({
  fillEvents,
  cutterShaderCanvases,
  targetFillSourceCanvas = null,
  width,
  height,
}) {
  if (!fillEvents.length) {
    return null;
  }

  const fillLayer = createSizedCanvas(width, height);
  const fillContext = fillLayer.getContext("2d");
  fillEvents.forEach((event) => {
    eraseGeometry(fillContext, event.cutter.geometry, width, height);
    if (event.kind !== "eraseAndFill") {
      return;
    }

    const cutterShaderCanvas = cutterShaderCanvases.get(event.cutter.elementId);
    const fillSourceCanvas = targetFillSourceCanvas ?? cutterShaderCanvas;
    drawInteractionFillIntoCutArea({
      context: fillContext,
      previousVisibleLoops: mapLoopEntriesToLoops(event.previousVisibleLoopEntries),
      intersectionLoops: event.intersectionLoops ?? [],
      fillSourceCanvas,
      width,
      height,
    });
  });
  return fillLayer;
}

function drawLayerCanvas(context, layerCanvas, width, height) {
  if (!layerCanvas) {
    return;
  }
  context.save();
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  context.drawImage(layerCanvas, 0, 0, width, height);
  context.restore();
}

function applyMaskCutters({
  context,
  maskCutters,
  width,
  height,
}) {
  maskCutters.forEach((cutter) => {
    eraseGeometry(context, cutter.geometry, width, height);
  });
}

function drawPaintLayerWithPrecut({
  context,
  targetStyle,
  cutState,
  cutterShaderCanvases,
  width,
  height,
}) {
  const visibleLoops = mapLoopEntriesToLoops(cutState.visibleLoopEntries);
  context.save();
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = targetStyle.opacity;
  context.fillStyle = targetStyle.color;
  appendLoopsPath(context, visibleLoops, width, height);
  context.fill("evenodd");
  context.restore();

  const fillLayer = buildFillLayer({
    fillEvents: cutState.fillEvents,
    cutterShaderCanvases,
    width,
    height,
  });
  drawLayerCanvas(context, fillLayer, width, height);
  applyMaskCutters({
    context,
    maskCutters: cutState.maskCutters,
    width,
    height,
  });
}

function drawShaderSurfaceLoops({
  context,
  sourceCanvas,
  targetGeometry,
  binding,
  visibleLoopEntries,
  width,
  height,
}) {
  visibleLoopEntries
    .filter((entry) => !entry.hole && entry.points.length >= 3)
    .forEach((entry) => {
      drawSurfaceCanvas(
        context,
        sourceCanvas,
        toLoopGeometry(entry.points, targetGeometry),
        binding,
        width,
        height
      );
    });

  visibleLoopEntries
    .filter((entry) => entry.hole && entry.points.length >= 3)
    .forEach((entry) => {
      eraseGeometry(
        context,
        {
          kind: "polygon",
          points: entry.points,
        },
        width,
        height
      );
    });
}

function drawShaderSurfaceWithPrecut({
  context,
  sourceCanvas,
  targetGeometry,
  binding,
  cutState,
  cutterShaderCanvases,
  width,
  height,
}) {
  drawShaderSurfaceLoops({
    context,
    sourceCanvas,
    targetGeometry,
    binding,
    visibleLoopEntries: cutState.visibleLoopEntries,
    width,
    height,
  });

  const fillLayer = buildFillLayer({
    fillEvents: cutState.fillEvents,
    cutterShaderCanvases,
    targetFillSourceCanvas: sourceCanvas,
    width,
    height,
  });
  applyMaskCutters({
    context,
    maskCutters: cutState.maskCutters,
    width,
    height,
  });
  if (fillLayer) {
    applyMaskCutters({
      context: fillLayer.getContext("2d"),
      maskCutters: cutState.maskCutters,
      width,
      height,
    });
  }

  return {
    visibleLoops: mapLoopEntriesToLoops(cutState.visibleLoopEntries),
    fillLayer,
  };
}

export function buildFillExecutionPlanForTarget({ targetGeometry, cutters }) {
  const cutState = buildTargetCutStateForTarget({ targetGeometry, cutters });
  return cutState.fillEvents.map((event) => ({
    kind: event.kind,
    previousVisibleLoops: mapLoopEntriesToLoops(event.previousVisibleLoopEntries),
    currentVisibleLoops: mapLoopEntriesToLoops(event.currentVisibleLoopEntries),
    intersectionLoops: event.intersectionLoops ?? [],
    cutter: event.cutter,
  }));
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
    this.lastVisibleSurfaceGeometries = [];
  }

  async setProject(project) {
    this.project = project;
    this.lastVisibleSurfaceGeometries = [];
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

    const activeShaderElements = this.project.elements.filter((element) =>
      elementNeedsShaderCanvas(element)
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
        const blendSeconds =
          this.loadedPresetIds.elements.has(element.id)
            ? this.project.output.presets.lastChangeMode === "auto"
              ? this.project.output.presets.autoBlendSeconds
              : this.project.output.presets.userBlendSeconds
            : 0;
        const didLoad = await renderer.loadPreset(
          preset,
          blendSeconds
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
      visibleSurfaceGeometries: this.lastVisibleSurfaceGeometries,
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
    const globalOpacity = Math.max(0, Math.min(1, this.project.globalLayer?.opacity ?? 1));
    this.lastVisibleSurfaceGeometries = [];

    this.context.clearRect(0, 0, width, height);
    this.context.fillStyle = OUTPUT_BACKGROUND;
    this.context.fillRect(0, 0, width, height);

    const orderedElements = [...this.project.elements]
      .filter((element) => element.enabled)
      .sort((left, right) => left.zIndex - right.zIndex);

    const cutters = orderedElements
      .map((element, index) => createCutterDescriptor(element, index))
      .filter(Boolean);

    const cutterShaderCanvases = new Map();
    for (const element of orderedElements) {
      if (!elementNeedsShaderCanvas(element)) {
        continue;
      }

      const renderer = this.elementRenderers.get(element.id);
      if (!renderer) {
        continue;
      }

      await renderer.resize(width, height);
      await renderer.render({
        timestamp,
        audioFrame: this.audioFrame,
        interactionSummary: [],
      });
      cutterShaderCanvases.set(element.id, renderer.getCanvas());
    }

    for (let targetIndex = 0; targetIndex < orderedElements.length; targetIndex += 1) {
      const element = orderedElements[targetIndex];
      const elementCutterType = getElementCutterType(element);
      const cuttersAbove = cutters.filter((cutter) => cutter.orderIndex > targetIndex);
      const cutState = buildTargetCutStateForTarget({
        targetGeometry: element.geometry,
        cutters: cuttersAbove,
      });

      if (element.roles.paint && elementCutterType !== "booleanCutterWithFill") {
        const paintLayer = createSizedCanvas(width, height);
        const paintContext = paintLayer.getContext("2d");
        drawPaintLayerWithPrecut({
          context: paintContext,
          targetStyle: {
            ...element.style,
            opacity: element.style.opacity * globalOpacity,
          },
          cutState,
          cutterShaderCanvases,
          width,
          height,
        });
        this.context.drawImage(paintLayer, 0, 0, width, height);
      }

      if (
        element.roles.shaderSurface &&
        element.shaderBinding.enabled &&
        elementCutterType !== "booleanCutterWithFill"
      ) {
        const sourceCanvas = cutterShaderCanvases.get(element.id);
        if (!sourceCanvas) {
          continue;
        }

        const shaderLayer = createSizedCanvas(width, height);
        const shaderContext = shaderLayer.getContext("2d");
        const { visibleLoops, fillLayer } = drawShaderSurfaceWithPrecut({
          context: shaderContext,
          sourceCanvas,
          targetGeometry: element.geometry,
          binding: element.shaderBinding,
          cutState,
          cutterShaderCanvases,
          width,
          height,
        });

        const bounds = getPolygonBounds(element.geometry.points);
        this.lastVisibleSurfaceGeometries.push({
          elementId: element.id,
          elementName: element.name,
          sourceGeometry: element.geometry,
          clipGeometries: cuttersAbove.filter((cutter) => cutter.clipRole).map((cutter) => cutter.geometry),
          visibleGeometries: visibleLoops.map((loop) => ({ kind: "polygon", points: loop })),
          visibilityMode: "sequential-cutters-v3",
          drawWidth: Math.max(1, Math.round((bounds.maxX - bounds.minX) * width)),
          drawHeight: Math.max(1, Math.round((bounds.maxY - bounds.minY) * height)),
        });

        this.context.save();
        this.context.globalCompositeOperation = mapBlendMode(element.shaderBinding.blendMode);
        this.context.globalAlpha = element.shaderBinding.opacity * globalOpacity;
        this.context.drawImage(shaderLayer, 0, 0, width, height);
        this.context.restore();
        if (fillLayer) {
          this.context.save();
          this.context.globalCompositeOperation = "source-over";
          this.context.globalAlpha = 1;
          this.context.drawImage(fillLayer, 0, 0, width, height);
          this.context.restore();
        }
      }
    }
  }
}
