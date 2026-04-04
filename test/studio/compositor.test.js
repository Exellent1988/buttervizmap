import { describe, expect, test } from "@jest/globals";
import {
  filterInteractionSummaryForGeometry,
  localizeInteractionSummaryToGeometry,
} from "../../studio/client/rendering/compositor.js";

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
});
