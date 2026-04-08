import {
  mergePresetLibraryCatalog,
  normalizeSceneElement,
} from "../../shared/project.js";
import { buildInteractionSummary } from "../../shared/composition.js";
import {
  getPolygonBounds,
  pointInPolygon,
} from "../../shared/geometry.js";
import { DemoAudioSource, MicrophoneAudioSource } from "../audio/frameSource.js";
import { StudioCompositor } from "../rendering/compositor.js";

const UI_STATE_KEY = "buttervizmap.ui.v1";

function formatRoles(element) {
  return Object.entries(element.roles)
    .filter(([, enabled]) => enabled)
    .map(([role]) => role)
    .join(", ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function makeTitle(text) {
  return ` title="${escapeHtml(text)}" `;
}

function formatDateTime(value) {
  if (!value) {
    return "never";
  }

  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return String(value);
  }
}

function formatList(values = []) {
  if (!values.length) {
    return "none";
  }

  return values.join(", ");
}

export class AdminApp {
  constructor({ root, store, sessionSocket, sessionId, lanAddress, publicOrigin }) {
    this.root = root;
    this.store = store;
    this.sessionSocket = sessionSocket;
    this.sessionId = sessionId;
    this.lanAddress = lanAddress;
    this.publicOrigin = publicOrigin;
    this.pointerState = null;
    this.selectedPointIndex = null;
    this.audioSource = new DemoAudioSource();
    this.audioMode = "demo";
    this.projectSyncHandle = null;
    this.compositor = null;
    this.overlayCanvas = null;
    this.overlayContext = null;
    this.presetSearchQuery = "";
    this.presetFilter = "starter";
    this.panelRefreshHandle = null;
    this.nextRenderAt = 0;
    this.nextAutoPresetAt = 0;
    this.availablePresetCatalog = [];
    this.availablePresetSummary = null;
    this.catalogLoadError = null;
    this.debugOverlayMode = "off";
    this.favoritePresetIds = [];
    this.recentPresetIds = [];
    this.hoverElementId = null;
  }

