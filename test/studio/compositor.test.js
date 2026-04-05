import { describe, expect, test } from "@jest/globals";
import {
  applyBooleanCutSequence,
  buildTargetCutStateForTarget,
  buildFillExecutionPlanForTarget,
  getSurfaceDomainGeometry,
  mapDomainPointToSurfacePoint,
} from "../../studio/client/rendering/compositor.js";

describe("studio compositor geometry cuts", () => {
  test("subtracts an enclosed boolean cutter as a hole in the target geometry", () => {
    const loops = applyBooleanCutSequence({
      geometry: {
        kind: "quad",
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.9, y: 0.9 },
          { x: 0.1, y: 0.9 },
        ],
      },
      cutters: [
        {
          kind: "polygon",
          points: [
            { x: 0.42, y: 0.32 },
            { x: 0.68, y: 0.34 },
            { x: 0.56, y: 0.62 },
          ],
        },
      ],
    });

    expect(loops.length).toBe(2);
    expect(loops.some((loop) => loop.length === 4)).toBe(true);
    expect(loops.some((loop) => loop.length === 3)).toBe(true);
  });

  test("applies multiple boolean cutters sequentially", () => {
    const loops = applyBooleanCutSequence({
      geometry: {
        kind: "quad",
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.9, y: 0.9 },
          { x: 0.1, y: 0.9 },
        ],
      },
      cutters: [
        {
          kind: "polygon",
          points: [
            { x: 0.42, y: 0.24 },
            { x: 0.68, y: 0.32 },
            { x: 0.56, y: 0.64 },
          ],
        },
        {
          kind: "polygon",
          points: [
            { x: 0.12, y: 0.52 },
            { x: 0.34, y: 0.56 },
            { x: 0.28, y: 0.82 },
          ],
        },
      ],
    });

    expect(loops.length).toBe(3);
    expect(loops.filter((loop) => loop.length === 3)).toHaveLength(2);
    expect(loops.some((loop) => loop.length === 4)).toBe(true);
  });

  test("returns no visible loops when cutters fully remove the target", () => {
    const loops = applyBooleanCutSequence({
      geometry: {
        kind: "quad",
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.8, y: 0.2 },
          { x: 0.8, y: 0.8 },
          { x: 0.2, y: 0.8 },
        ],
      },
      cutters: [
        {
          kind: "quad",
          points: [
            { x: 0.1, y: 0.1 },
            { x: 0.9, y: 0.1 },
            { x: 0.9, y: 0.9 },
            { x: 0.1, y: 0.9 },
          ],
        },
      ],
    });

    expect(loops).toHaveLength(0);
  });
});

describe("studio compositor fill planning", () => {
  const targetGeometry = {
    kind: "quad",
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ],
  };

  test("plans an interaction-only cutter with shader as erase+fill", () => {
    const steps = buildFillExecutionPlanForTarget({
      targetGeometry,
      cutters: [
        {
          elementId: "i1",
          cutterType: "booleanCutterWithFill",
          shaderSurfaceEnabled: true,
          geometry: {
            kind: "polygon",
            points: [
              { x: 0.42, y: 0.24 },
              { x: 0.68, y: 0.32 },
              { x: 0.56, y: 0.64 },
            ],
          },
        },
      ],
    });

    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe("eraseAndFill");
  });

  test("plans an interaction-only cutter as erase+fill even when shader flag is false", () => {
    const steps = buildFillExecutionPlanForTarget({
      targetGeometry,
      cutters: [
        {
          elementId: "i1",
          cutterType: "booleanCutterWithFill",
          shaderSurfaceEnabled: false,
          geometry: {
            kind: "polygon",
            points: [
              { x: 0.42, y: 0.24 },
              { x: 0.68, y: 0.32 },
              { x: 0.56, y: 0.64 },
            ],
          },
        },
      ],
    });

    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe("eraseAndFill");
  });

  test("plans clip+interaction cutters as erase-only", () => {
    const steps = buildFillExecutionPlanForTarget({
      targetGeometry,
      cutters: [
        {
          elementId: "c1",
          cutterType: "booleanCutterNoFill",
          shaderSurfaceEnabled: false,
          geometry: {
            kind: "polygon",
            points: [
              { x: 0.42, y: 0.24 },
              { x: 0.68, y: 0.32 },
              { x: 0.56, y: 0.64 },
            ],
          },
        },
      ],
    });

    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe("eraseOnly");
  });
});

describe("studio compositor target cut state", () => {
  const targetGeometry = {
    kind: "quad",
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ],
  };

  test("separates mask cutters from boolean events and preserves event order", () => {
    const state = buildTargetCutStateForTarget({
      targetGeometry,
      cutters: [
        {
          elementId: "mask",
          cutterType: "maskCutter",
          shaderSurfaceEnabled: false,
          geometry: {
            kind: "polygon",
            points: [
              { x: 0.18, y: 0.2 },
              { x: 0.34, y: 0.22 },
              { x: 0.28, y: 0.46 },
            ],
          },
        },
        {
          elementId: "bool-no-fill",
          cutterType: "booleanCutterNoFill",
          shaderSurfaceEnabled: true,
          geometry: {
            kind: "polygon",
            points: [
              { x: 0.42, y: 0.24 },
              { x: 0.68, y: 0.32 },
              { x: 0.56, y: 0.64 },
            ],
          },
        },
        {
          elementId: "bool-fill",
          cutterType: "booleanCutterWithFill",
          shaderSurfaceEnabled: true,
          geometry: {
            kind: "polygon",
            points: [
              { x: 0.22, y: 0.6 },
              { x: 0.44, y: 0.58 },
              { x: 0.4, y: 0.82 },
            ],
          },
        },
      ],
    });

    expect(state.maskCutters).toHaveLength(1);
    expect(state.maskCutters[0].elementId).toBe("mask");
    expect(state.fillEvents).toHaveLength(2);
    expect(state.fillEvents.map((event) => event.kind)).toEqual(["eraseOnly", "eraseAndFill"]);
    expect(state.fillEvents.map((event) => event.cutter.elementId)).toEqual([
      "bool-no-fill",
      "bool-fill",
    ]);
  });

  test("tracks enclosed boolean cuts as hole entries", () => {
    const state = buildTargetCutStateForTarget({
      targetGeometry,
      cutters: [
        {
          elementId: "hole-cutter",
          cutterType: "booleanCutterNoFill",
          shaderSurfaceEnabled: false,
          geometry: {
            kind: "polygon",
            points: [
              { x: 0.42, y: 0.32 },
              { x: 0.68, y: 0.34 },
              { x: 0.56, y: 0.62 },
            ],
          },
        },
      ],
    });

    expect(state.visibleLoopEntries.some((entry) => entry.hole)).toBe(true);
    expect(state.visibleLoopEntries.some((entry) => !entry.hole)).toBe(true);
  });
});

describe("studio compositor surface mapping", () => {
  test("maps polygon surface domains onto the square boundary", () => {
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

  test("maps domain points near the boundary back onto the visible surface edge", () => {
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
});
