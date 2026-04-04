import { createBuiltinLibraryEntries } from "./defaultPresets.js";
import { normalizeGeometry } from "./geometry.js";

const STORAGE_VERSION = 2;
const BLEND_MODES = new Set(["normal", "screen", "add", "multiply", "overlay"]);
const REACTION_MODES = new Set(["tint", "pulse", "warp", "glow", "reflect"]);
const BUILTIN_LIBRARY_ENTRIES = createBuiltinLibraryEntries();

function createId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createSceneElement(partial = {}) {
  return normalizeSceneElement({
    id: partial.id ?? createId("element"),
    name: partial.name ?? "New Element",
    enabled: partial.enabled ?? true,
    locked: partial.locked ?? false,
    zIndex: partial.zIndex ?? 0,
    geometry: partial.geometry,
    roles: partial.roles,
    style: partial.style,
    shaderBinding: partial.shaderBinding,
    interaction: partial.interaction,
  });
}

export function normalizeSceneElement(element = {}) {
  return {
    id: element.id ?? createId("element"),
    name: element.name ?? "Untitled Element",
    enabled: element.enabled !== false,
    locked: element.locked === true,
    zIndex: Number.isFinite(Number(element.zIndex)) ? Number(element.zIndex) : 0,
    geometry: normalizeGeometry(element.geometry),
    roles: {
      clip: element.roles?.clip === true,
      paint: element.roles?.paint === true,
      shaderSurface: element.roles?.shaderSurface === true,
      interactionField: element.roles?.interactionField !== false,
    },
    style: {
      color: element.style?.color ?? "#58d1c9",
      opacity: clampNumber(element.style?.opacity, 0.7, 0, 1),
      feather: clampNumber(element.style?.feather, 0.08, 0, 1),
    },
    shaderBinding: {
      presetId: element.shaderBinding?.presetId ?? "aurora-grid",
      opacity: clampNumber(element.shaderBinding?.opacity, 1, 0, 1),
      enabled: element.shaderBinding?.enabled !== false,
      blendMode: normalizeEnum(element.shaderBinding?.blendMode, BLEND_MODES, "screen"),
      scale: clampNumber(element.shaderBinding?.scale, 1, 0.25, 3),
      offsetX: clampNumber(element.shaderBinding?.offsetX, 0, -1, 1),
      offsetY: clampNumber(element.shaderBinding?.offsetY, 0, -1, 1),
      rotation: clampNumber(element.shaderBinding?.rotation, 0, -180, 180),
      interactionMix: clampNumber(element.shaderBinding?.interactionMix, 0.65, 0, 1),
      reactionMode: normalizeEnum(
        element.shaderBinding?.reactionMode,
        REACTION_MODES,
        "tint"
      ),
    },
    interaction: {
      alpha: clampNumber(element.interaction?.alpha, 0.65, 0, 1),
      color: element.interaction?.color ?? element.style?.color ?? "#58d1c9",
      distance: clampNumber(element.interaction?.distance, 0.5, 0, 1),
      enabled: element.interaction?.enabled !== false,
      pulse: clampNumber(element.interaction?.pulse, 0.55, 0, 1),
      swirl: clampNumber(element.interaction?.swirl, 0.35, 0, 1),
      influence: clampNumber(element.interaction?.influence, 0.7, 0, 1),
    },
  };
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function normalizeEnum(value, allowedValues, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  return allowedValues.has(value) ? value : fallback;
}

function clampInteger(value, fallback, min, max) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

export function createDefaultProject() {
  const elements = [
    createSceneElement({
      name: "Main Portal",
      zIndex: 1,
      geometry: {
        kind: "quad",
        points: [
          { x: 0.12, y: 0.12 },
          { x: 0.88, y: 0.1 },
          { x: 0.9, y: 0.88 },
          { x: 0.14, y: 0.9 },
        ],
      },
      roles: {
        clip: false,
        paint: false,
        shaderSurface: true,
        interactionField: true,
      },
      style: {
        color: "#4ad1d1",
        opacity: 0.72,
        feather: 0.05,
      },
      shaderBinding: {
        presetId: "nebula-pulse",
        opacity: 0.92,
        enabled: true,
      },
    }),
    createSceneElement({
      name: "Accent Wash",
      zIndex: 2,
      geometry: {
        kind: "polygon",
        points: [
          { x: 0.08, y: 0.66 },
          { x: 0.28, y: 0.52 },
          { x: 0.44, y: 0.92 },
        ],
      },
      roles: {
        clip: false,
        paint: true,
        shaderSurface: false,
        interactionField: true,
      },
      style: {
        color: "#ff7d45",
        opacity: 0.45,
        feather: 0.16,
      },
      interaction: {
        alpha: 0.6,
        color: "#ff7d45",
        distance: 0.75,
        enabled: true,
      },
    }),
    createSceneElement({
      name: "Negative Cutout",
      zIndex: 3,
      geometry: {
        kind: "polygon",
        points: [
          { x: 0.58, y: 0.22 },
          { x: 0.78, y: 0.28 },
          { x: 0.68, y: 0.56 },
        ],
      },
      roles: {
        clip: true,
        paint: false,
        shaderSurface: false,
        interactionField: false,
      },
      style: {
        color: "#ffffff",
        opacity: 1,
        feather: 0.04,
      },
    }),
  ];

  const project = {
    version: STORAGE_VERSION,
    meta: {
      id: createId("project"),
      name: "ButterVizMap Session",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    output: {
      width: 1280,
      height: 720,
      background: "#050816",
      rendering: {
        frameLimit: 45,
        canvasScale: 2,
        meshWidth: 48,
        meshHeight: 36,
      },
      presets: {
        cycleEnabled: false,
        cycleSeconds: 25,
        randomizeNextPreset: true,
        autoBlendSeconds: 2.7,
        userBlendSeconds: 5.7,
        lastChangeMode: "user",
      },
    },
    globalLayer: {
      enabled: true,
      presetId: "aurora-grid",
      opacity: 1,
      interactionMix: 0.5,
      drift: 0.08,
      scale: 1,
    },
    presetLibrary: {
      presets: BUILTIN_LIBRARY_ENTRIES.map((preset) => ({
        ...preset,
        overrides: { ...(preset.overrides ?? {}) },
        meta: { ...(preset.meta ?? {}) },
      })),
    },
    elements,
    scenes: [],
  };

  project.scenes = [
    captureScene(project, "Default"),
    captureScene(
      {
        ...project,
        globalLayer: {
          ...project.globalLayer,
          presetId: "solar-curtain",
        },
        elements: project.elements.map((element) =>
          element.name === "Main Portal"
            ? {
                ...element,
                shaderBinding: {
                  ...element.shaderBinding,
                  presetId: "aurora-grid",
                },
              }
            : element
        ),
      },
      "Warm Shift"
    ),
  ];

  return normalizeProject(project);
}

export function captureScene(project, name = "Scene") {
  return {
    id: createId("scene"),
    name,
    state: {
      globalLayer: { ...project.globalLayer },
      output: {
        background: project.output.background,
        rendering: { ...project.output.rendering },
        presets: { ...project.output.presets },
      },
      elements: project.elements.map((element) => ({
        id: element.id,
        enabled: element.enabled,
        locked: element.locked,
        zIndex: element.zIndex,
        roles: { ...element.roles },
        style: { ...element.style },
        shaderBinding: { ...element.shaderBinding },
        interaction: { ...element.interaction },
      })),
    },
  };
}

export function applySceneToProject(project, sceneId) {
  const scene = project.scenes.find((entry) => entry.id === sceneId);
  if (!scene) {
    return project;
  }

  const elementStateById = new Map(
    scene.state.elements.map((elementState) => [elementState.id, elementState])
  );

  return normalizeProject({
    ...project,
    meta: {
      ...project.meta,
      updatedAt: new Date().toISOString(),
    },
    output: {
      ...project.output,
      ...scene.state.output,
      rendering: {
        ...project.output.rendering,
        ...scene.state.output?.rendering,
      },
      presets: {
        ...project.output.presets,
        ...scene.state.output?.presets,
      },
    },
    globalLayer: { ...project.globalLayer, ...scene.state.globalLayer },
    elements: project.elements.map((element) => ({
      ...element,
      ...elementStateById.get(element.id),
      roles: {
        ...element.roles,
        ...elementStateById.get(element.id)?.roles,
      },
      style: {
        ...element.style,
        ...elementStateById.get(element.id)?.style,
      },
      shaderBinding: {
        ...element.shaderBinding,
        ...elementStateById.get(element.id)?.shaderBinding,
      },
      interaction: {
        ...element.interaction,
        ...elementStateById.get(element.id)?.interaction,
      },
    })),
  });
}

export function normalizeProject(project = {}) {
  return normalizeProjectWithDiagnostics(project).project;
}

function normalizePresetLibraryEntries(presets = []) {
  const mergedPresets = [];
  const byKey = new Map();

  BUILTIN_LIBRARY_ENTRIES.forEach((preset) => {
    const normalizedPreset = {
      ...preset,
      overrides: { ...(preset.overrides ?? {}) },
      meta: { ...(preset.meta ?? {}) },
    };
    const key = `${normalizedPreset.sourceType}:${normalizedPreset.sourcePresetId}`;
    byKey.set(key, normalizedPreset);
    mergedPresets.push(normalizedPreset);
  });

  presets.forEach((preset, index) => {
    const normalizedPreset = {
      id: preset.id ?? createId(`preset-${index}`),
      name: preset.name ?? `Preset ${index + 1}`,
      sourceType: preset.sourceType ?? "builtin",
      sourcePresetId: preset.sourcePresetId ?? "aurora-grid",
      overrides:
        preset.overrides && typeof preset.overrides === "object"
          ? { ...preset.overrides }
          : {},
      meta:
        preset.meta && typeof preset.meta === "object"
          ? { ...preset.meta }
          : {},
    };

    const key = `${normalizedPreset.sourceType}:${normalizedPreset.sourcePresetId}`;
    const existingPreset = byKey.get(key);
    if (existingPreset) {
      if (existingPreset.id && normalizedPreset.id && existingPreset.id !== normalizedPreset.id) {
        mergedPresets.push(normalizedPreset);
        return;
      }

      existingPreset.id = existingPreset.id ?? normalizedPreset.id;
      existingPreset.name = normalizedPreset.name ?? existingPreset.name;
      existingPreset.overrides = {
        ...existingPreset.overrides,
        ...normalizedPreset.overrides,
      };
      existingPreset.meta = {
        ...normalizedPreset.meta,
        ...existingPreset.meta,
      };
      return;
    }

    byKey.set(key, normalizedPreset);
    mergedPresets.push(normalizedPreset);
  });

  return mergedPresets;
}

function collectMissingSections(project) {
  const missingSections = [];

  if (!project.output || typeof project.output !== "object") {
    missingSections.push("output");
  }
  if (!project.output?.rendering || typeof project.output.rendering !== "object") {
    missingSections.push("output.rendering");
  }
  if (!project.output?.presets || typeof project.output.presets !== "object") {
    missingSections.push("output.presets");
  }
  if (!project.globalLayer || typeof project.globalLayer !== "object") {
    missingSections.push("globalLayer");
  }
  if (!project.presetLibrary || !Array.isArray(project.presetLibrary.presets)) {
    missingSections.push("presetLibrary.presets");
  }

  return missingSections;
}

function createProjectDiagnostics({
  source = "runtime",
  sourceVersion = STORAGE_VERSION,
  missingSections = [],
}) {
  return {
    source,
    sourceVersion,
    normalizedVersion: STORAGE_VERSION,
    migrated: sourceVersion !== STORAGE_VERSION || missingSections.length > 0,
    missingSections,
    builtinPresetCount: BUILTIN_LIBRARY_ENTRIES.length,
    normalizedAt: new Date().toISOString(),
  };
}

export function normalizeProjectWithDiagnostics(project = {}, options = {}) {
  const sourceVersion = Number(project.version ?? 0) || 0;
  const missingSections = collectMissingSections(project);
  const normalized = {
    version: STORAGE_VERSION,
    meta: {
      id: project.meta?.id ?? createId("project"),
      name: project.meta?.name ?? "ButterVizMap Session",
      createdAt: project.meta?.createdAt ?? new Date().toISOString(),
      updatedAt: project.meta?.updatedAt ?? new Date().toISOString(),
    },
    output: {
      width: clampNumber(project.output?.width, 1280, 320, 8192),
      height: clampNumber(project.output?.height, 720, 180, 8192),
      background: project.output?.background ?? "#050816",
      rendering: {
        frameLimit: clampInteger(project.output?.rendering?.frameLimit, 45, 15, 120),
        canvasScale: clampNumber(project.output?.rendering?.canvasScale, 2, 0.5, 2),
        meshWidth: clampInteger(project.output?.rendering?.meshWidth, 48, 8, 128),
        meshHeight: clampInteger(project.output?.rendering?.meshHeight, 36, 6, 96),
      },
      presets: {
        cycleEnabled: project.output?.presets?.cycleEnabled === true,
        cycleSeconds: clampNumber(project.output?.presets?.cycleSeconds, 25, 5, 300),
        randomizeNextPreset: project.output?.presets?.randomizeNextPreset !== false,
        autoBlendSeconds: clampNumber(
          project.output?.presets?.autoBlendSeconds,
          2.7,
          0,
          20
        ),
        userBlendSeconds: clampNumber(
          project.output?.presets?.userBlendSeconds,
          5.7,
          0,
          20
        ),
        lastChangeMode: project.output?.presets?.lastChangeMode === "auto" ? "auto" : "user",
      },
    },
    globalLayer: {
      enabled: project.globalLayer?.enabled !== false,
      presetId: project.globalLayer?.presetId ?? "aurora-grid",
      opacity: clampNumber(project.globalLayer?.opacity, 1, 0, 1),
      interactionMix: clampNumber(project.globalLayer?.interactionMix, 0.5, 0, 1),
      drift: clampNumber(project.globalLayer?.drift, 0.08, 0, 0.4),
      scale: clampNumber(project.globalLayer?.scale, 1, 0.8, 1.5),
    },
    presetLibrary: {
      presets: normalizePresetLibraryEntries(project.presetLibrary?.presets),
    },
    elements: Array.isArray(project.elements)
      ? project.elements.map(normalizeSceneElement)
      : [],
    scenes: Array.isArray(project.scenes)
      ? project.scenes.map((scene) => ({
          id: scene.id ?? createId("scene"),
          name: scene.name ?? "Scene",
          state: {
            globalLayer: { ...scene.state?.globalLayer },
            output: {
              background: scene.state?.output?.background,
              rendering: { ...scene.state?.output?.rendering },
              presets: { ...scene.state?.output?.presets },
            },
            elements: Array.isArray(scene.state?.elements)
              ? scene.state.elements.map((element) => ({
                  id: element.id,
                  enabled: element.enabled !== false,
                  locked: element.locked === true,
                  zIndex: Number(element.zIndex ?? 0),
                  roles: { ...element.roles },
                  style: { ...element.style },
                  shaderBinding: { ...element.shaderBinding },
                  interaction: { ...element.interaction },
                }))
              : [],
          },
        }))
      : [],
  };

  return {
    project: normalized,
    diagnostics: createProjectDiagnostics({
      source: options.source,
      sourceVersion,
      missingSections,
    }),
  };
}

export function mergePresetLibraryCatalog(project, catalogPresets = []) {
  const normalizedProject = normalizeProject(project);
  if (!Array.isArray(catalogPresets) || !catalogPresets.length) {
    return normalizedProject;
  }

  const existingByKey = new Map(
    normalizedProject.presetLibrary.presets.map((preset) => [
      `${preset.sourceType}:${preset.sourcePresetId}`,
      preset,
    ])
  );

  const mergedPresets = [...normalizedProject.presetLibrary.presets];
  catalogPresets.forEach((catalogPreset, index) => {
    const normalizedCatalogPreset = {
      id: catalogPreset.id ?? createId(`catalog-${index}`),
      name: catalogPreset.name ?? `Catalog Preset ${index + 1}`,
      sourceType: catalogPreset.sourceType ?? "file",
      sourcePresetId: catalogPreset.sourcePresetId ?? catalogPreset.id ?? "unknown.json",
      overrides: catalogPreset.overrides ?? {},
      meta:
        catalogPreset.meta && typeof catalogPreset.meta === "object"
          ? { ...catalogPreset.meta }
          : {},
    };
    const key = `${normalizedCatalogPreset.sourceType}:${normalizedCatalogPreset.sourcePresetId}`;
    const existing = existingByKey.get(key);

    if (existing) {
      existing.name = existing.name ?? normalizedCatalogPreset.name;
      existing.meta = {
        ...normalizedCatalogPreset.meta,
        ...existing.meta,
      };
      return;
    }

    mergedPresets.push(normalizedCatalogPreset);
    existingByKey.set(key, normalizedCatalogPreset);
  });

  return normalizeProject({
    ...normalizedProject,
    presetLibrary: {
      presets: mergedPresets,
    },
  });
}

function collectReferencedPresetIds(project) {
  const referencedPresetIds = new Set();

  if (project.globalLayer?.presetId) {
    referencedPresetIds.add(project.globalLayer.presetId);
  }

  project.elements?.forEach((element) => {
    if (element.shaderBinding?.presetId) {
      referencedPresetIds.add(element.shaderBinding.presetId);
    }
  });

  project.scenes?.forEach((scene) => {
    if (scene.state?.globalLayer?.presetId) {
      referencedPresetIds.add(scene.state.globalLayer.presetId);
    }

    scene.state?.elements?.forEach((elementState) => {
      if (elementState.shaderBinding?.presetId) {
        referencedPresetIds.add(elementState.shaderBinding.presetId);
      }
    });
  });

  return referencedPresetIds;
}

export function createSyncProject(project) {
  const normalizedProject = normalizeProject(project);
  const referencedPresetIds = collectReferencedPresetIds(normalizedProject);

  return normalizeProject({
    ...normalizedProject,
    presetLibrary: {
      presets: normalizedProject.presetLibrary.presets.filter(
        (preset) =>
          preset.sourceType !== "file" ||
          referencedPresetIds.has(preset.id) ||
          referencedPresetIds.has(preset.sourcePresetId)
      ),
    },
  });
}

export function duplicatePresetEntry(project, presetId) {
  const preset = project.presetLibrary.presets.find((entry) => entry.id === presetId);
  if (!preset) {
    return project;
  }

  return normalizeProject({
    ...project,
    meta: {
      ...project.meta,
      updatedAt: new Date().toISOString(),
    },
    presetLibrary: {
      presets: [
        ...project.presetLibrary.presets,
        {
          ...preset,
          id: createId("preset"),
          name: `${preset.name} Copy`,
          overrides: typeof structuredClone === "function"
            ? structuredClone(preset.overrides)
            : JSON.parse(JSON.stringify(preset.overrides)),
        },
      ],
    },
  });
}

export function serializeProject(project) {
  return JSON.stringify(normalizeProject(project), null, 2);
}

export function parseProject(serializedProject) {
  return parseProjectBundle(serializedProject).project;
}

export function parseProjectBundle(serializedProject, options = {}) {
  const rawProject =
    typeof serializedProject === "string"
      ? JSON.parse(serializedProject)
      : serializedProject;
  return normalizeProjectWithDiagnostics(rawProject, options);
}
