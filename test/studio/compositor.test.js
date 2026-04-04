import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import {
  buildSurfaceReactionTextures,
  filterInteractionSummaryForGeometry,
  getSurfaceDomainGeometry,
  localizeInteractionSummaryToGeometry,
  mapDomainPointToSurfacePoint,
} from "../../studio/client/rendering/compositor.js";

function createCanvasContextStub(canvas) {
  return {
    createImageData(width, height) {
      return {
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      };
    },
    putImageData(imageData) {
      canvas.__imageData = imageData;
    },
    getImageData(x, y, width, height) {
      const fallback = new Uint8ClampedArray(width * height * 4);
      const imageData = canvas.__imageData;
      if (!imageData) {
        return { data: fallback };
      }

      const sourceX = Math.max(0, Math.min(imageData.width - 1, Math.floor(x)));
      const sourceY = Math.max(0, Math.min(imageData.height - 1, Math.floor(y)));
      const sourceIndex = (sourceY * imageData.width + sourceX) * 4;
      return {
        data: imageData.data.slice(sourceIndex, sourceIndex + width * height * 4),
      };
    },
  };
}

function createCanvasStub() {
  const canvas = {
    width: 0,
    height: 0,
    __imageData: null,
    getContext() {
      if (!this.__context) {
        this.__context = createCanvasContextStub(this);
      }
      return this.__context;
    },
  };
  return canvas;
}

const originalDocument = globalThis.document;

beforeAll(() => {
  globalThis.document = {
    createElement(tagName) {
      if (tagName !== "canvas") {
        throw new Error(`Unsupported test element: ${tagName}`);
      }
      return createCanvasStub();
    },
  };
});

afterAll(() => {
  globalThis.document = originalDocument;
});

