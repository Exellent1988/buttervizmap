import { describe, expect, test } from "@jest/globals";
import {
  buildBoundarySummary,
  buildInteractionSummary,
  buildRenderPlan,
} from "../../studio/shared/composition.js";
import {
  distanceToPolygonEdge,
  interpolateQuadPoint,
  normalizeGeometry,
  pointInPolygon,
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

  test("builds a stable render plan for global, local, paint and clip roles", () => {
    const project = createDefaultProject();
    const operations = buildRenderPlan(project);

    expect(operations[0].type).toBe("globalShader");
    expect(operations.some((operation) => operation.type === "shaderSurface")).toBe(true);
    expect(operations.some((operation) => operation.type === "paint")).toBe(true);
    expect(operations.some((operation) => operation.type === "clip")).toBe(true);
    expect(operations.some((operation) => operation.type === "interactionField")).toBe(true);
  });

  test("summarizes only active interaction fields", () => {
    const project = createDefaultProject();
    const summary = buildInteractionSummary(project);

    expect(summary.length).toBeGreaterThanOrEqual(2);
    expect(summary.every((entry) => typeof entry.alpha === "number")).toBe(true);
    expect(summary.some((entry) => entry.color === "#ff7d45")).toBe(true);
  });

  test("includes clip elements in the boundary summary", () => {
    const project = createDefaultProject();
    const summary = buildBoundarySummary(project);

    expect(summary.some((entry) => entry.sourceRole === "clip")).toBe(true);
    expect(summary.some((entry) => entry.sourceRole === "interactionField")).toBe(true);
  });
});