  mount() {
    this.loadUIPreferences();
    this.root.innerHTML = `
      <aside class="panel">
        <div class="hero-card">
          <h1>ButterVizMap Studio</h1>
          <p>Mask-driven mapping surfaces, interaction fields, scene recall and LAN output in one workspace.</p>
        </div>
        <div class="panel-body panel-stack">
          <section id="session-panel"></section>
          <section id="element-list"></section>
          <section id="scene-list"></section>
          <section id="debug-panel"></section>
        </div>
      </aside>
      <main class="panel preview-panel">
        <div class="panel-header">
          <h2>Preview</h2>
          <div class="chip-row">
            <span class="chip">Global + local shader composition</span>
            <span class="chip">Clip / paint / interaction roles</span>
          </div>
        </div>
        <div class="preview-shell">
          <div class="preview-stack">
            <canvas id="preview-canvas"></canvas>
            <canvas id="overlay-canvas"></canvas>
            <div class="overlay-hint">Click elements to select them, drag a surface to move it, drag a point to reshape it.</div>
          </div>
        </div>
        <div class="status-bar" id="status-bar"></div>
      </main>
      <aside class="panel">
        <div class="panel-header">
          <h2>Inspector</h2>
          <div class="chip-row">
            <span class="chip">Geometry + roles + scene data</span>
          </div>
        </div>
        <div class="panel-body panel-stack" id="inspector-panel"></div>
      </aside>
    `;

    this.previewCanvas = this.root.querySelector("#preview-canvas");
    this.overlayCanvas = this.root.querySelector("#overlay-canvas");
    this.overlayContext = this.overlayCanvas.getContext("2d");
    this.compositor = new StudioCompositor(this.previewCanvas);

    this.bindOverlayEvents();
    this.bindKeyboardEvents();
    this.bindUIEvents();
    this.loadAvailablePresets();

    this.store.subscribe((state) => {
      const selectedElement = this.getSelectedElement();
      if (
        !selectedElement ||
        this.selectedPointIndex == null ||
        this.selectedPointIndex >= selectedElement.geometry.points.length
      ) {
        this.selectedPointIndex = null;
      }

      this.render(state);
      this.scheduleProjectSync(state.project);
    });

    const loop = async (timestamp) => {
      const frameInterval = 1000 / this.store.state.project.output.rendering.frameLimit;
      if (timestamp < this.nextRenderAt) {
        requestAnimationFrame(loop);
        return;
      }
      this.nextRenderAt = timestamp + frameInterval;

      this.maybeAdvanceAutoPreset(timestamp);
      const audioFrame = this.audioSource.getFrame();
      this.store.setAudioFrame(audioFrame);
      this.sessionSocket.sendAudioFrame(audioFrame);
      this.compositor.setAudioFrame(audioFrame);
      await this.compositor.render(timestamp);
      this.renderOverlay(this.store.state);
      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }

  async loadAvailablePresets() {
    try {
      const response = await fetch("/api/presets");
      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      this.availablePresetCatalog = Array.isArray(payload.presets) ? payload.presets : [];
      this.availablePresetSummary = payload.summary ?? null;
      this.catalogLoadError = null;
      this.applyPresetCatalog();
    } catch (error) {
      this.catalogLoadError = error instanceof Error ? error.message : String(error);
      console.warn("Failed to load preset catalog", error);
    }
  }

  loadUIPreferences() {
    try {
      const rawPreferences = localStorage.getItem(UI_STATE_KEY);
      if (!rawPreferences) {
        return;
      }

      const preferences = JSON.parse(rawPreferences);
      this.presetSearchQuery =
        typeof preferences.presetSearchQuery === "string"
          ? preferences.presetSearchQuery
          : this.presetSearchQuery;
      this.presetFilter =
        typeof preferences.presetFilter === "string"
          ? preferences.presetFilter
          : this.presetFilter;
      this.debugOverlayMode =
        typeof preferences.debugOverlayMode === "string"
          ? preferences.debugOverlayMode
          : preferences.showDebugOverlays
            ? "interaction"
            : "off";
      this.favoritePresetIds = Array.isArray(preferences.favoritePresetIds)
        ? preferences.favoritePresetIds
        : [];
      this.recentPresetIds = Array.isArray(preferences.recentPresetIds)
        ? preferences.recentPresetIds.slice(0, 8)
        : [];
    } catch (error) {
      console.warn("Failed to load ButterVizMap UI preferences", error);
    }
  }

  saveUIPreferences() {
    try {
      localStorage.setItem(
        UI_STATE_KEY,
        JSON.stringify({
          presetSearchQuery: this.presetSearchQuery,
          presetFilter: this.presetFilter,
          debugOverlayMode: this.debugOverlayMode,
          favoritePresetIds: this.favoritePresetIds,
          recentPresetIds: this.recentPresetIds,
        })
      );
    } catch (error) {
      console.warn("Failed to save ButterVizMap UI preferences", error);
    }
  }

  isFavoritePreset(presetId) {
    return this.favoritePresetIds.includes(presetId);
  }

  toggleFavoritePreset(presetId) {
    if (this.isFavoritePreset(presetId)) {
      this.favoritePresetIds = this.favoritePresetIds.filter((entry) => entry !== presetId);
    } else {
      this.favoritePresetIds = [...this.favoritePresetIds, presetId];
    }
    this.saveUIPreferences();
    this.render(this.store.state);
  }

  pushRecentPreset(presetId) {
    this.recentPresetIds = [presetId, ...this.recentPresetIds.filter((entry) => entry !== presetId)].slice(0, 8);
    this.saveUIPreferences();
  }

  applyPresetCatalog() {
    if (!this.availablePresetCatalog.length) {
      return;
    }

    this.store.updateProject((project) =>
      mergePresetLibraryCatalog(project, this.availablePresetCatalog)
    );
  }

  mergePresetCatalogIntoProject(project) {
    if (!this.availablePresetCatalog.length) {
      return project;
    }

    return mergePresetLibraryCatalog(project, this.availablePresetCatalog);
  }

  scheduleProjectSync(project) {
    clearTimeout(this.projectSyncHandle);
    this.projectSyncHandle = setTimeout(() => {
      this.sessionSocket.sendProject(project);
    }, 120);
  }

  getSelectableGlobalPresets() {
    return this.store.state.project.presetLibrary.presets.filter(
      (preset) => preset.sourceType !== "solid" || preset.id === "solid-color"
    );
  }

  pickNextGlobalPreset() {
    const presets = this.getSelectableGlobalPresets();
    if (!presets.length) {
      return null;
    }

    const currentIndex = presets.findIndex(
      (preset) => preset.id === this.store.state.project.globalLayer.presetId
    );

    if (this.store.state.project.output.presets.randomizeNextPreset) {
      const pool = presets.filter(
        (preset) => preset.id !== this.store.state.project.globalLayer.presetId
      );
      return pool[Math.floor(Math.random() * pool.length)] ?? presets[0];
    }

    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % presets.length : 0;
    return presets[nextIndex];
  }

  maybeAdvanceAutoPreset(timestamp) {
    const presetSettings = this.store.state.project.output.presets;
    if (!presetSettings.cycleEnabled) {
      this.nextAutoPresetAt = timestamp + presetSettings.cycleSeconds * 1000;
      return;
    }

    if (!this.nextAutoPresetAt) {
      this.nextAutoPresetAt = timestamp + presetSettings.cycleSeconds * 1000;
      return;
    }

    if (timestamp < this.nextAutoPresetAt) {
      return;
    }

    const nextPreset = this.pickNextGlobalPreset();
    if (nextPreset) {
      this.pushRecentPreset(nextPreset.id);
      this.store.updateProject((project) => ({
        ...project,
        globalLayer: {
          ...project.globalLayer,
          presetId: nextPreset.id,
        },
        elements: project.elements.map((element) => ({
          ...element,
          shaderBinding: {
            ...element.shaderBinding,
            presetId: nextPreset.id,
          },
        })),
        output: {
          ...project.output,
          presets: {
            ...project.output.presets,
            lastChangeMode: "auto",
          },
        },
      }));
    }

    this.nextAutoPresetAt = timestamp + presetSettings.cycleSeconds * 1000;
  }

  async switchAudioMode(mode) {
    if (mode === "microphone") {
      const source = new MicrophoneAudioSource();
      await source.start();
      this.audioSource = source;
      this.audioMode = "microphone";
      this.render(this.store.state);
      return;
    }

    this.audioSource = new DemoAudioSource();
    this.audioMode = "demo";
    this.render(this.store.state);
  }

  getOutputUrl() {
    return `${this.publicOrigin || location.origin}/output/${this.sessionId}`;
  }

  getLanHintUrl() {
    return `${location.protocol}//${this.lanAddress}:${location.port}/output/${this.sessionId}`;
  }

  getCanvasPoint(event) {
    const rect = this.overlayCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  }

  getSelectedElement() {
    return this.store.state.project.elements.find(
      (element) => element.id === this.store.state.selectedElementId
    );
  }

  updateSelectedElement(nextElement) {
    this.store.updateElementDirect(nextElement.id, normalizeSceneElement(nextElement));
  }

  findTopmostElementAtPoint(point) {
    return [...this.store.state.project.elements]
      .filter((element) => element.enabled && pointInPolygon(point, element.geometry.points))
      .sort((left, right) => right.zIndex - left.zIndex)[0];
  }

  findPointHitIndex(element, point) {
    return element.geometry.points.findIndex(
      (candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) < 0.04
    );
  }

  bindOverlayEvents() {
    this.overlayCanvas.addEventListener("dblclick", (event) => {
      const point = this.getCanvasPoint(event);
      const selectedElement = this.getSelectedElement();
      if (
        !selectedElement ||
        selectedElement.geometry.kind !== "polygon" ||
        !pointInPolygon(point, selectedElement.geometry.points)
      ) {
        return;
      }

      this.updateSelectedElement({
        ...selectedElement,
        geometry: {
          ...selectedElement.geometry,
          points: [...selectedElement.geometry.points, point],
        },
      });
      this.selectedPointIndex = selectedElement.geometry.points.length;
    });

    this.overlayCanvas.addEventListener("pointerdown", (event) => {
      const point = this.getCanvasPoint(event);
      const selectedElement = this.getSelectedElement();
      const pointIndex = selectedElement
        ? this.findPointHitIndex(selectedElement, point)
        : -1;

      if (pointIndex >= 0) {
        this.selectedPointIndex = pointIndex;
        this.pointerState = {
          type: "point",
          elementId: selectedElement.id,
          pointIndex,
        };
        this.overlayCanvas.setPointerCapture(event.pointerId);
        return;
      }

      const hitElement = this.findTopmostElementAtPoint(point);
      if (!hitElement) {
        this.selectedPointIndex = null;
        return;
      }

      this.store.setSelectedElementId(hitElement.id);
      this.selectedPointIndex = null;
      this.pointerState = {
        type: "element",
        elementId: hitElement.id,
        startPoint: point,
        originalPoints: hitElement.geometry.points.map((entry) => ({ ...entry })),
      };
      this.overlayCanvas.setPointerCapture(event.pointerId);
    });

    this.overlayCanvas.addEventListener("pointermove", (event) => {
      const hoverPoint = this.getCanvasPoint(event);
      this.hoverElementId = this.findTopmostElementAtPoint(hoverPoint)?.id ?? null;
      if (!this.pointerState) {
        this.renderOverlay(this.store.state);
        return;
      }

      const point = hoverPoint;
      const element = this.store.state.project.elements.find(
        (entry) => entry.id === this.pointerState.elementId
      );
      if (!element) {
        return;
      }

      if (this.pointerState.type === "point") {
        const points = element.geometry.points.map((candidate, index) =>
          index === this.pointerState.pointIndex ? point : candidate
        );
        this.updateSelectedElement({
          ...element,
          geometry: {
            ...element.geometry,
            points,
          },
        });
        return;
      }

      const dx = point.x - this.pointerState.startPoint.x;
      const dy = point.y - this.pointerState.startPoint.y;
      const points = this.pointerState.originalPoints.map((originalPoint) => ({
        x: Math.max(0, Math.min(1, originalPoint.x + dx)),
        y: Math.max(0, Math.min(1, originalPoint.y + dy)),
      }));
      this.updateSelectedElement({
        ...element,
        geometry: {
          ...element.geometry,
          points,
        },
      });
    });

    const clearPointerState = () => {
      this.pointerState = null;
    };

    this.overlayCanvas.addEventListener("pointerup", clearPointerState);
    this.overlayCanvas.addEventListener("pointercancel", clearPointerState);
    this.overlayCanvas.addEventListener("pointerleave", () => {
      this.hoverElementId = null;
      this.renderOverlay(this.store.state);
    });
  }

  bindKeyboardEvents() {
    window.addEventListener("keydown", (event) => {
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        return;
      }

      if (
        event.target instanceof HTMLElement &&
        ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)
      ) {
        return;
      }

      const selectedElement = this.getSelectedElement();
      if (!selectedElement) {
        return;
      }

      event.preventDefault();
      const step = event.shiftKey ? 0.02 : 0.005;
      if (this.selectedPointIndex == null) {
        const movedPoints = selectedElement.geometry.points.map((point) => ({
          x: Math.max(0, Math.min(1, point.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0))),
          y: Math.max(0, Math.min(1, point.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0))),
        }));
        this.updateSelectedElement({
          ...selectedElement,
          geometry: {
            ...selectedElement.geometry,
            points: movedPoints,
          },
        });
        return;
      }
      const delta =
        event.key === "ArrowUp"
          ? { x: 0, y: -step }
          : event.key === "ArrowDown"
            ? { x: 0, y: step }
            : event.key === "ArrowLeft"
              ? { x: -step, y: 0 }
              : { x: step, y: 0 };