describe("studio compositor interaction localization", () => {
  test("keeps only overlapping interaction fields when localizing to a shader surface", () => {
    const surfaceGeometry = {
      kind: "polygon",
      points: [
        { x: 0.25, y: 0.18 },
        { x: 0.88, y: 0.2 },
        { x: 0.8, y: 0.84 },
        { x: 0.3, y: 0.78 },
      ],
    };
    const interactionSummary = [
      {
        elementId: "near",
        sourceRole: "interactionField",
        geometry: {
          kind: "polygon",
          points: [
            { x: 0.42, y: 0.32 },
            { x: 0.66, y: 0.3 },
            { x: 0.62, y: 0.6 },
            { x: 0.44, y: 0.58 },
          ],
        },
        centroid: { x: 0.54, y: 0.45 },
        maxDistance: 0.2,
        edgeDistanceAtCentroid: 0.08,
        alpha: 0.7,
        color: "#44ffaa",
        distance: 0.5,
        feather: 0.05,
        pulse: 0.4,
        swirl: 0.3,
        influence: 0.8,
      },
      {
        elementId: "far",
        sourceRole: "interactionField",
        geometry: {
          kind: "polygon",
          points: [
            { x: 0.02, y: 0.05 },
            { x: 0.15, y: 0.04 },
            { x: 0.12, y: 0.18 },
          ],
        },
        centroid: { x: 0.1, y: 0.09 },
        maxDistance: 0.09,
        edgeDistanceAtCentroid: 0.03,
        alpha: 0.9,
        color: "#ff3366",
        distance: 0.7,
        feather: 0.05,
        pulse: 0.6,
        swirl: 0.5,
        influence: 0.9,
      },
    ];

    const localized = localizeInteractionSummaryToGeometry(interactionSummary, surfaceGeometry);

    expect(localized).toHaveLength(1);
    expect(localized[0].elementId).toBe("near");
    expect(localized[0].alpha).toBeGreaterThan(0.2);
    expect(localized[0].centroid.x).toBeGreaterThanOrEqual(0);
    expect(localized[0].centroid.x).toBeLessThanOrEqual(1);
    expect(localized[0].centroid.y).toBeGreaterThanOrEqual(0);
    expect(localized[0].centroid.y).toBeLessThanOrEqual(1);
  });

  test("keeps only overlapping clip-style interaction sources for a surface", () => {
    const surfaceGeometry = {
      kind: "polygon",
      points: [
        { x: 0.28, y: 0.18 },
        { x: 0.86, y: 0.22 },
        { x: 0.82, y: 0.82 },
        { x: 0.24, y: 0.74 },
      ],
    };
    const interactionSummary = [
      {
        elementId: "clip-near",
        sourceRole: "clip",
        geometry: {
          kind: "polygon",
          points: [
            { x: 0.48, y: 0.2 },
            { x: 0.72, y: 0.22 },
            { x: 0.69, y: 0.86 },
            { x: 0.45, y: 0.8 },
          ],
        },
        centroid: { x: 0.585, y: 0.52 },
        maxDistance: 0.34,
        edgeDistanceAtCentroid: 0.08,
        alpha: 1,
        color: "#ffffff",
        distance: 0.7,
        feather: 0.03,
        pulse: 0.15,
        swirl: 0,
        influence: 0.85,
      },
      {
        elementId: "clip-far",
        sourceRole: "clip",
        geometry: {
          kind: "polygon",
          points: [
            { x: 0.02, y: 0.02 },
            { x: 0.12, y: 0.03 },
            { x: 0.1, y: 0.14 },
          ],
        },
        centroid: { x: 0.08, y: 0.06 },
        maxDistance: 0.08,
        edgeDistanceAtCentroid: 0.03,
        alpha: 1,
        color: "#ffffff",
        distance: 0.7,
        feather: 0.03,
        pulse: 0.15,
        swirl: 0,
        influence: 0.85,
      },
    ];

    const filtered = filterInteractionSummaryForGeometry(interactionSummary, surfaceGeometry);

    expect(filtered.some((entry) => entry.elementId === "clip-near")).toBe(true);
    expect(filtered.some((entry) => entry.elementId === "clip-far")).toBe(false);
    expect(filtered.every((entry) => entry.sourceRole === "clip")).toBe(true);
  });

  test("maps polygon surface domains onto the square boundary instead of an inset bbox mask", () => {
    const surfaceGeometry = {
      kind: "polygon",
      points: [
        { x: 0.08, y: 0.2 },
        { x: 0.9, y: 0.14 },
        { x: 0.84, y: 0.88 },
        { x: 0.24, y: 0.8 },
      ],
    };
    const domainGeometry = getSurfaceDomainGeometry(surfaceGeometry);
    const mappedPoint = mapDomainPointToSurfacePoint(
      {
        domainGeometry,
        triangles: [
          {
            source: [domainGeometry.points[0], domainGeometry.points[1], domainGeometry.points[2]],
            destination: [surfaceGeometry.points[0], surfaceGeometry.points[1], surfaceGeometry.points[2]],
          },
          {
            source: [domainGeometry.points[0], domainGeometry.points[2], domainGeometry.points[3]],
            destination: [surfaceGeometry.points[0], surfaceGeometry.points[2], surfaceGeometry.points[3]],
          },
        ],
      },
      { x: 0.5, y: 0.5 }
    );

    expect(domainGeometry.points.some((point) => point.x === 0 || point.x === 1)).toBe(true);
    expect(domainGeometry.points.some((point) => point.y === 0 || point.y === 1)).toBe(true);
    expect(mappedPoint).not.toBeNull();
  });

  test("maps polygon domain points near the boundary back onto the visible surface edge", () => {
    const surfaceGeometry = {
      kind: "polygon",
      points: [
        { x: 0.16, y: 0.18 },
        { x: 0.88, y: 0.14 },
        { x: 0.86, y: 0.82 },
        { x: 0.22, y: 0.78 },
      ],
    };
    const domainGeometry = getSurfaceDomainGeometry(surfaceGeometry);
    const mappedEdgePoint = mapDomainPointToSurfacePoint(
      {
        domainGeometry,
        triangles: [
          {
            source: [domainGeometry.points[0], domainGeometry.points[1], domainGeometry.points[2]],
            destination: [surfaceGeometry.points[0], surfaceGeometry.points[1], surfaceGeometry.points[2]],
          },
          {
            source: [domainGeometry.points[0], domainGeometry.points[2], domainGeometry.points[3]],
            destination: [surfaceGeometry.points[0], surfaceGeometry.points[2], surfaceGeometry.points[3]],
          },
        ],
      },
      { x: 0.98, y: 0.18 }
    );

    expect(mappedEdgePoint).not.toBeNull();
    expect(mappedEdgePoint.x).toBeGreaterThan(0.7);
  });

  test("builds a visibility mask that excludes fully enclosed clip geometry", () => {
    const reactionTextures = buildSurfaceReactionTextures({
      surfaceGeometry: {
        kind: "quad",
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.9, y: 0.9 },
          { x: 0.1, y: 0.9 },
        ],
      },
      clipGeometries: [
        {
          kind: "polygon",
          points: [
            { x: 0.42, y: 0.32 },
            { x: 0.68, y: 0.34 },
            { x: 0.56, y: 0.62 },
          ],
        },
      ],
      interactionSources: [],
      width: 64,
      height: 64,
    });
    const visibilityContext = reactionTextures.visibilityCanvas.getContext("2d");
    const clipPixel = visibilityContext.getImageData(35, 28, 1, 1).data;
    const visiblePixel = visibilityContext.getImageData(12, 12, 1, 1).data;

    expect(clipPixel[3]).toBe(0);
    expect(visiblePixel[3]).toBe(255);
  });

  test("excludes edge-overlap clip wedges and enclosed clips in one surface mask", () => {
    const reactionTextures = buildSurfaceReactionTextures({
      surfaceGeometry: {
        kind: "quad",
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.9, y: 0.9 },
          { x: 0.1, y: 0.9 },
        ],
      },
      clipGeometries: [
        {
          kind: "polygon",
          points: [
            { x: 0.44, y: 0.32 },
            { x: 0.62, y: 0.32 },
            { x: 0.53, y: 0.58 },
          ],
        },
        {
          kind: "polygon",
          points: [
            { x: 0.62, y: 0.78 },
            { x: 0.84, y: 0.66 },
            { x: 0.98, y: 0.98 },
          ],
        },
      ],
      interactionSources: [],
      width: 64,
      height: 64,
    });
    const visibilityContext = reactionTextures.visibilityCanvas.getContext("2d");
    const enclosedClipPixel = visibilityContext.getImageData(35, 28, 1, 1).data;
    const edgeClipPixel = visibilityContext.getImageData(52, 53, 1, 1).data;
    const visiblePixel = visibilityContext.getImageData(18, 20, 1, 1).data;

    expect(enclosedClipPixel[3]).toBe(0);
    expect(edgeClipPixel[3]).toBe(0);
    expect(visiblePixel[3]).toBe(255);
  });

  test("interaction-only fields do not cut surface visibility", () => {
    const reactionTextures = buildSurfaceReactionTextures({
      surfaceGeometry: {
        kind: "quad",
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.9, y: 0.9 },
          { x: 0.1, y: 0.9 },
        ],
      },
      clipGeometries: [],
      interactionSources: [
        {
          elementId: "field-only",
          sourceRole: "interactionField",
          geometry: {
            kind: "polygon",
            points: [
              { x: 0.35, y: 0.25 },
              { x: 0.68, y: 0.3 },
              { x: 0.62, y: 0.62 },
              { x: 0.31, y: 0.56 },
            ],
          },
          alpha: 0.7,
          color: "#44ffaa",
          distance: 0.5,
          feather: 0.02,
          influence: 0.7,
        },
      ],
      width: 64,
      height: 64,
    });
    const visibilityContext = reactionTextures.visibilityCanvas.getContext("2d");
    const insideInteractionPixel = visibilityContext.getImageData(33, 28, 1, 1).data;
    const insideSurfacePixel = visibilityContext.getImageData(14, 14, 1, 1).data;

    expect(insideInteractionPixel[3]).toBe(255);
    expect(insideSurfacePixel[3]).toBe(255);
  });

  test("clip+interaction fields cut interior while remaining valid interaction sources", () => {
    const reactionTextures = buildSurfaceReactionTextures({
      surfaceGeometry: {
        kind: "quad",
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.9, y: 0.9 },
          { x: 0.1, y: 0.9 },
        ],
      },
      clipGeometries: [
        {
          kind: "polygon",
          points: [
            { x: 0.44, y: 0.24 },
            { x: 0.68, y: 0.32 },
            { x: 0.56, y: 0.64 },
          ],
        },
      ],
      interactionSources: [
        {
          elementId: "clip-and-field",
          sourceRole: "clip",
          geometry: {
            kind: "polygon",
            points: [
              { x: 0.44, y: 0.24 },
              { x: 0.68, y: 0.32 },
              { x: 0.56, y: 0.64 },
            ],
          },
          alpha: 0.8,
          color: "#ff7d45",
          distance: 0.6,
          feather: 0.03,
          influence: 0.75,
        },
      ],
      width: 64,
      height: 64,
    });
    const visibilityContext = reactionTextures.visibilityCanvas.getContext("2d");
    const insideClipPixel = visibilityContext.getImageData(35, 29, 1, 1).data;
    const insideSurfacePixel = visibilityContext.getImageData(14, 14, 1, 1).data;
    const contourContext = reactionTextures.contourCanvas.getContext("2d");
    const outsideContourPixel = contourContext.getImageData(40, 34, 1, 1).data;

    expect(insideClipPixel[3]).toBe(0);
    expect(insideSurfacePixel[3]).toBe(255);
    expect(outsideContourPixel[3]).toBeGreaterThan(0);
  });
});
