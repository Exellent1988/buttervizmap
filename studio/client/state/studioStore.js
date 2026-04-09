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
const HISTORY_LIMIT = 50;

function cloneStateValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export class StudioStore {
  constructor(role = "admin") {
    this.role = role;
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
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
      canUndo: false,
      canRedo: false,
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

  getHistoryEntry() {
    return {
      project: cloneStateValue(this.state.project),
      selectedElementId: this.state.selectedElementId,
      selectedSceneId: this.state.selectedSceneId,
    };
  }

  syncHistoryFlags() {
    this.state.canUndo = this.undoStack.length > 0;
    this.state.canRedo = this.redoStack.length > 0;
  }

  pushUndoSnapshot() {
    this.undoStack.push(this.getHistoryEntry());
    if (this.undoStack.length > HISTORY_LIMIT) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.syncHistoryFlags();
  }

  restoreHistoryEntry(entry) {
    const bundle = normalizeProjectWithDiagnostics(entry.project, {
      source: "history",
    });
    this.state.project = bundle.project;
    this.state.projectDiagnostics = bundle.diagnostics;
    this.state.selectedElementId =
      entry.selectedElementId ?? bundle.project.elements[0]?.id ?? null;
    this.state.selectedSceneId = entry.selectedSceneId ?? null;
    if (this.role === "admin") {
      this.saveAutosave();
    }
    this.syncHistoryFlags();
    this.emit();
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) {
      return false;
    }

    this.redoStack.push(this.getHistoryEntry());
    this.restoreHistoryEntry(entry);
    return true;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) {
      return false;
    }

    this.undoStack.push(this.getHistoryEntry());
    this.restoreHistoryEntry(entry);
    return true;
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
    if (options.recordHistory === true) {
      this.pushUndoSnapshot();
    }

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
    this.syncHistoryFlags();
    this.emit();
  }

  updateProject(updater, options = {}) {
    const nextProject = updater(this.state.project);
    this.setProject({
      ...nextProject,
      meta: {
        ...nextProject.meta,
        updatedAt: new Date().toISOString(),
      },
    }, { preserveSelection: true, recordHistory: true, ...options });
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
    this.setProject(createDefaultProject(), { recordHistory: true });
  }

  importProject(serializedProject) {
    const bundle = parseProjectBundle(serializedProject, { source: "import" });
    this.setProject(bundle.project, { bundle, recordHistory: true });
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

  updateElement(elementId, updater, options = {}) {
    this.updateProject((project) => ({
      ...project,
      elements: project.elements.map((element) =>
        element.id === elementId ? normalizeSceneElement(updater(element)) : element
      ),
    }), options);
  }

  updateElementDirect(elementId, nextElement, options = {}) {
    this.updateProject((project) => ({
      ...project,
      elements: project.elements.map((element) =>
        element.id === elementId ? nextElement : element
      ),
    }), options);
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
      recordHistory: true,
    });
  }

  duplicatePreset(presetId) {
    this.setProject(duplicatePresetEntry(this.state.project, presetId), {
      preserveSelection: true,
      recordHistory: true,
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