      const points = selectedElement.geometry.points.map((point, index) =>
        index === this.selectedPointIndex
          ? {
              x: Math.max(0, Math.min(1, point.x + delta.x)),
              y: Math.max(0, Math.min(1, point.y + delta.y)),
            }
          : point
      );

      this.updateSelectedElement({
        ...selectedElement,
        geometry: {
          ...selectedElement.geometry,
          points,
        },
      });
    });
  }

  renderOverlay(state) {
    const width = this.previewCanvas.width;
    const height = this.previewCanvas.height;
    if (!width || !height) {
      return;
    }

    if (this.overlayCanvas.width !== width || this.overlayCanvas.height !== height) {
      this.overlayCanvas.width = width;
      this.overlayCanvas.height = height;
    }

    this.overlayContext.clearRect(0, 0, width, height);
    const compositorDebugState = this.compositor?.getDebugState?.() ?? {};
    const visibleSurfaceDebugEntries = compositorDebugState.visibleSurfaceGeometries ?? [];
    const visibleSurfaceDebugByElement = new Map(
      visibleSurfaceDebugEntries.map((entry) => [entry.elementId, entry])
    );
    state.project.elements.forEach((element) => {
      const selected = element.id === state.selectedElementId;
      const hovered = element.id === this.hoverElementId;
      this.overlayContext.beginPath();
      element.geometry.points.forEach((point, index) => {
        const x = point.x * width;
        const y = point.y * height;
        if (index === 0) {
          this.overlayContext.moveTo(x, y);
        } else {
          this.overlayContext.lineTo(x, y);
        }
      });
      this.overlayContext.closePath();

      if (selected) {
        this.overlayContext.fillStyle = "rgba(255, 142, 80, 0.12)";
        this.overlayContext.fill();
      } else if (hovered) {
        this.overlayContext.fillStyle = "rgba(95, 208, 200, 0.08)";
        this.overlayContext.fill();
      }

      this.overlayContext.strokeStyle = selected
        ? "#ff8e50"
        : hovered
          ? "rgba(255, 225, 123, 0.92)"
          : "rgba(95, 208, 200, 0.7)";
      this.overlayContext.lineWidth = selected ? 3.5 : hovered ? 2.5 : 2;
      this.overlayContext.stroke();

      element.geometry.points.forEach((point, index) => {
        const x = point.x * width;
        const y = point.y * height;
        const selectedPoint = selected && index === this.selectedPointIndex;

        this.overlayContext.beginPath();
        this.overlayContext.fillStyle = selectedPoint
          ? "#ffe17b"
          : selected
            ? "#ff8e50"
            : "#5fd0c8";
        this.overlayContext.arc(x, y, selectedPoint ? 8 : selected ? 7 : 5, 0, Math.PI * 2);
        this.overlayContext.fill();

        if (selectedPoint) {
          this.overlayContext.strokeStyle = "#08111a";
          this.overlayContext.lineWidth = 2;
          this.overlayContext.stroke();
        }

        this.overlayContext.fillStyle = "#08111a";
        this.overlayContext.font = "12px IBM Plex Mono";
        this.overlayContext.fillText(`${index + 1}`, x + 8, y - 8);
      });
    });

    if (["interaction", "all"].includes(this.debugOverlayMode)) {
      buildInteractionSummary(state.project).forEach((field) => {
        const labelByType = {
          maskCutter: "mask",
          booleanCutterNoFill: "bool cut",
          booleanCutterWithFill: field.hasShaderFill ? "bool+shader" : "bool",
        };
        const strokeByType = {
          maskCutter: "rgba(255, 225, 123, 0.9)",
          booleanCutterNoFill: "rgba(255, 132, 80, 0.92)",
          booleanCutterWithFill: "rgba(95, 208, 200, 0.92)",
        };
        const firstPoint = field.geometry.points[0];

        this.overlayContext.save();
        this.overlayContext.beginPath();
        field.geometry.points.forEach((point, index) => {
          const x = point.x * width;
          const y = point.y * height;
          if (index === 0) {
            this.overlayContext.moveTo(x, y);
          } else {
            this.overlayContext.lineTo(x, y);
          }
        });
        this.overlayContext.closePath();
        this.overlayContext.strokeStyle = strokeByType[field.cutterType] ?? "rgba(255, 225, 123, 0.85)";
        this.overlayContext.setLineDash([6, 5]);
        this.overlayContext.lineWidth = 1.5;
        this.overlayContext.stroke();
        this.overlayContext.setLineDash([]);
        this.overlayContext.fillStyle = "#ffe17b";
        this.overlayContext.font = "11px IBM Plex Mono";
        this.overlayContext.fillText(
          labelByType[field.cutterType] ?? field.cutterType,
          firstPoint.x * width + 8,
          firstPoint.y * height + 14
        );
        this.overlayContext.restore();
      });
    }

    if (!["surface", "all"].includes(this.debugOverlayMode)) {
      return;
    }

    state.project.elements
      .filter((element) => element.roles.shaderSurface)
      .forEach((element) => {
        const bounds = getPolygonBounds(element.geometry.points);
        const selected = element.id === state.selectedElementId;
        const visibleSurfaceDebug = visibleSurfaceDebugByElement.get(element.id);

        this.overlayContext.save();
        this.overlayContext.strokeStyle = selected
          ? "rgba(255, 142, 80, 0.45)"
          : "rgba(95, 208, 200, 0.35)";
        this.overlayContext.setLineDash([10, 6]);
        this.overlayContext.lineWidth = 1.5;
        this.overlayContext.strokeRect(
          bounds.minX * width,
          bounds.minY * height,
          Math.max(1, (bounds.maxX - bounds.minX) * width),
          Math.max(1, (bounds.maxY - bounds.minY) * height)
        );
        this.overlayContext.setLineDash([]);
        this.overlayContext.fillStyle = selected ? "#ff8e50" : "#5fd0c8";
        this.overlayContext.font = "11px IBM Plex Mono";
        this.overlayContext.fillText(
          `${element.geometry.kind} local bounds`,
          bounds.minX * width + 8,
          bounds.minY * height + 14
        );
        this.overlayContext.restore();

        visibleSurfaceDebug?.clipGeometries?.forEach((clipGeometry, clipIndex) => {
          this.overlayContext.save();
          this.overlayContext.beginPath();
          clipGeometry.points.forEach((point, index) => {
            const x = point.x * width;
            const y = point.y * height;
            if (index === 0) {
              this.overlayContext.moveTo(x, y);
            } else {
              this.overlayContext.lineTo(x, y);
            }
          });
          this.overlayContext.closePath();
          this.overlayContext.strokeStyle = "rgba(255, 110, 110, 0.8)";
          this.overlayContext.setLineDash([5, 4]);
          this.overlayContext.lineWidth = 1.5;
          this.overlayContext.stroke();
          this.overlayContext.setLineDash([]);
          this.overlayContext.fillStyle = "rgba(255, 140, 140, 0.95)";
          this.overlayContext.font = "11px IBM Plex Mono";
          this.overlayContext.fillText(
            `clip ${clipIndex + 1}`,
            clipGeometry.points[0].x * width + 8,
            clipGeometry.points[0].y * height + 14
          );
          this.overlayContext.restore();
        });

        visibleSurfaceDebug?.visibleGeometries?.forEach((geometry, visibleIndex) => {
          this.overlayContext.save();
          this.overlayContext.beginPath();
          geometry.points.forEach((point, index) => {
            const x = point.x * width;
            const y = point.y * height;
            if (index === 0) {
              this.overlayContext.moveTo(x, y);
            } else {
              this.overlayContext.lineTo(x, y);
            }
          });
          this.overlayContext.closePath();
          this.overlayContext.strokeStyle = selected
            ? "rgba(255, 142, 80, 0.95)"
            : "rgba(95, 208, 200, 0.95)";
          this.overlayContext.lineWidth = 2.5;
          this.overlayContext.stroke();
          this.overlayContext.fillStyle = selected ? "#ffb084" : "#8ce8e1";
          this.overlayContext.font = "11px IBM Plex Mono";
          this.overlayContext.fillText(
            `visible ${visibleIndex + 1}`,
            geometry.points[0].x * width + 8,
            geometry.points[0].y * height - 8
          );
          this.overlayContext.restore();
        });
      });
  }

  bindUIEvents() {
    this.root.addEventListener("click", async (event) => {
      const target = event.target.closest("button, [data-select-element]");
      if (!target) {
        return;
      }

      if (target.dataset.selectElement) {
        this.selectedPointIndex = null;
        this.store.setSelectedElementId(target.dataset.selectElement);
        return;
      }

      if (target.id === "add-quad") {
        this.selectedPointIndex = null;
        this.store.addElement("quad");
        return;
      }

      if (target.id === "add-polygon") {
        this.selectedPointIndex = null;
        this.store.addElement("polygon");
        return;
      }

      if (target.id === "remove-element") {
        this.selectedPointIndex = null;
        this.store.removeSelectedElement();
        return;
      }

      if (target.id === "reset-project") {
        this.selectedPointIndex = null;
        this.store.resetProject();
        this.applyPresetCatalog();
        return;
      }

      if (target.id === "open-output") {
        window.open(`/output/${this.sessionId}`, "_blank", "noopener,noreferrer");
        return;
      }

      if (target.id === "export-project") {
        const blob = new Blob([this.store.exportProject()], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "buttervizmap-project.json";
        anchor.click();
        URL.revokeObjectURL(url);
        return;
      }

      if (target.id === "scene-create") {
        const name = prompt("Scene name", `Scene ${this.store.state.project.scenes.length + 1}`);
        if (name) {
          this.store.addScene(name);
        }
        return;
      }

      if (target.dataset.recallScene) {
        const sceneId = target.dataset.recallScene;
        this.selectedPointIndex = null;
        this.store.recallScene(sceneId);
        this.sessionSocket.sendSceneRecall(sceneId);
        return;
      }

      if (target.dataset.overwriteScene) {
        this.store.overwriteScene(target.dataset.overwriteScene);
        return;
      }

      if (target.dataset.duplicatePreset) {
        this.store.duplicatePreset(target.dataset.duplicatePreset);
        return;
      }

      if (target.dataset.favoritePreset) {
        this.toggleFavoritePreset(target.dataset.favoritePreset);
        return;
      }

      if (target.dataset.focusPoint != null) {
        this.selectedPointIndex = Number(target.dataset.focusPoint);
        this.renderOverlay(this.store.state);
        return;
      }

      if (target.dataset.removePoint != null) {
        const selectedElement = this.getSelectedElement();
        if (
          !selectedElement ||
          selectedElement.geometry.kind === "quad" ||
          selectedElement.geometry.points.length <= 3
        ) {
          return;
        }

        const pointIndex = Number(target.dataset.removePoint);
        const points = selectedElement.geometry.points.filter(
          (_, index) => index !== pointIndex
        );
        this.selectedPointIndex =
          this.selectedPointIndex === pointIndex ? null : this.selectedPointIndex;
        this.updateSelectedElement({
          ...selectedElement,
          geometry: {
            ...selectedElement.geometry,
            points,
          },
        });
      }
    });

    this.root.addEventListener("input", (event) => {
      this.handleLiveInput(event.target);
    });

    this.root.addEventListener("change", async (event) => {
      await this.handleCommittedChange(event.target);
    });
  }

  handleLiveInput(target) {
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.id === "preset-search") {
      this.presetSearchQuery = target.value;
      this.saveUIPreferences();
      this.render(this.store.state);
      return;
    }

    if (target.id === "global-opacity") {
      this.store.updateProject((project) => ({
        ...project,
        globalLayer: {
          ...project.globalLayer,
          opacity: Number(target.value),
        },
      }));
      return;
    }

    if (
      [
        "preset-cycle-seconds",
        "preset-auto-blend-seconds",
        "preset-user-blend-seconds",
      ].includes(target.id)
    ) {
      const fieldMap = {
        "preset-cycle-seconds": "cycleSeconds",
        "preset-auto-blend-seconds": "autoBlendSeconds",
        "preset-user-blend-seconds": "userBlendSeconds",
      };
      this.store.updateProject((project) => ({
        ...project,
        output: {
          ...project.output,
          presets: {
            ...project.output.presets,
            [fieldMap[target.id]]: Number(target.value),
          },
        },
      }));
      return;
    }

    if (
      [
        "render-frame-limit",
        "render-canvas-scale",
        "render-mesh-width",
        "render-mesh-height",
      ].includes(target.id)
    ) {
      const fieldMap = {
        "render-frame-limit": "frameLimit",
        "render-canvas-scale": "canvasScale",
        "render-mesh-width": "meshWidth",
        "render-mesh-height": "meshHeight",
      };
      this.store.updateProject((project) => ({
        ...project,
        output: {
          ...project.output,
          rendering: {
            ...project.output.rendering,
            [fieldMap[target.id]]: Number(target.value),
          },
        },
      }));
      return;
    }

    const selectedElement = this.getSelectedElement();
    if (!selectedElement) {
      return;
    }

    if (target.id === "element-name") {
      this.updateSelectedElement({
        ...selectedElement,
        name: target.value,
      });
      return;
    }

    if (target.id === "element-zindex") {
      this.updateSelectedElement({
        ...selectedElement,
        zIndex: Number(target.value),
      });
      return;
    }

    if (target.id === "element-color") {
      this.updateSelectedElement({
        ...selectedElement,
        style: {
          ...selectedElement.style,
          color: target.value,
        },
      });
      this.schedulePanelRefresh();
      return;
    }

    if (target.id === "element-opacity") {
      this.updateSelectedElement({
        ...selectedElement,
        style: {
          ...selectedElement.style,
          opacity: Number(target.value),
        },
      });
      return;
    }

    if (
      ["shader-opacity", "shader-scale", "shader-offset-x", "shader-offset-y", "shader-rotation"].includes(
        target.id
      )
    ) {
      const fieldMap = {
        "shader-opacity": "opacity",
        "shader-scale": "scale",
        "shader-offset-x": "offsetX",
        "shader-offset-y": "offsetY",
        "shader-rotation": "rotation",
      };
      this.updateSelectedElement({
        ...selectedElement,
        shaderBinding: {
          ...selectedElement.shaderBinding,
          [fieldMap[target.id]]: Number(target.value),
        },
      });
      return;
    }

    if (target.dataset.pointIndex != null) {
      const pointIndex = Number(target.dataset.pointIndex);
      const axis = target.dataset.axis;
      this.selectedPointIndex = pointIndex;
      const points = selectedElement.geometry.points.map((point, index) =>
        index === pointIndex ? { ...point, [axis]: Number(target.value) } : point
      );
      this.updateSelectedElement({
        ...selectedElement,
        geometry: {
          ...selectedElement.geometry,
          points,
        },
      });
    }
  }

  async handleCommittedChange(target) {
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.id === "import-project") {
      const file = target.files?.[0];
      if (!file) {
        return;
      }
      const text = await file.text();
      this.selectedPointIndex = null;
      this.store.importProject(text);
      this.applyPresetCatalog();
      target.value = "";
      return;
    }

    if (target.id === "audio-mode") {
      await this.switchAudioMode(target.value);
      return;
    }

    if (target.id === "preset-filter") {
      this.presetFilter = target.value;
      this.saveUIPreferences();
      this.render(this.store.state);
      return;
    }

    if (target.id === "debug-overlay-mode") {
      this.debugOverlayMode = target.value;
      this.saveUIPreferences();
      this.render(this.store.state);
      return;
    }

    if (target.id === "preset-cycle-enabled" || target.id === "preset-randomize-next") {
      const fieldMap = {
        "preset-cycle-enabled": "cycleEnabled",
        "preset-randomize-next": "randomizeNextPreset",
      };
      this.store.updateProject((project) => ({
        ...project,
        output: {
          ...project.output,
          presets: {
            ...project.output.presets,
            [fieldMap[target.id]]: target.checked,
          },
        },
      }));
      return;
    }

    const selectedElement = this.getSelectedElement();
    if (!selectedElement) {
      return;
    }

    if (target.id === "element-preset") {
      this.pushRecentPreset(target.value);
      this.store.updateProject((project) => ({
        ...project,
        elements: project.elements.map((element) =>
          element.id === selectedElement.id
            ? normalizeSceneElement({
                ...element,
                shaderBinding: {
                  ...element.shaderBinding,
                  presetId: target.value,
                },
              })
            : element
        ),
        output: {
          ...project.output,
          presets: {
            ...project.output.presets,
            lastChangeMode: "user",
          },
        },
      }));
      return;
    }

    if (target.id === "shader-blend-mode") {
      this.updateSelectedElement({
        ...selectedElement,
        shaderBinding: {
          ...selectedElement.shaderBinding,
          blendMode: target.value,
        },
      });
      return;
    }

    if (target.id?.startsWith("role-")) {
      const role = target.id.replace("role-", "");
      this.updateSelectedElement({
        ...selectedElement,
        roles: {
          ...selectedElement.roles,
          [role]: target.checked,
        },
      });
    }
  }

  schedulePanelRefresh() {
    clearTimeout(this.panelRefreshHandle);
    this.panelRefreshHandle = setTimeout(() => {
      this.render(this.store.state);
    }, 0);
  }

  getPresetMeta(preset) {
    const rawName = preset.name ?? preset.sourcePresetId ?? preset.id;
    const author =
      preset.meta?.author ??
      (preset.sourceType === "file"
        ? rawName.split(/\s+-\s+/)[0].split(",")[0].trim() || "Repo"
        : "Studio");

    return {
      ...preset.meta,
      author,
      category:
        preset.meta?.category ??
        (preset.sourceType === "solid"
          ? "special"
          : preset.sourceType === "builtin"
            ? "studio"
            : "repo"),
    };
  }

  getStarterPresetIds(presets) {
    const starterIds = new Set(
      presets
        .filter((preset) => preset.sourceType !== "file" || preset.meta?.curated)
        .map((preset) => preset.id)
    );

    const filePresets = presets.filter((preset) => preset.sourceType === "file");
    filePresets
      .filter((preset) => preset.meta?.parityTarget)
      .slice(0, 6)
      .forEach((preset) => starterIds.add(preset.id));
    const keywordGroups = [
      "spiral",
      "wave",
      "bass",
      "plasma",
      "tunnel",
      "liquid",
      "rot",
      "scope",
      "flower",
    ];

    keywordGroups.forEach((keyword) => {
      const match = filePresets.find((preset) => {
        const haystack = `${preset.name} ${preset.sourcePresetId}`.toLowerCase();
        return haystack.includes(keyword) && !starterIds.has(preset.id);
      });
      if (match) {
        starterIds.add(match.id);
      }
    });

    const seenAuthors = new Set();
    filePresets.forEach((preset) => {
      if (starterIds.size >= 16) {
        return;
      }
      const author = this.getPresetMeta(preset).author;
      if (!seenAuthors.has(author)) {
        starterIds.add(preset.id);
        seenAuthors.add(author);
      }
    });

    return starterIds;
  }

  getRecentPresetEntries(presets) {
    return this.recentPresetIds
      .map((presetId) => presets.find((preset) => preset.id === presetId))
      .filter(Boolean);
  }

  getVisiblePresetEntries(presets) {
    const starterIds = this.getStarterPresetIds(presets);
    const query = this.presetSearchQuery.trim().toLowerCase();

    return presets
      .filter((preset) => {
        if (this.presetFilter === "starter" && !starterIds.has(preset.id)) {
          return false;
        }
        if (this.presetFilter === "solid" && preset.sourceType !== "solid") {
          return false;
        }
        if (this.presetFilter === "studio" && preset.sourceType !== "builtin") {
          return false;
        }
        if (this.presetFilter === "repo" && preset.sourceType !== "file") {
          return false;
        }
        if (this.presetFilter === "favorites" && !this.isFavoritePreset(preset.id)) {
          return false;
        }
        if (this.presetFilter === "recent" && !this.recentPresetIds.includes(preset.id)) {
          return false;
        }
        if (!query) {
          return true;
        }
        const meta = this.getPresetMeta(preset);
        return `${preset.name} ${preset.sourcePresetId} ${meta.author}`
          .toLowerCase()
          .includes(query);
      })
      .sort((left, right) => {
        if (this.isFavoritePreset(left.id) !== this.isFavoritePreset(right.id)) {
          return this.isFavoritePreset(left.id) ? -1 : 1;
        }
        return left.name.localeCompare(right.name, "en");
      });
  }

  renderPresetOptions(presets, selectedPresetId) {
    const groups = [
      {
        label: "Special",
        entries: presets.filter((preset) => preset.sourceType === "solid"),
      },
      {
        label: "Studio Built-ins",
        entries: presets.filter((preset) => preset.sourceType === "builtin"),
      },
      {
        label: "Butterchurn Catalog",
        entries: presets.filter(
          (preset) => preset.sourceType === "file" && preset.meta?.pack === "butterchurn-presets"
        ),
      },
      {
        label: "Repo Fallbacks",
        entries: presets.filter(
          (preset) => preset.sourceType === "file" && preset.meta?.pack !== "butterchurn-presets"
        ),
      },
    ].filter((group) => group.entries.length > 0);

    return groups
      .map(
        (group) => `
          <optgroup label="${escapeHtml(group.label)}">
            ${group.entries
              .map(
                (preset) => `
                  <option value="${preset.id}" ${
                    preset.id === selectedPresetId ? "selected" : ""
                  }>${escapeHtml(preset.name)}</option>
                `
              )
              .join("")}
          </optgroup>
        `
      )
      .join("");
  }

  shouldPreservePanel(selector, colorInputId) {
    const panel = this.root.querySelector(selector);
    const activeElement = document.activeElement;
    return (
      panel &&
      activeElement instanceof HTMLInputElement &&
      activeElement.type === "color" &&
      activeElement.id === colorInputId &&
      panel.contains(activeElement)
    );
  }

  render(state) {
    this.compositor?.setProject(state.project);

    const selectedElement = this.getSelectedElement();
    const visiblePresetEntries = this.getVisiblePresetEntries(
      state.project.presetLibrary.presets
    );
    const outputUrl = this.getOutputUrl();
    const lanHintUrl = this.getLanHintUrl();
    const debugState = this.compositor?.getDebugState?.() ?? {};
    const socketDebugState = this.sessionSocket?.getDebugState?.() ?? {};
    const projectDiagnostics = state.projectDiagnostics ?? {};
    const catalogSummary =
      this.availablePresetSummary ?? debugState.presetCatalogSummary ?? null;
    const visibleSurfaceSummary =
      debugState.visibleSurfaceGeometries?.length
        ? debugState.visibleSurfaceGeometries
            .map(
              (entry) =>
                `${entry.elementName ?? entry.elementId}:${entry.visibleGeometries?.length ?? 0}`
            )
            .join(", ")
        : "none";
    const sessionMarkup = `
      <div class="panel-header">
        <h3>Session</h3>
        <span class="tag">Status <strong>${escapeHtml(state.connectionStatus)}</strong></span>
      </div>
      <div class="field-grid">
        <div class="chip-row">
          <span class="chip">Session <span class="code">${escapeHtml(this.sessionId)}</span></span>
          <span class="chip">${state.viewerCount} viewer(s)</span>
          <span class="chip">${state.project.presetLibrary.presets.length} presets available</span>
        </div>
        <div class="field-grid compact">
          <label ${makeTitle("Automatically advances the shader preset across all shader-surface elements after the configured interval.")}>
            <span>Cycle presets</span>
            <input id="preset-cycle-enabled" type="checkbox" ${state.project.output.presets.cycleEnabled ? "checked" : ""} />
          </label>
          <label ${makeTitle("When cycling presets automatically, choose the next one randomly instead of sequentially.")}>
            <span>Randomize next</span>
            <input id="preset-randomize-next" type="checkbox" ${state.project.output.presets.randomizeNextPreset ? "checked" : ""} />
          </label>
          <label ${makeTitle("Interval used when automatic preset cycling is enabled.")}>
            Cycle seconds
            <input id="preset-cycle-seconds" type="number" min="5" max="300" step="1" value="${state.project.output.presets.cycleSeconds}" />
          </label>
          <label ${makeTitle("Blend duration used when presets change automatically through cycling.")}>
            Auto blend seconds
            <input id="preset-auto-blend-seconds" type="number" min="0" max="20" step="0.1" value="${state.project.output.presets.autoBlendSeconds}" />
          </label>
          <label ${makeTitle("Blend duration used when you manually change a preset in the studio UI.")}>
            Manual blend seconds
            <input id="preset-user-blend-seconds" type="number" min="0" max="20" step="0.1" value="${state.project.output.presets.userBlendSeconds}" />
          </label>
          <label ${makeTitle("Master opacity multiplier applied to all rendered elements in the output.")}>
            Global opacity
            <input id="global-opacity" type="number" min="0" max="1" step="0.05" value="${state.project.globalLayer.opacity}" />
          </label>
          <label ${makeTitle("Limits the admin and output render loops to a target frame rate.")}>
            Frame limit
            <select id="render-frame-limit">
              ${[15, 24, 30, 45, 60, 75, 90, 120]
                .map(
                  (value) => `
                    <option value="${value}" ${
                      value === state.project.output.rendering.frameLimit ? "selected" : ""
                    }>${value}</option>
                  `
                )
                .join("")}
            </select>
          </label>
          <label ${makeTitle("Controls Butterchurn texture resolution relative to the output canvas. Higher values look better but cost more GPU time.")}>
            Canvas size
            <select id="render-canvas-scale">
              ${[
                { value: 0.5, label: "0.5X Native" },
                { value: 1, label: "1X Native" },
                { value: 1.5, label: "1.5X Native" },
                { value: 2, label: "2X Native" },
              ]
                .map(
                  (entry) => `
                    <option value="${entry.value}" ${
                      entry.value === state.project.output.rendering.canvasScale ? "selected" : ""
                    }>${entry.label}</option>
                  `
                )
                .join("")}
            </select>
          </label>
          <label ${makeTitle("Horizontal internal mesh density used by Butterchurn warp and comp passes.")}>
            Mesh width
            <input id="render-mesh-width" type="number" min="8" max="128" step="1" value="${state.project.output.rendering.meshWidth}" />
          </label>
          <label ${makeTitle("Vertical internal mesh density used by Butterchurn warp and comp passes.")}>
            Mesh height
            <input id="render-mesh-height" type="number" min="6" max="96" step="1" value="${state.project.output.rendering.meshHeight}" />
          </label>
        </div>
        <label ${makeTitle("Use the built-in demo generator or capture microphone input on the admin device.")}>
          Audio source
          <select id="audio-mode">
            <option value="demo" ${this.audioMode === "demo" ? "selected" : ""}>Demo generator</option>
            <option value="microphone" ${this.audioMode === "microphone" ? "selected" : ""}>Microphone</option>
          </select>
        </label>
        <label ${makeTitle("This is the output route on the same host you opened the admin panel from.")}>
          Output URL
          <input class="code" type="text" value="${escapeHtml(outputUrl)}" readonly />
        </label>
        <label ${makeTitle("Helpful when you are not using Docker or when the current host is already your LAN address.")}>
          Server-detected LAN hint
          <input class="code" type="text" value="${escapeHtml(lanHintUrl)}" readonly />
        </label>
        <label ${makeTitle("Shows live interaction fields, local mapping bounds, or both directly on the preview canvas.")}>
          Debug overlays
          <select id="debug-overlay-mode">
            <option value="off" ${this.debugOverlayMode === "off" ? "selected" : ""}>Off</option>
            <option value="interaction" ${this.debugOverlayMode === "interaction" ? "selected" : ""}>Interaction</option>
            <option value="surface" ${this.debugOverlayMode === "surface" ? "selected" : ""}>Surface bounds</option>
            <option value="all" ${this.debugOverlayMode === "all" ? "selected" : ""}>All overlays</option>
          </select>
        </label>
        <p class="muted">For other devices, open the same output path on your host machine's real LAN IP. The container-internal address is not always the public URL.</p>
        <div class="button-row">
          <button id="open-output">Open output window</button>
          <button class="secondary" id="reset-project">Reset project</button>
        </div>
        <div class="button-row">
          <button class="secondary" id="export-project">Export project</button>
          <label class="button-like secondary" ${makeTitle("Imports a previously exported ButterVizMap project JSON file.")}>
            <input id="import-project" type="file" accept="application/json" hidden />
            Import project
          </label>
        </div>
      </div>
    `;
    this.root.querySelector("#session-panel").innerHTML = sessionMarkup;

    this.root.querySelector("#element-list").innerHTML = `
      <div class="panel-header">
        <h3>Elements</h3>
        <div class="button-row">
          <button class="secondary" id="add-quad" ${makeTitle("Adds a four-corner mapping surface that can be clipped, painted or used as a local shader area.")}>+ Quad</button>
          <button class="secondary" id="add-polygon" ${makeTitle("Adds a polygon element that can act as a mask, paint region, interaction field or local shader area.")}>+ Polygon</button>
        </div>
      </div>
      <div class="list">
        ${state.project.elements
          .map(
            (element) => `
              <button class="list-item ${
                element.id === state.selectedElementId ? "active" : ""
              }" data-select-element="${element.id}" ${makeTitle("You can also select and drag this element directly on the canvas.")}>
                <strong>${escapeHtml(element.name)}</strong>
                <small>${escapeHtml(formatRoles(element) || "no roles")} · z ${element.zIndex}</small>
              </button>
            `
          )
          .join("")}
      </div>
    `;

    this.root.querySelector("#scene-list").innerHTML = `
      <div class="panel-header">
        <h3>Scenes</h3>
        <button class="secondary" id="scene-create" ${makeTitle("Captures the current global layer and element states into a reusable scene.")}>Capture current</button>
      </div>
      <div class="list">
        ${state.project.scenes
          .map(
            (scene) => `
              <div class="list-item ${scene.id === state.selectedSceneId ? "active" : ""}">
                <strong>${escapeHtml(scene.name)}</strong>
                <div class="button-row">
                  <button class="secondary" data-recall-scene="${scene.id}" ${makeTitle("Applies the stored scene state to the current project.")}>Recall</button>
                  <button class="ghost" data-overwrite-scene="${scene.id}" ${makeTitle("Stores the current state back into this scene slot.")}>Overwrite</button>
                </div>
              </div>
            `
          )
          .join("")}
      </div>
    `;

    const presetPanel = this.root.querySelector("#preset-list");
    if (presetPanel) {
      presetPanel.innerHTML = `
      <div class="panel-header">
        <h3>Presets</h3>
        <span class="tag">${visiblePresetEntries.length}/${state.project.presetLibrary.presets.length} visible</span>
      </div>
      <div class="panel-body" style="padding-top:12px">
        <div class="field-grid compact">
          <label ${makeTitle("Searches through preset names, file ids and author/category labels.")}>
            Search
            <input id="preset-search" type="text" value="${escapeHtml(this.presetSearchQuery)}" placeholder="Search presets" />
          </label>
          <label ${makeTitle("Starter shows a curated subset first. Repo shows all JSON presets from the repository.")}>
            Scope
            <select id="preset-filter">
              <option value="starter" ${this.presetFilter === "starter" ? "selected" : ""}>Starter</option>
              <option value="all" ${this.presetFilter === "all" ? "selected" : ""}>All presets</option>
              <option value="studio" ${this.presetFilter === "studio" ? "selected" : ""}>Studio built-ins</option>
              <option value="repo" ${this.presetFilter === "repo" ? "selected" : ""}>Repo presets</option>
              <option value="solid" ${this.presetFilter === "solid" ? "selected" : ""}>Solid only</option>
              <option value="favorites" ${this.presetFilter === "favorites" ? "selected" : ""}>Favorites</option>
              <option value="recent" ${this.presetFilter === "recent" ? "selected" : ""}>Recent</option>
            </select>
          </label>
        </div>
        <p class="muted">Starter combines the solid background mode, the studio defaults and a small cross-section of repo presets from different families/authors.</p>
        ${
          this.getRecentPresetEntries(state.project.presetLibrary.presets).length
            ? `
              <div class="chip-row" style="margin-top:10px">
                ${this.getRecentPresetEntries(state.project.presetLibrary.presets)
                  .map(
                    (preset) => `<span class="chip">${escapeHtml(preset.name)}</span>`
                  )
                  .join("")}
              </div>
            `
            : ""
        }
      </div>
      <div class="list">
        ${visiblePresetEntries
          .map(
            (preset) => `
              <div class="preset-card">
                <strong>${escapeHtml(preset.name)}</strong>
                <small>${escapeHtml(
                  `${this.getPresetMeta(preset).author} · ${preset.sourceType}:${preset.sourcePresetId}`
                )}</small>
                ${
                  this.getPresetMeta(preset).parityTarget
                    ? `<div class="chip-row" style="margin-top:8px"><span class="chip">Parity target</span></div>`
                    : ""
                }
                ${
                  this.getPresetMeta(preset).description
                    ? `<p class="muted" style="margin:8px 0 0">${escapeHtml(this.getPresetMeta(preset).description)}</p>`
                    : ""
                }
                <div class="button-row" style="margin-top:10px">
                  <button class="${this.isFavoritePreset(preset.id) ? "" : "secondary"}" data-favorite-preset="${preset.id}" ${makeTitle("Pins this preset into your local favorites list for faster show-time access.")}>${this.isFavoritePreset(preset.id) ? "Favorited" : "Favorite"}</button>
                  <button class="secondary" data-duplicate-preset="${preset.id}" ${makeTitle("Duplicates this preset entry so you can keep a separate override target in the project.")}>Duplicate</button>
                </div>
              </div>
            `
          )
          .join("")}
      </div>
      `;
    }

    this.root.querySelector("#status-bar").innerHTML = `
      <span class="tag">Project <strong>${escapeHtml(state.project.meta.name)}</strong></span>
      <span class="tag">Canvas <strong>${state.project.output.width}×${state.project.output.height}</strong></span>
      <span class="tag">Autosave <strong>${escapeHtml(state.autosaveStatus)}</strong></span>
      <span class="tag">Selected point <strong>${this.selectedPointIndex == null ? "none" : this.selectedPointIndex + 1}</strong></span>
    `;

    this.root.querySelector("#debug-panel").innerHTML = `
      <div class="panel-header">
        <h3>Debug</h3>
        <span class="tag">Autosave <strong>${escapeHtml(state.autosaveStatus)}</strong></span>
      </div>
      <div class="panel-body" style="padding-top:12px">
        <div class="debug-grid">
          <div class="debug-card">
            <strong>Autosave</strong>
            <small>Last saved: ${escapeHtml(formatDateTime(state.lastSavedAt))}</small>
            <small>Storage key: <span class="code">buttervizmap.autosave.v1</span></small>
            <small>Error: ${escapeHtml(state.autosaveError ?? "none")}</small>
          </div>
          <div class="debug-card">
            <strong>Render config</strong>
            <small>Frame limit: ${state.project.output.rendering.frameLimit}</small>
            <small>Canvas scale: ${state.project.output.rendering.canvasScale}x</small>
            <small>Mesh: ${state.project.output.rendering.meshWidth} × ${state.project.output.rendering.meshHeight}</small>
            <small>Global opacity: ${state.project.globalLayer.opacity.toFixed(2)}</small>
            <small>Visible surfaces: ${escapeHtml(visibleSurfaceSummary)}</small>
          </div>
          <div class="debug-card">
            <strong>Project diagnostics</strong>
            <small>Source: ${escapeHtml(projectDiagnostics.source ?? "runtime")}</small>
            <small>Version: ${escapeHtml(String(projectDiagnostics.sourceVersion ?? state.project.version))} → ${escapeHtml(String(projectDiagnostics.normalizedVersion ?? state.project.version))}</small>
            <small>Migrated: ${projectDiagnostics.migrated ? "yes" : "no"}</small>
            <small>Missing: ${escapeHtml(formatList(projectDiagnostics.missingSections ?? []))}</small>
          </div>
          <div class="debug-card">
            <strong>Preset catalog</strong>
            <small>Total: ${escapeHtml(String(catalogSummary?.total ?? state.project.presetLibrary.presets.length))}</small>
            <small>Solid/Built-in/File: ${escapeHtml(
              `${catalogSummary?.solid ?? 0} / ${catalogSummary?.builtin ?? 0} / ${catalogSummary?.file ?? 0}`
            )}</small>
            <small>Pack counts: ${escapeHtml(
              catalogSummary?.byPack ? Object.entries(catalogSummary.byPack).map(([pack, count]) => `${pack}:${count}`).join(", ") : "n/a"
            )}</small>
            <small>Load error: ${escapeHtml(this.catalogLoadError ?? "none")}</small>
          </div>
          <div class="debug-card">
            <strong>Session socket</strong>
            <small>Status: ${escapeHtml(socketDebugState.lastStatus ?? state.connectionStatus)}</small>
            <small>Sent/Received: ${escapeHtml(
              `${socketDebugState.sentMessages ?? 0} / ${socketDebugState.receivedMessages ?? 0}`
            )}</small>
            <small>Viewers: ${escapeHtml(String(state.viewerCount))}</small>
            <small>Last sent: ${escapeHtml(formatDateTime(socketDebugState.lastSentAt))}</small>
            <small>Last received: ${escapeHtml(formatDateTime(socketDebugState.lastReceivedAt))}</small>
          </div>
        </div>
        ${
          debugState.elementRenderers?.length
            ? `
              <div class="list" style="margin-top:12px">
                ${debugState.elementRenderers
                  .map(
                    (renderer) => `
                      <div class="debug-card">
                        <strong>${escapeHtml(renderer.currentPresetName ?? renderer.elementId)}</strong>
                        <small>Element: ${escapeHtml(renderer.elementId)}</small>
                        <small>Mode: ${escapeHtml(renderer.runtimeMode ?? "pending")}</small>
                        <small>Fallback: ${escapeHtml(renderer.fallbackMode ?? "none")}</small>
                        <small>Error: ${escapeHtml(renderer.lastError ?? "none")}</small>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            `
      : `<p class="muted">No local shader surfaces active.</p>`
        }
      </div>
    `;

    const shaderSurfaceActive = selectedElement?.roles?.shaderSurface === true;

    const inspectorMarkup = selectedElement
      ? `
        <label ${makeTitle("Human-readable name for this mapping element.")}>
          Name
          <input id="element-name" type="text" value="${escapeHtml(selectedElement.name)}" />
        </label>
        <div class="field-grid compact">
          <label ${makeTitle("Higher z-index elements render later and therefore appear on top.")}>
            Z-index
            <input id="element-zindex" type="number" value="${selectedElement.zIndex}" />
          </label>
          <label ${makeTitle("Base color for paint mode and the default color written into the interaction field.")}>
            Color
            <input id="element-color" type="color" value="${escapeHtml(selectedElement.style.color)}" />
          </label>
          <label ${makeTitle("Opacity of the element when it is used as a visible paint layer.")}>
            Opacity
            <input id="element-opacity" type="number" min="0" max="1" step="0.05" value="${selectedElement.style.opacity}" />
          </label>
        </div>
        <div class="field-grid">
          <label ${makeTitle("Local shader preset used when the element acts as a shader surface.")}>
            Shader preset
            <select id="element-preset">
              ${this.renderPresetOptions(
                state.project.presetLibrary.presets,
                selectedElement.shaderBinding.presetId
              )}
            </select>
          </label>
        </div>
        ${
          shaderSurfaceActive
            ? `<p class="muted">This element can render its own shader content when <code>shaderSurface</code> is active.</p>`
            : `<p class="muted">Shader preset and mapping controls only affect elements with <code>shaderSurface</code> enabled.</p>`
        }
        <div class="field-grid compact">
          <label ${makeTitle("Opacity of the local shader surface before additional blend and interaction effects are applied.")}>
            Shader opacity
            <input id="shader-opacity" type="number" min="0" max="1" step="0.05" value="${selectedElement.shaderBinding.opacity}" />
          </label>
          <label ${makeTitle("Canvas blend mode used when this shader surface is composited over the current output.")}>
            Blend mode
            <select id="shader-blend-mode">
              <option value="normal" ${selectedElement.shaderBinding.blendMode === "normal" ? "selected" : ""}>Normal</option>
              <option value="screen" ${selectedElement.shaderBinding.blendMode === "screen" ? "selected" : ""}>Screen</option>
              <option value="add" ${selectedElement.shaderBinding.blendMode === "add" ? "selected" : ""}>Add</option>
              <option value="multiply" ${selectedElement.shaderBinding.blendMode === "multiply" ? "selected" : ""}>Multiply</option>
              <option value="overlay" ${selectedElement.shaderBinding.blendMode === "overlay" ? "selected" : ""}>Overlay</option>
            </select>
          </label>
          <label ${makeTitle("Scales the shader content within the selected surface. Useful for avoiding a flat fullscreen-clipped look.")}>
            Shader scale
            <input id="shader-scale" type="number" min="0.25" max="3" step="0.05" value="${selectedElement.shaderBinding.scale}" />
          </label>
          <label ${makeTitle("Rotates the mapped shader content inside the surface.")}>
            Rotation
            <input id="shader-rotation" type="number" min="-180" max="180" step="1" value="${selectedElement.shaderBinding.rotation}" />
          </label>
          <label ${makeTitle("Offsets the local shader horizontally inside the surface. Values are relative to the surface width.")}>
            Offset X
            <input id="shader-offset-x" type="number" min="-1" max="1" step="0.01" value="${selectedElement.shaderBinding.offsetX}" />
          </label>
          <label ${makeTitle("Offsets the local shader vertically inside the surface. Values are relative to the surface height.")}>
            Offset Y
            <input id="shader-offset-y" type="number" min="-1" max="1" step="0.01" value="${selectedElement.shaderBinding.offsetY}" />
          </label>
        </div>
        <div class="role-grid">
          <label class="toggle" ${makeTitle("Cuts away pixels from layers that have already been composed.")}>
            <input id="role-clip" type="checkbox" ${selectedElement.roles.clip ? "checked" : ""} />
            clip
          </label>
          <label class="toggle" ${makeTitle("Draws the element as a visible colored layer in the final composition.")}>
            <input id="role-paint" type="checkbox" ${selectedElement.roles.paint ? "checked" : ""} />
            paint
          </label>
          <label class="toggle" ${makeTitle("Renders a dedicated Butterchurn preset only inside this element geometry.")}>
            <input id="role-shaderSurface" type="checkbox" ${selectedElement.roles.shaderSurface ? "checked" : ""} />
            shaderSurface
          </label>
          <label class="toggle" ${makeTitle("Writes alpha, color and distance information into the interaction pass used by the compositor.")}>
            <input id="role-interactionField" type="checkbox" ${selectedElement.roles.interactionField ? "checked" : ""} />
            interactionField
          </label>
        </div>
        <p class="muted"><code>clip + interactionField</code> performs boolean cutting without fill. <code>clip</code> alone masks only. <code>interactionField</code> alone performs boolean cutting and can inject this element's shader into the cut zone.</p>
        <div class="panel-header" style="padding:0">
          <h3>Geometry</h3>
          <button class="danger" id="remove-element" ${makeTitle("Deletes the currently selected element from the project.")}>Delete element</button>
        </div>
        <p class="muted">Click an element directly on the canvas to select it. Drag inside the shape to move the whole mask. Click a point to select it, then use arrow keys to nudge it. Double-click inside a polygon to add a point.</p>
        <div class="points-grid">
          ${selectedElement.geometry.points
            .map(
              (point, index) => `
                <div class="point-row">
                  <button class="ghost" data-focus-point="${index}" ${makeTitle("Selects this point so it becomes highlighted on the canvas and can be moved with arrow keys.")}>P${index + 1}</button>
                  <input data-point-index="${index}" data-axis="x" type="number" min="0" max="1" step="0.01" value="${point.x.toFixed(2)}" ${makeTitle("Normalized X position of this point on the output canvas.")} />
                  <input data-point-index="${index}" data-axis="y" type="number" min="0" max="1" step="0.01" value="${point.y.toFixed(2)}" ${makeTitle("Normalized Y position of this point on the output canvas.")} />
                  <button class="ghost" data-remove-point="${index}" ${
                    selectedElement.geometry.kind === "quad" ? "disabled" : ""
                  } ${makeTitle("Removes this point from the polygon. Quad corners are fixed at four points.")}>Remove</button>
                </div>
              `
            )
            .join("")}
        </div>
      `
      : `<p class="muted">Select an element to inspect its geometry and roles.</p>`;
    if (!this.shouldPreservePanel("#inspector-panel", "element-color")) {
      this.root.querySelector("#inspector-panel").innerHTML = inspectorMarkup;
    }
  }

  handleMessage(message) {
    if (message.type !== "PROJECT_SNAPSHOT" || !this.availablePresetCatalog.length) {
      return;
    }

    const mergedProject = this.mergePresetCatalogIntoProject(this.store.state.project);
    if (
      mergedProject.presetLibrary.presets.length !==
      this.store.state.project.presetLibrary.presets.length
    ) {
      this.store.setProject(mergedProject, {
        preserveSelection: true,
        source: "catalog-merge",
      });
    }
  }
}
