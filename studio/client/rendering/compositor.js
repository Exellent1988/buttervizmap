import { buildBoundarySummary, buildInteractionSummary } from "../../shared/composition.js";
import {
  distanceToPolygonEdge,
  getPolygonBounds,
  getMaxDistanceFromCentroid,
  getPolygonCentroid,
  interpolateQuadPoint,
} from "../../shared/geometry.js";
import { AdaptiveRenderer } from "./adaptiveRenderer.js";

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

function fillGeometry(context, element, width, height, color, opacity, composite = "source-over") {
  context.save();
  context.globalCompositeOperation = composite;
  context.globalAlpha = opacity;
  context.fillStyle = color;
  drawGeometryPath(context, element.geometry, width, height);
  context.fill();
  context.restore();
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function createSizedCanvas(width, height) {
  return createCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
}

function blendInteractionPasses(context, interactionCanvases, width, height, intensity = 1) {
  context.save();
  context.globalCompositeOperation = "screen";
  context.globalAlpha = 0.24 * intensity;
  context.drawImage(interactionCanvases.color, 0, 0, width, height);
  context.globalCompositeOperation = "soft-light";
  context.globalAlpha = 0.34 * intensity;
  context.drawImage(interactionCanvases.distance, 0, 0, width, height);
  context.globalCompositeOperation = "overlay";
  context.globalAlpha = 0.2 * intensity;
  context.drawImage(interactionCanvases.mask, 0, 0, width, height);
  context.globalCompositeOperation = "screen";
  context.globalAlpha = 0.14 * intensity;
  context.drawImage(interactionCanvases.boundary, 0, 0, width, height);
  context.restore();
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

function createCanvasSnapshot(canvas) {
  const snapshot = createSizedCanvas(canvas.width, canvas.height);
  snapshot.getContext("2d").drawImage(canvas, 0, 0);
  return snapshot;
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

function summarizeInteraction(interactionSummary) {
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

  interactionSummary.forEach((field) => {
    const weight = Math.max(0.001, field.alpha * (0.5 + field.influence));
    totalWeight += weight;
    pulse += field.pulse * weight;
    swirl += field.swirl * weight;
    offsetX += (field.centroid.x - 0.5) * weight;
    offsetY += (field.centroid.y - 0.5) * weight;

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
    offsetX: offsetX / totalWeight,
    offsetY: offsetY / totalWeight,
    color: `rgb(${Math.round(red / totalWeight)}, ${Math.round(green / totalWeight)}, ${Math.round(
      blue / totalWeight
    )})`,
  };
}

function buildSurfaceEffectCanvas({
  sourceCanvas,
  binding,
  interactionState,
  timestamp,
  width,
  height,
  interactionSummary = [],
}) {
  const effectCanvas = createSizedCanvas(width, height);
  const effectContext = effectCanvas.getContext("2d");
  effectContext.clearRect(0, 0, width, height);
  const effectBinding = {
    ...binding,
    opacity: 1,
    blendMode: "normal",
  };
  drawCanvasWithBinding({
    context: effectContext,
    sourceCanvas,
    drawX: 0,
    drawY: 0,
    drawWidth: width,
    drawHeight: height,
    binding: effectBinding,
    interactionState,
    timestamp,
  });

  if (interactionSummary.length && (binding.interactionMix ?? 0) > 0.001) {
    const snapshot = createCanvasSnapshot(effectCanvas);
    renderInteractionBoundaryEcho({
      context: effectContext,
      sourceCanvas: snapshot,
      interactionSummary,
      width,
      height,
      intensity: binding.interactionMix,
    });
  }

  return effectCanvas;
}

function renderInteractionBoundaryEcho({
  context,
  sourceCanvas,
  interactionSummary,
  width,
  height,
  intensity,
}) {
  if (!interactionSummary.length || intensity <= 0.001) {
    return;
  }

  const edgeCanvas = createCanvas(width, height);
  const edgeContext = edgeCanvas.getContext("2d");

  edgeContext.clearRect(0, 0, width, height);
  interactionSummary.forEach((field) => {
    const outerWidth =
      Math.max(4, Math.min(width, height) * 0.008) *
      (1 + field.distance + field.feather + field.pulse);
    const innerWidth = Math.max(1.5, outerWidth * 0.32);

    edgeContext.save();
    edgeContext.lineJoin = "round";
    edgeContext.lineCap = "round";
    edgeContext.strokeStyle = `rgba(255,255,255,${Math.min(
      0.95,
      0.3 + field.alpha * field.influence
    )})`;
    edgeContext.lineWidth = outerWidth;
    drawGeometryPath(edgeContext, field.geometry, width, height);
    edgeContext.stroke();
    edgeContext.strokeStyle = "rgba(255,255,255,0.95)";
    edgeContext.lineWidth = innerWidth;
    drawGeometryPath(edgeContext, field.geometry, width, height);
    edgeContext.stroke();
    edgeContext.restore();
  });

  edgeContext.globalCompositeOperation = "source-in";
  edgeContext.drawImage(sourceCanvas, 0, 0, width, height);

  const interactionState = summarizeInteraction(interactionSummary);
  const shiftX = interactionState.offsetX * width * 0.08 * intensity;
  const shiftY = interactionState.offsetY * height * 0.08 * intensity;

  context.save();
  context.globalCompositeOperation = "screen";
  context.globalAlpha = 0.22 + intensity * 0.28;
  context.drawImage(edgeCanvas, 0, 0, width, height);
  context.globalCompositeOperation = "lighter";
  context.globalAlpha = 0.08 + intensity * 0.16;
  context.drawImage(edgeCanvas, shiftX, shiftY, width, height);
  context.globalAlpha = 0.06 + intensity * 0.12;
  context.drawImage(edgeCanvas, -shiftX, -shiftY, width, height);
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

function drawWarpedQuad(context, sourceCanvas, geometry, outputWidth, outputHeight) {
  const subdivisions = 14;
  const pixelPoints = geometry.points.map((point) => ({
    x: point.x * outputWidth,
    y: point.y * outputHeight,
  }));

  for (let yIndex = 0; yIndex < subdivisions; yIndex += 1) {
    const v0 = yIndex / subdivisions;
    const v1 = (yIndex + 1) / subdivisions;
    const sy0 = sourceCanvas.height * v0;
    const sy1 = sourceCanvas.height * v1;

    for (let xIndex = 0; xIndex < subdivisions; xIndex += 1) {
      const u0 = xIndex / subdivisions;
      const u1 = (xIndex + 1) / subdivisions;
      const sx0 = sourceCanvas.width * u0;
      const sx1 = sourceCanvas.width * u1;

      const topLeft = interpolateQuadPoint(pixelPoints, u0, v0);
      const topRight = interpolateQuadPoint(pixelPoints, u1, v0);
      const bottomRight = interpolateQuadPoint(pixelPoints, u1, v1);
      const bottomLeft = interpolateQuadPoint(pixelPoints, u0, v1);

      drawTexturedTriangle(
        context,
        sourceCanvas,
        sx0,
        sy0,
        sx1,
        sy0,
        sx1,
        sy1,
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
        sx0,
        sy0,
        sx1,
        sy1,
        sx0,
        sy1,
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

function drawWarpedPolygon(context, sourceCanvas, geometry, outputWidth, outputHeight) {
  const bounds = getPolygonBounds(geometry.points);
  const localWidth = Math.max(bounds.maxX - bounds.minX, 0.001);
  const localHeight = Math.max(bounds.maxY - bounds.minY, 0.001);
  const polygonPoints = geometry.points.map((point) => ({
    x: point.x * outputWidth,
    y: point.y * outputHeight,
  }));
  const sourcePoints = geometry.points.map((point) => ({
    x: ((point.x - bounds.minX) / localWidth) * sourceCanvas.width,
    y: ((point.y - bounds.minY) / localHeight) * sourceCanvas.height,
  }));

  for (let index = 1; index < polygonPoints.length - 1; index += 1) {
    drawTexturedTriangle(
      context,
      sourceCanvas,
      sourcePoints[0].x,
      sourcePoints[0].y,
      sourcePoints[index].x,
      sourcePoints[index].y,
      sourcePoints[index + 1].x,
      sourcePoints[index + 1].y,
      polygonPoints[0].x,
      polygonPoints[0].y,
      polygonPoints[index].x,
      polygonPoints[index].y,
      polygonPoints[index + 1].x,
      polygonPoints[index + 1].y
    );
  }
}

function applyInteractionBoundaryReaction({
  context,
  width,
  height,
  interactionSummary,
  intensity,
  boundaryCanvas = null,
}) {
  if (!interactionSummary.length || intensity <= 0.001) {
    return;
  }

  const sourceSnapshot = createSizedCanvas(width, height);
  sourceSnapshot.getContext("2d").drawImage(context.canvas, 0, 0);
  renderInteractionBoundaryEcho({
    context,
    sourceCanvas: sourceSnapshot,
    interactionSummary,
    width,
    height,
    intensity,
  });

  if (boundaryCanvas) {
    const interactionState = summarizeInteraction(interactionSummary);
    const tangentX = -interactionState.offsetY * width * 0.16;
    const tangentY = interactionState.offsetX * height * 0.16;

    context.save();
    context.globalCompositeOperation = "lighter";
    context.globalAlpha = 0.08 + intensity * 0.16;
    context.drawImage(boundaryCanvas, tangentX, tangentY, width, height);
    context.globalAlpha = 0.05 + intensity * 0.12;
    context.drawImage(boundaryCanvas, -tangentX, -tangentY, width, height);
    context.restore();
  }
}

function drawCanvasWithBinding({
  context,
  sourceCanvas,
  drawX,
  drawY,
  drawWidth,
  drawHeight,
  binding,
  interactionState,
  timestamp,
}) {
  const baseScale = binding.scale ?? 1;
  const pulseScale =
    1 +
    (binding.interactionMix ?? 0) *
      interactionState.energy *
      interactionState.pulse *
      0.22 *
      Math.sin(timestamp * 0.0022);
  const driftX =
    (binding.offsetX ?? 0) * drawWidth * 0.5 +
    interactionState.offsetX * drawWidth * (binding.interactionMix ?? 0) * 0.28;
  const driftY =
    (binding.offsetY ?? 0) * drawHeight * 0.5 +
    interactionState.offsetY * drawHeight * (binding.interactionMix ?? 0) * 0.28;
  const rotation =
    ((binding.rotation ?? 0) * Math.PI) / 180 +
    Math.sin(timestamp * 0.0014) *
      interactionState.swirl *
      (binding.interactionMix ?? 0) *
      0.18;

  context.save();
  context.globalCompositeOperation = mapBlendMode(binding.blendMode);
  context.globalAlpha = binding.opacity;
  context.translate(drawX + drawWidth / 2 + driftX, drawY + drawHeight / 2 + driftY);
  context.rotate(rotation);
  context.scale(baseScale * pulseScale, baseScale * pulseScale);
  context.drawImage(sourceCanvas, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);

  const reactionMix = (binding.interactionMix ?? 0) * interactionState.energy;
  if (reactionMix > 0.001) {
    if (binding.reactionMode === "glow") {
      context.globalCompositeOperation = "screen";
      context.globalAlpha = 0.24 + reactionMix * 0.32;
      context.drawImage(
        sourceCanvas,
        -drawWidth / 2 - drawWidth * 0.04,
        -drawHeight / 2 - drawHeight * 0.04,
        drawWidth * 1.08,
        drawHeight * 1.08
      );
    } else if (binding.reactionMode === "warp") {
      context.globalCompositeOperation = "screen";
      context.globalAlpha = 0.1 + reactionMix * 0.2;
      context.drawImage(
        sourceCanvas,
        -drawWidth / 2 + interactionState.offsetX * drawWidth * 0.12,
        -drawHeight / 2 + interactionState.offsetY * drawHeight * 0.12,
        drawWidth,
        drawHeight
      );
    } else if (binding.reactionMode === "pulse") {
      const growth = 1 + reactionMix * 0.16;
      context.globalCompositeOperation = "lighter";
      context.globalAlpha = 0.08 + reactionMix * 0.18;
      context.drawImage(
        sourceCanvas,
        (-drawWidth * growth) / 2,
        (-drawHeight * growth) / 2,
        drawWidth * growth,
        drawHeight * growth
      );
    } else if (binding.reactionMode === "reflect") {
      const reflectX = interactionState.offsetX * drawWidth * 0.2;
      const reflectY = interactionState.offsetY * drawHeight * 0.2;
      context.globalCompositeOperation = "screen";
      context.globalAlpha = 0.12 + reactionMix * 0.24;
      context.scale(-1, 1);
      context.drawImage(
        sourceCanvas,
        drawWidth / 2 - reflectX,
        -drawHeight / 2 - reflectY,
        drawWidth,
        drawHeight
      );
      context.scale(-1, 1);
      context.globalCompositeOperation = "lighter";
      context.globalAlpha = 0.08 + reactionMix * 0.18;
      context.drawImage(
        sourceCanvas,
        -drawWidth / 2 - reflectX,
        -drawHeight / 2 - reflectY,
        drawWidth,
        drawHeight
      );
    }

    context.globalCompositeOperation = "soft-light";
    context.globalAlpha = 0.18 + reactionMix * 0.28;
    context.fillStyle = interactionState.color;
    context.fillRect(-drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  }

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
    this.interactionCanvases = {
      mask: createCanvas(1, 1),
      color: createCanvas(1, 1),
      distance: createCanvas(1, 1),
      boundary: createCanvas(1, 1),
    };
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

    Object.values(this.interactionCanvases).forEach((canvas) => {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    });
  }

  renderInteractionPass(interactionSummary) {
    const width = this.project.output.width;
    const height = this.project.output.height;
    const maskContext = this.interactionCanvases.mask.getContext("2d");
    const colorContext = this.interactionCanvases.color.getContext("2d");
    const distanceContext = this.interactionCanvases.distance.getContext("2d");
    const boundaryContext = this.interactionCanvases.boundary.getContext("2d");

    [maskContext, colorContext, distanceContext, boundaryContext].forEach((context) =>
      context.clearRect(0, 0, width, height)
    );

    interactionSummary.forEach((field) => {
      const element = this.project.elements.find((entry) => entry.id === field.elementId);
      if (!element) {
        return;
      }

      fillGeometry(maskContext, element, width, height, "#ffffff", field.alpha);
      fillGeometry(colorContext, element, width, height, field.color, field.alpha);

      const centroid = field.centroid;
      const radius = Math.max(
        32,
        Math.min(width, height) * field.maxDistance * (1 + field.distance + field.feather)
      );
      distanceContext.save();
      drawGeometryPath(distanceContext, element.geometry, width, height);
      distanceContext.clip();
      const gradient = distanceContext.createRadialGradient(
        centroid.x * width,
        centroid.y * height,
        0,
        centroid.x * width,
        centroid.y * height,
        radius
      );
      gradient.addColorStop(0, "rgba(255,255,255,0.9)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      distanceContext.fillStyle = gradient;
      distanceContext.fillRect(0, 0, width, height);
      distanceContext.restore();

      boundaryContext.save();
      boundaryContext.lineJoin = "round";
      boundaryContext.lineCap = "round";
      boundaryContext.strokeStyle = `rgba(255,255,255,${Math.min(
        0.9,
        0.28 + field.alpha * field.influence
      )})`;
      boundaryContext.lineWidth =
        Math.max(2, Math.min(width, height) * 0.005) * (1 + field.distance + field.pulse);
      drawGeometryPath(boundaryContext, element.geometry, width, height);
      boundaryContext.stroke();
      boundaryContext.restore();
    });

    return this.interactionCanvases;
  }

  async render(timestamp) {
    if (!this.project) {
      return;
    }

    await this.ensureRendererGraph();
    this.ensureCanvasSize();

    const width = this.project.output.width;
    const height = this.project.output.height;
    const interactionSummary = buildInteractionSummary(this.project).map((field) => ({
      ...field,
      centroid: getPolygonCentroid(field.geometry.points),
      maxDistance: getMaxDistanceFromCentroid(field.geometry.points),
      edgeDistanceAtCentroid: distanceToPolygonEdge(
        getPolygonCentroid(field.geometry.points),
        field.geometry.points
      ),
    }));
    const boundarySummary = buildBoundarySummary(this.project).map((field) => ({
      ...field,
      centroid: getPolygonCentroid(field.geometry.points),
      maxDistance: getMaxDistanceFromCentroid(field.geometry.points),
      edgeDistanceAtCentroid: distanceToPolygonEdge(
        getPolygonCentroid(field.geometry.points),
        field.geometry.points
      ),
    }));

    const interactionCanvases = this.renderInteractionPass(boundarySummary);

    this.context.clearRect(0, 0, width, height);
    this.context.fillStyle = this.project.output.background;
    this.context.fillRect(0, 0, width, height);

    if (this.project.globalLayer.enabled && this.globalRenderer) {
      const globalInteraction = summarizeInteraction(interactionSummary);
      await this.globalRenderer.render({
        timestamp,
        audioFrame: this.audioFrame,
        interactionSummary,
      });
      const globalSurface = buildSurfaceEffectCanvas({
        sourceCanvas: this.globalRenderer.getCanvas(),
        binding: {
          opacity: this.project.globalLayer.opacity,
          blendMode: "normal",
          scale: this.project.globalLayer.scale,
          offsetX: globalInteraction.offsetX * this.project.globalLayer.drift,
          offsetY: globalInteraction.offsetY * this.project.globalLayer.drift,
          rotation: globalInteraction.swirl * this.project.globalLayer.drift * 14,
          interactionMix: this.project.globalLayer.interactionMix,
          reactionMode: "glow",
        },
        interactionState: globalInteraction,
        timestamp,
        width,
        height,
        interactionSummary: boundarySummary,
      });
      this.context.save();
      this.context.globalAlpha = this.project.globalLayer.opacity;
      this.context.drawImage(globalSurface, 0, 0, width, height);
      applyInteractionBoundaryReaction({
        context: this.context,
        width,
        height,
        interactionSummary: boundarySummary,
        intensity: this.project.globalLayer.interactionMix,
        boundaryCanvas: interactionCanvases.boundary,
      });
      this.context.restore();
      blendInteractionPasses(this.context, interactionCanvases, width, height, 0.9);
    }

    const orderedElements = [...this.project.elements]
      .filter((element) => element.enabled)
      .sort((left, right) => left.zIndex - right.zIndex);

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
          const drawX = Math.round(bounds.minX * width);
          const drawY = Math.round(bounds.minY * height);
          const drawWidth = Math.max(1, Math.round((bounds.maxX - bounds.minX) * width));
          const drawHeight = Math.max(1, Math.round((bounds.maxY - bounds.minY) * height));
          await renderer.resize(drawWidth, drawHeight);
          const localInteractionSummary = remapInteractionSummaryToBounds(
            interactionSummary,
            bounds
          );
          const localBoundarySummary = remapInteractionSummaryToBounds(boundarySummary, bounds);
          await renderer.render({
            timestamp,
            audioFrame: this.audioFrame,
            interactionSummary: localInteractionSummary,
          });
          const localInteraction = summarizeInteraction(localInteractionSummary);
          const surfaceCanvas = buildSurfaceEffectCanvas({
            sourceCanvas: renderer.getCanvas(),
            binding: element.shaderBinding,
            interactionState: localInteraction,
            timestamp,
            width: drawWidth,
            height: drawHeight,
            interactionSummary: localBoundarySummary,
          });
          this.context.save();
          if (element.geometry.kind === "quad") {
            this.context.globalAlpha = element.shaderBinding.opacity;
            this.context.globalCompositeOperation = mapBlendMode(element.shaderBinding.blendMode);
            drawWarpedQuad(this.context, surfaceCanvas, element.geometry, width, height);
          } else {
            this.context.globalCompositeOperation = mapBlendMode(element.shaderBinding.blendMode);
            this.context.globalAlpha = element.shaderBinding.opacity;
            drawWarpedPolygon(this.context, surfaceCanvas, element.geometry, width, height);
          }
          blendInteractionPasses(this.context, interactionCanvases, width, height, 1.2);
          this.context.restore();
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

    applyInteractionBoundaryReaction({
      context: this.context,
      width,
      height,
      interactionSummary: boundarySummary,
      intensity: Math.max(
        this.project.globalLayer.interactionMix,
        ...orderedElements
          .filter((element) => element.roles.shaderSurface && element.shaderBinding.enabled)
          .map((element) => element.shaderBinding.interactionMix ?? 0)
      ),
      boundaryCanvas: interactionCanvases.boundary,
    });
    blendInteractionPasses(this.context, interactionCanvases, width, height, 1);
  }
}
