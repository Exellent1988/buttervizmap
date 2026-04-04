import {
  applySceneToProject,
  captureScene,
  createDefaultProject,
  createSceneElement,
  duplicatePresetEntry,
  normalizeProjectWithDiagnostics,
  normalizeSceneElement,
  parseProjectBundle,
  serializeProject,
} from "../../shared/project.js";

const AUTOSAVE_KEY = "buttervizmap.autosave.v1";

export class StudioStore {
  constructor(role = "admin") {
    this.role = role;
    this.listeners = new Set();
    this.state = {
      project: createDefaultProject(),
      selectedElementId: null,
      selectedSceneId: null,
      viewerCount: 0,
      connectionStatus: "offline",
      lastAudioFrame: null,
      autosaveStatus: role === "admin" ? "idle" : "disabled",
      lastSavedAt: null,
      projectDiagnostics: null,
      autosaveError: null,
    };

    if (role === "admin") {
      this.loadAutosave();
    }

    this.state.selectedElementId = this.state.project.elements[0]?.id ?? null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  emit() {
    this.listeners.forEach((listener) => listener(this.state));
  }

  setConnectionStatus(connectionStatus) {
    this.state.connectionStatus = connectionStatus;
    this.emit();
  }

  setViewerCount(viewerCount) {
    this.state.viewerCount = viewerCount;
    this.emit();
  }

  setAudioFrame(audioFrame) {
    this.state.lastAudioFrame = audioFrame;
  }

  setProject(project, options = {}) {
    const bundle = options.bundle ?? normalizeProjectWithDiagnostics(project, {
      source: options.source,
    });
    this.state.project = bundle.project;
    this.state.projectDiagnostics = bundle.diagnostics;
    if (!options.preserveSelection) {
      this.state.selectedElementId =
        this.state.project.elements[0]?.id ?? this.state.selectedElementId;
    }
    if (this.role === "admin" && options.skipAutosave !== true) {
      this.saveAutosave();
    }
    this.emit();
  }

  updateProject(updater) {
    const nextProject = updater(this.state.project);
    this.setProject({
      ...nextProject,
      meta: {
        ...nextProject.meta,
        updatedAt: new Date().toISOString(),
      },
    }, { preserveSelection: true });
  }

  loadAutosave() {
    const serializedProject = localStorage.getItem(AUTOSAVE_KEY);
    if (!serializedProject) {
      return;
    }

    try {
      const bundle = parseProjectBundle(serializedProject, { source: "autosave" });
      this.state.project = bundle.project;
      this.state.projectDiagnostics = bundle.diagnostics;
      this.state.autosaveStatus = "loaded";
    } catch (error) {
      this.state.autosaveStatus = "error";
      this.state.autosaveError = error instanceof Error ? error.message : String(error);
      console.warn("Failed to load ButterVizMap autosave", error);
    }
  }

  saveAutosave() {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serializeProject(this.state.project));
      this.state.autosaveStatus = "saved";
      this.state.lastSavedAt = new Date().toISOString();
      this.state.autosaveError = null;
    } catch (error) {
      this.state.autosaveStatus = "error";
      this.state.autosaveError = error instanceof Error ? error.message : String(error);
      console.warn("Failed to save ButterVizMap autosave", error);
    }
  }

  resetProject() {
    this.setProject(createDefaultProject());
  }

  importProject(serializedProject) {
    const bundle = parseProjectBundle(serializedProject, { source: "import" });
    this.setProject(bundle.project, { bundle });
  }

  exportProject() {
    return serializeProject(this.state.project);
  }

  addElement(kind = "quad") {
    const element = createSceneElement({
      name: kind === "quad" ? "Shader Surface" : "Polygon Field",
      geometry: { kind },
      zIndex:
        Math.max(-1, ...this.state.project.elements.map((entry) => entry.zIndex)) + 1,
    });

    this.updateProject((project) => ({
      ...project,
      elements: [...project.elements, element],
    }));
    this.state.selectedElementId = element.id;
    this.emit();
  }

  removeSelectedElement() {
    if (!this.state.selectedElementId) {
      return;
    }

    this.updateProject((project) => ({
      ...project,
      elements: project.elements.filter(
        (element) => element.id !== this.state.selectedElementId
      ),
    }));
    this.state.selectedElementId = this.state.project.elements[0]?.id ?? null;
    this.emit();
  }

  setSelectedElementId(elementId) {
    this.state.selectedElementId = elementId;
    this.emit();
  }

  updateElement(elementId, updater) {
    this.updateProject((project) => ({
      ...project,
      elements: project.elements.map((element) =>
        element.id === elementId ? normalizeSceneElement(updater(element)) : element
      ),
    }));
  }

  updateElementDirect(elementId, nextElement) {
    this.updateProject((project) => ({
      ...project,
      elements: project.elements.map((element) =>
        element.id === elementId ? nextElement : element
      ),
    }));
  }

  addScene(name) {
    this.updateProject((project) => ({
      ...project,
      scenes: [...project.scenes, captureScene(project, name)],
    }));
  }

  overwriteScene(sceneId) {
    this.updateProject((project) => ({
      ...project,
      scenes: project.scenes.map((scene) =>
        scene.id === sceneId ? captureScene(project, scene.name) : scene
      ),
    }));
  }

  recallScene(sceneId) {
    this.state.selectedSceneId = sceneId;
    this.setProject(applySceneToProject(this.state.project, sceneId), {
      preserveSelection: true,
    });
  }

  duplicatePreset(presetId) {
    this.setProject(duplicatePresetEntry(this.state.project, presetId), {
      preserveSelection: true,
    });
  }

  updatePreset(presetId, updater) {
    this.updateProject((project) => ({
      ...project,
      presetLibrary: {
        presets: project.presetLibrary.presets.map((preset) =>
          preset.id === presetId ? updater(preset) : preset
        ),
      },
    }));
  }
}
