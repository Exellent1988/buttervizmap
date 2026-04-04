import { describe, expect, test } from "@jest/globals";
import {
  applySceneToProject,
  createDefaultProject,
  duplicatePresetEntry,
  mergePresetLibraryCatalog,
  parseProject,
  serializeProject,
} from "../../studio/shared/project.js";

describe("studio project model", () => {
  test("creates a default project with roles, presets and scenes", () => {
    const project = createDefaultProject();

    expect(project.version).toBe(1);
    expect(project.elements.length).toBeGreaterThanOrEqual(3);
    expect(project.presetLibrary.presets.length).toBeGreaterThanOrEqual(6);
    expect(project.scenes.length).toBeGreaterThanOrEqual(2);
    expect(project.elements[0].roles.shaderSurface).toBe(true);
    expect(project.elements[0].shaderBinding.blendMode).toBe("screen");
    expect(project.elements[0].interaction.influence).toBeGreaterThan(0);
    expect(project.globalLayer.interactionMix).toBeGreaterThan(0);
    expect(project.output.rendering.frameLimit).toBe(45);
    expect(project.output.rendering.meshWidth).toBe(48);
    expect(project.output.presets.userBlendSeconds).toBeCloseTo(5.7);
    expect(
      project.presetLibrary.presets.find((preset) => preset.id === "solid-color")?.meta
        ?.category
    ).toBe("special");
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
    const alternateScene = project.scenes.find((scene) => scene.name === "Warm Shift");
    const recalled = applySceneToProject(project, alternateScene.id);

    expect(recalled.globalLayer.presetId).toBe("solar-curtain");
    expect(
      recalled.elements.find((element) => element.name === "Main Portal").shaderBinding
        .presetId
    ).toBe("aurora-grid");
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
});
