import { describe, expect, test } from "@jest/globals";
import {
  applySceneToProject,
  createDefaultProject,
  duplicatePresetEntry,
  mergePresetLibraryCatalog,
  parseProjectBundle,
  parseProject,
  serializeProject,
  normalizeSceneElement,
} from "../../studio/shared/project.js";

describe("studio project model", () => {
  test("creates a default project with roles, presets and scenes", () => {
    const project = createDefaultProject();

    expect(project.version).toBe(3);
    expect(project.elements.length).toBeGreaterThanOrEqual(3);
    expect(project.presetLibrary.presets.length).toBeGreaterThanOrEqual(6);
    expect(project.scenes.length).toBeGreaterThanOrEqual(2);
    expect(project.elements[0].roles.shaderSurface).toBe(true);
    expect(project.elements[0].shaderBinding.blendMode).toBe("screen");
    expect(project.elements[0].style.feather).toBeUndefined();
    expect(project.elements[0].shaderBinding.reactionMode).toBeUndefined();
    expect(project.elements[0].shaderBinding.interactionMix).toBeUndefined();
    expect(project.globalLayer.interactionMix).toBeUndefined();
    expect(project.output.rendering.frameLimit).toBe(45);
    expect(project.output.rendering.meshWidth).toBe(48);
    expect(project.output.presets.userBlendSeconds).toBeCloseTo(5.7);
    expect(
      project.presetLibrary.presets.find((preset) => preset.id === "solid-color")?.meta
        ?.category
    ).toBe("special");
    expect(project.version).toBe(3);
  });

  test("serializes and parses project files without losing the scene structure", () => {
    const project = createDefaultProject();
    const parsed = parseProject(serializeProject(project));

    expect(parsed.meta.name).toBe(project.meta.name);
    expect(parsed.elements).toHaveLength(project.elements.length);
    expect(parsed.scenes.map((scene) => scene.name)).toEqual(
      project.scenes.map((scene) => scene.name)
    );
  });

  test("recalls a scene by applying stored layer state", () => {
    const project = createDefaultProject();
    project.output.rendering.frameLimit = 60;
    project.output.presets.cycleEnabled = true;
    const alternateScene = project.scenes.find((scene) => scene.name === "Warm Shift");
    const recalled = applySceneToProject(project, alternateScene.id);

    expect(recalled.globalLayer.presetId).toBe("solar-curtain");
    expect(
      recalled.elements.find((element) => element.name === "Main Portal").shaderBinding
        .presetId
    ).toBe("aurora-grid");
    expect(recalled.output.rendering.frameLimit).toBe(45);
    expect(recalled.output.presets.cycleEnabled).toBe(false);
  });

  test("duplicates library presets as standalone entries", () => {
    const project = createDefaultProject();
    const nextProject = duplicatePresetEntry(project, project.presetLibrary.presets[0].id);

    expect(nextProject.presetLibrary.presets).toHaveLength(
      project.presetLibrary.presets.length + 1
    );
    expect(nextProject.presetLibrary.presets.at(-1).name).toMatch(/Copy$/);
  });

  test("merges remote preset catalogs into older projects without dropping built-ins", () => {
    const project = createDefaultProject();
    const trimmedProject = {
      ...project,
      presetLibrary: {
        presets: project.presetLibrary.presets.slice(0, 2),
      },
    };

    const merged = mergePresetLibraryCatalog(trimmedProject, [
      {
        id: "file-sample.json",
        name: "Sample Remote",
        sourceType: "file",
        sourcePresetId: "sample.json",
        meta: { pack: "butterchurn-presets" },
      },
    ]);

    expect(merged.presetLibrary.presets.find((preset) => preset.id === "solid-color")).toBeTruthy();
    expect(
      merged.presetLibrary.presets.find(
        (preset) => preset.sourceType === "file" && preset.sourcePresetId === "sample.json"
      )
    ).toBeTruthy();
  });

  test("parses older projects with migration diagnostics and backfills missing sections", () => {
    const bundle = parseProjectBundle(
      JSON.stringify({
        version: 1,
        meta: { name: "Legacy Session" },
        output: {
          width: 1024,
          height: 576,
        },
        presetLibrary: {
          presets: [],
        },
        elements: [],
      }),
      { source: "test-import" }
    );

    expect(bundle.project.version).toBe(3);
    expect(bundle.project.output.rendering.frameLimit).toBe(45);
    expect(bundle.project.output.presets.userBlendSeconds).toBeCloseTo(5.7);
    expect(bundle.project.presetLibrary.presets.find((preset) => preset.id === "solid-color")).toBeTruthy();
    expect(bundle.diagnostics.migrated).toBe(true);
    expect(bundle.diagnostics.missingSections).toEqual(
      expect.arrayContaining(["output.rendering", "output.presets", "globalLayer"])
    );
  });

  test("drops legacy interaction fields from imported elements", () => {
    const bundle = parseProjectBundle({
      elements: [
        {
          geometry: { kind: "quad" },
          style: {
            feather: 0.4,
          },
          shaderBinding: {
            interactionMix: 0.7,
            reactionMode: "reflect",
          },
          interaction: {
            alpha: 0.1,
            influence: 0.1,
          },
        },
      ],
      globalLayer: {
        interactionMix: 0.8,
        drift: 0.2,
      },
      output: {
        rendering: {
          interactionEngine: "renderer",
        },
      },
    });

    expect(bundle.project.elements[0].style.feather).toBeUndefined();
    expect(bundle.project.elements[0].shaderBinding.interactionMix).toBeUndefined();
    expect(bundle.project.elements[0].shaderBinding.reactionMode).toBeUndefined();
    expect(bundle.project.elements[0].interaction).toBeUndefined();
    expect(bundle.project.elements[0].roles.interactionField).toBe(false);
    expect(bundle.project.globalLayer.interactionMix).toBeUndefined();
    expect(bundle.project.globalLayer.drift).toBeUndefined();
    expect(bundle.project.output.rendering.interactionEngine).toBeUndefined();
  });

  test("defaults interactionField to false when roles are omitted", () => {
    const element = normalizeSceneElement({
      geometry: { kind: "quad" },
    });

    expect(element.roles.interactionField).toBe(false);
  });
});
