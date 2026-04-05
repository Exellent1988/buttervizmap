import { describe, expect, test } from "@jest/globals";
import {
  buildBoundarySummary,
  buildInteractionSummary,
  buildRenderPlan,
} from "../../studio/shared/composition.js";
import {
    distanceToPolygonEdge,
    interpolateQuadPoint,
    mapPolygonPointsToUnitSquareBoundary,
    normalizeGeometry,
    normalizePointsToBounds,
    pointInPolygon,
  polygonsIntersect,
  subtractPolygonLoops,
  triangulatePolygon,
} from "../../studio/shared/geometry.js";
import { createDefaultProject } from "../../studio/shared/project.js";

describe("studio geometry and composition", () => {
  test("normalizes quad geometry to four points", () => {
    const geometry = normalizeGeometry({ kind: "quad", points: [{ x: 0.2, y: 0.2 }] });
    expect(geometry.points).toHaveLength(4);
  });

  test("detects whether a point is inside a polygon", () => {
    const polygon = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.5, y: 0.8 },
    ];

    expect(pointInPolygon({ x: 0.5, y: 0.3 }, polygon)).toBe(true);
    expect(pointInPolygon({ x: 0.92, y: 0.75 }, polygon)).toBe(false);
  });

  test("computes a non-zero edge distance for points inside a polygon", () => {
    const polygon = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.5, y: 0.8 },
    ];

    expect(distanceToPolygonEdge({ x: 0.5, y: 0.3 }, polygon)).toBeGreaterThan(0);
  });

  test("normalizes polygon points to their own bounds", () => {
    const normalized = normalizePointsToBounds([
      { x: 0.25, y: 0.2 },
      { x: 0.75, y: 0.2 },
      { x: 0.6, y: 0.8 },
      { x: 0.3, y: 0.7 },
    ]);

    expect(Math.min(...normalized.map((point) => point.x))).toBeCloseTo(0);
    expect(Math.max(...normalized.map((point) => point.x))).toBeCloseTo(1);
    expect(Math.min(...normalized.map((point) => point.y))).toBeCloseTo(0);
    expect(Math.max(...normalized.map((point) => point.y))).toBeCloseTo(1);
  });

  test("maps polygon vertices onto the unit-square boundary instead of a bbox interior", () => {
    const mapped = mapPolygonPointsToUnitSquareBoundary([
      { x: 0.08, y: 0.62 },
      { x: 0.44, y: 0.12 },
      { x: 0.92, y: 0.2 },
      { x: 0.88, y: 0.84 },
      { x: 0.22, y: 0.9 },
    ]);

    expect(mapped).toHaveLength(5);
    mapped.forEach((point) => {
      const onLeft = Math.abs(point.x) < 1e-6;
      const onRight = Math.abs(point.x - 1) < 1e-6;
      const onTop = Math.abs(point.y) < 1e-6;
      const onBottom = Math.abs(point.y - 1) < 1e-6;
      expect(onLeft || onRight || onTop || onBottom).toBe(true);
    });
  });

  test("detects intersecting polygon contours", () => {
    const left = [
      { x: 0.15, y: 0.15 },
      { x: 0.5, y: 0.1 },
      { x: 0.46, y: 0.5 },
      { x: 0.2, y: 0.48 },
    ];
    const right = [
      { x: 0.4, y: 0.25 },
      { x: 0.85, y: 0.22 },
      { x: 0.82, y: 0.68 },
      { x: 0.36, y: 0.62 },
    ];

    expect(polygonsIntersect(left, right)).toBe(true);
  });

  test("interpolates points across quad UV space", () => {
    const point = interpolateQuadPoint(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      0.25,
      0.75
    );

    expect(point.x).toBeCloseTo(0.25);
    expect(point.y).toBeCloseTo(0.75);
  });

  test("triangulates convex polygons without dropping area", () => {
    const polygon = [
      { x: 0.1, y: 0.1 },
      { x: 0.8, y: 0.1 },
      { x: 0.9, y: 0.6 },
      { x: 0.35, y: 0.85 },
    ];

    const triangles = triangulatePolygon(polygon);

    expect(triangles).toHaveLength(2);
    expect(new Set(triangles.flat())).toEqual(new Set([0, 1, 2, 3]));
  });

  test("triangulates concave polygons into valid triangle indices", () => {
    const polygon = [
      { x: 0.1, y: 0.15 },
      { x: 0.85, y: 0.1 },
      { x: 0.6, y: 0.45 },
      { x: 0.9, y: 0.85 },
      { x: 0.2, y: 0.8 },
    ];

    const triangles = triangulatePolygon(polygon);

    expect(triangles).toHaveLength(3);
    triangles.forEach((triangle) => {
      expect(triangle).toHaveLength(3);
      triangle.forEach((index) => {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(polygon.length);
      });
    });
  });

  test("subtracts an overlapping clip polygon into a notched visible surface loop", () => {
    const visibleLoops = subtractPolygonLoops(
      [
        { x: 0.2, y: 0.2 },
        { x: 0.9, y: 0.2 },
        { x: 0.85, y: 0.85 },
        { x: 0.15, y: 0.8 },
      ],
      [
        { x: 0.72, y: 0.15 },
        { x: 0.98, y: 0.28 },
        { x: 0.74, y: 0.6 },
      ]
    );

    expect(visibleLoops.length).toBe(1);
    expect(visibleLoops[0].length).toBeGreaterThan(4);
    expect(
      visibleLoops[0].some((point) => point.x > 0.72 && point.y > 0.2 && point.y < 0.62)
    ).toBe(true);
  });

  test("builds a stable render plan for global, local, paint and clip roles", () => {
    const project = createDefaultProject();
    const operations = buildRenderPlan(project);

    expect(operations[0].type).toBe("globalShader");
    expect(operations.some((operation) => operation.type === "shaderSurface")).toBe(true);
    expect(operations.some((operation) => operation.type === "paint")).toBe(true);
    expect(operations.some((operation) => operation.type === "maskCutter")).toBe(true);
    expect(operations.some((operation) => operation.type === "booleanCutterWithFill")).toBe(true);
  });

  test("summarizes only active cutters", () => {
    const project = createDefaultProject();
    const summary = buildInteractionSummary(project);

    expect(summary.length).toBeGreaterThanOrEqual(2);
    expect(summary.every((entry) => typeof entry.cutterType === "string")).toBe(true);
    expect(summary.some((entry) => entry.cutterType === "booleanCutterWithFill")).toBe(true);
  });

  test("reports shader fill for interaction-only cutters independent from shaderSurface role", () => {
    const project = createDefaultProject();
    const interactionOnlyElement = project.elements.find(
      (element) => !element.roles.clip && element.roles.interactionField
    );
    interactionOnlyElement.roles.shaderSurface = false;
    interactionOnlyElement.shaderBinding.enabled = false;

    const summary = buildInteractionSummary(project);
    const entry = summary.find((item) => item.elementId === interactionOnlyElement.id);

    expect(entry.cutterType).toBe("booleanCutterWithFill");
    expect(entry.hasShaderFill).toBe(true);
  });

  test("reports shader fill for interaction-only cutters when shader binding is enabled", () => {
    const project = createDefaultProject();
    const interactionOnlyElement = project.elements.find(
      (element) => !element.roles.clip && element.roles.interactionField
    );
    interactionOnlyElement.roles.shaderSurface = false;
    interactionOnlyElement.shaderBinding.enabled = true;

    const summary = buildInteractionSummary(project);
    const entry = summary.find((item) => item.elementId === interactionOnlyElement.id);

    expect(entry.cutterType).toBe("booleanCutterWithFill");
    expect(entry.hasShaderFill).toBe(true);
  });

  test("preserves cutter-mode classification in boundary summaries", () => {
    const project = createDefaultProject();
    const clipElement = project.elements.find((entry) => entry.roles.clip);
    clipElement.roles.interactionField = true;
    const summary = buildBoundarySummary(project);

    expect(summary.some((entry) => entry.cutterType === "booleanCutterNoFill")).toBe(true);
    expect(summary.some((entry) => entry.cutterType === "booleanCutterWithFill")).toBe(true);
  });
});
