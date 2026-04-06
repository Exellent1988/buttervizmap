import { materializePresetDefinition } from "../../shared/defaultPresets.js";
import { MockRenderer } from "./mockRenderer.js";

let butterchurnPromise = null;
const remotePresetCache = new Map();
const SILENT_AUDIO_FRAME = {
  frame: 0,
  timeByteArray: new Uint8Array(1024).fill(128),
  timeByteArrayL: new Uint8Array(1024).fill(128),
  timeByteArrayR: new Uint8Array(1024).fill(128),
};
const REACTION_MODE_IDS = {
  tint: 0,
  pulse: 1,
  warp: 2,
  glow: 3,
  reflect: 4,
};

async function loadButterchurnModule() {
  if (!butterchurnPromise) {
    butterchurnPromise = (async () => {
      for (const candidatePath of ["/dist/butterchurn.min.js", "/dist/butterchurn.js"]) {
        try {
          return {
            module: await import(candidatePath),
            bundlePath: candidatePath,
          };
        } catch (error) {
          // try the next bundle path
        }
      }

      return null;
    })();
  }
  return butterchurnPromise;
}

async function resolvePresetRuntime(presetEntry) {
  if (presetEntry.sourceType === "file") {
    if (!remotePresetCache.has(presetEntry.sourcePresetId)) {
      const promise = fetch(`/api/presets/${encodeURIComponent(presetEntry.sourcePresetId)}`)
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Failed to load preset ${presetEntry.sourcePresetId}`);
          }
          const preset = await response.json();
          if (
            !Object.prototype.hasOwnProperty.call(preset, "init_eqs_eel") &&
            !Object.prototype.hasOwnProperty.call(preset, "init_eqs_str")
          ) {
            throw new Error(
              `Preset ${presetEntry.sourcePresetId} is missing converted Butterchurn equations`
            );
          }
          return preset;
        })
        .catch((error) => {
          // Remove failed entry so the preset can be retried in the same session.
          remotePresetCache.delete(presetEntry.sourcePresetId);
          throw error;
        });
      remotePresetCache.set(presetEntry.sourcePresetId, promise);
    }

    return remotePresetCache.get(presetEntry.sourcePresetId);
  }

  return materializePresetDefinition(presetEntry);
}

export class AdaptiveRenderer {
  constructor(width, height) {
    this.mockRenderer = new MockRenderer(width, height);
    this.runtime = null;
    this.currentPreset = null;
    this.width = width;
    this.height = height;
    this.initialized = false;
    this.forceMock = false;
    this.runtimeMode = "pending";
    this.renderConfig = {
      canvasScale: 2,
      meshWidth: 48,
      meshHeight: 36,
    };
    this.lastError = null;
    this.lastPresetInfo = null;
    this.bundlePath = null;
    this.fallbackMode = null;
    this.activePreset = null;
    this.lastRequestedPreset = null;
    this.lastFailedPresetId = null;
    this.hasRenderedCurrentPreset = false;
    this._lastFillTexture = null;
    this._lastContourTexture = null;
    this.studioInteractionState = {
      enabled: false,
      fillTexture: null,
      contourTexture: null,
      binding: null,
      interactionMix: 0,
      reactionModeId: REACTION_MODE_IDS.tint,
    };
  }

  applyRendererSize() {
    this.runtime.visualizer.setRendererSize(this.width, this.height, {
      pixelRatio: 1,
      textureRatio: this.renderConfig.canvasScale,
      meshWidth: this.renderConfig.meshWidth,
      meshHeight: this.renderConfig.meshHeight,
    });
    this.runtime.visualizer.setCanvas(this.runtime.canvas);
  }

  async init() {
    if (this.initialized) {
      return;
    }

    const butterchurnBundle = await loadButterchurnModule();
    if (butterchurnBundle?.module?.default?.createVisualizer) {
      try {
        const outputCanvas = document.createElement("canvas");
        outputCanvas.width = this.width;
        outputCanvas.height = this.height;
        this.bundlePath = butterchurnBundle.bundlePath;
        this.runtime = {
          type: "butterchurn",
          canvas: outputCanvas,
          visualizer: butterchurnBundle.module.default.createVisualizer(null, outputCanvas, {
            width: this.width,
            height: this.height,
            pixelRatio: 1,
            textureRatio: this.renderConfig.canvasScale,
            meshWidth: this.renderConfig.meshWidth,
            meshHeight: this.renderConfig.meshHeight,
          }),
        };
        this.runtime.visualizer.setStudioInteractionState?.(this.studioInteractionState);
        this.runtimeMode = "butterchurn";
      } catch (error) {
        this.runtime = null;
        this.runtimeMode = "mock";
        this.lastError =
          error instanceof Error
            ? `Butterchurn initialization failed: ${error.message}`
            : `Butterchurn initialization failed: ${String(error)}`;
      }
    } else {
      this.runtimeMode = "mock";
      this.lastError = "Butterchurn bundle could not be loaded. Falling back to mock renderer.";
    }

    this.initialized = true;
  }

  async resize(width, height) {
    this.width = width;
    this.height = height;
    this.mockRenderer.resize(width, height);
    await this.init();
    if (this.runtime?.type === "butterchurn") {
      this.runtime.canvas.width = width;
      this.runtime.canvas.height = height;
      try {
        if (this.currentPreset && this.hasRenderedCurrentPreset) {
          this.applyRendererSize();
        }
      } catch (error) {
        this.lastError =
          error instanceof Error ? error.message : `Resize failed: ${String(error)}`;
        this.runtimeMode = "error";
        this.runtime = null;
      }
    }
  }

  async setRenderConfig(renderConfig = {}) {
    this.renderConfig = {
      ...this.renderConfig,
      ...renderConfig,
    };

    await this.init();
    if (this.runtime?.type === "butterchurn") {
      try {
        if (this.currentPreset && this.hasRenderedCurrentPreset) {
          this.applyRendererSize();
        }
      } catch (error) {
        this.lastError =
          error instanceof Error ? error.message : `Render config update failed: ${String(error)}`;
        this.runtimeMode = "error";
        this.runtime = null;
      }
    }
  }

  async loadPreset(presetEntry, blendTime = 0) {
    if (this.lastFailedPresetId === presetEntry?.id && this.currentPreset?.id !== presetEntry?.id) {
      this.lastRequestedPreset = presetEntry;
      this.runtimeMode = "error";
      return false;
    }

    this.lastRequestedPreset = presetEntry;
    this.mockRenderer.loadPreset(presetEntry);
    this.forceMock = presetEntry?.sourceType === "solid" || presetEntry?.sourceType === "builtin";
    this.fallbackMode = presetEntry?.sourceType === "solid" ? "solid" : this.forceMock ? "mock" : null;
    this.lastError = null;
    await this.init();
    if (this.runtime?.type === "butterchurn" && !this.forceMock) {
      try {
        const preset = await resolvePresetRuntime(presetEntry);
        await this.runtime.visualizer.loadPreset(preset, blendTime);
        this.currentPreset = presetEntry;
        this.activePreset = presetEntry;
        this.hasRenderedCurrentPreset = false;
        this.lastPresetInfo = {
          presetId: presetEntry.id,
          presetName: presetEntry.name,
          sourceType: presetEntry.sourceType,
          blendTime,
          loadedAt: new Date().toISOString(),
        };
        this.runtimeMode = "butterchurn";
        this.lastFailedPresetId = null;
        this.runtime.visualizer.render({
          audioLevels: SILENT_AUDIO_FRAME,
          elapsedTime: 0,
        });
        this.hasRenderedCurrentPreset = true;
        this.applyRendererSize();
        return true;
      } catch (error) {
        this.runtimeMode = "error";
        this.lastFailedPresetId = presetEntry?.id ?? null;
        this.lastError = error instanceof Error ? error.message : String(error);
        console.error("ButterVizMap preset load failed", {
          presetId: presetEntry.id,
          sourcePresetId: presetEntry.sourcePresetId,
          error,
        });
        return false;
      }
    } else if (this.forceMock) {
      this.currentPreset = presetEntry;
      this.activePreset = presetEntry;
      this.hasRenderedCurrentPreset = true;
      this.lastPresetInfo = {
        presetId: presetEntry.id,
        presetName: presetEntry.name,
        sourceType: presetEntry.sourceType,
        blendTime,
        loadedAt: new Date().toISOString(),
      };
      this.lastFailedPresetId = null;
      return true;
    }

    return false;
  }

  setStudioInteractionState(state = {}) {
    this.studioInteractionState = {
      enabled: state.enabled === true,
      fillTexture: state.fillTexture ?? null,
      contourTexture: state.contourTexture ?? null,
      binding: state.binding ?? null,
      interactionMix: Number(state.interactionMix ?? 0),
      reactionModeId:
        REACTION_MODE_IDS[state.reactionMode] ?? REACTION_MODE_IDS.tint,
    };

    if (this.runtime?.type === "butterchurn") {
      this.runtime.visualizer.setStudioInteractionState?.(this.studioInteractionState);
    }
  }

  async render({ timestamp, audioFrame, interactionSummary }) {
    const useButterchurn =
      this.runtimeMode !== "error" &&
      this.runtime?.type === "butterchurn" &&
      this.currentPreset &&
      !this.forceMock;

    if (!useButterchurn) {
      this.mockRenderer.render({ timestamp, audioFrame, interactionSummary });
      return;
    }

    this.runtime.visualizer.setStudioInteractionState?.(this.studioInteractionState);

    const { fillTexture, contourTexture } = this.studioInteractionState;
    if (
      fillTexture &&
      contourTexture &&
      (fillTexture !== this._lastFillTexture || contourTexture !== this._lastContourTexture)
    ) {
      this.runtime.visualizer.loadExtraImages({
        studio_interaction_fill: {
          data: fillTexture,
          width: fillTexture.width,
          height: fillTexture.height,
          repeat: false,
        },
        studio_interaction_contour: {
          data: contourTexture,
          width: contourTexture.width,
          height: contourTexture.height,
          repeat: false,
        },
      });
      this._lastFillTexture = fillTexture;
      this._lastContourTexture = contourTexture;
    }

    this.runtime.visualizer.render({
      audioLevels: audioFrame ?? SILENT_AUDIO_FRAME,
      elapsedTime: timestamp * 0.001,
    });
    this.hasRenderedCurrentPreset = true;
  }

  getCanvas() {
    if (this.runtime?.type === "butterchurn" && !this.forceMock) {
      return this.runtime.canvas;
    }

    return this.mockRenderer.getCanvas();
  }

  getRuntimeMode() {
    if (this.forceMock) {
      return this.fallbackMode ?? "mock";
    }

    return this.runtimeMode;
  }

  getDebugState() {
    return {
      runtimeMode: this.getRuntimeMode(),
      currentPresetId: this.currentPreset?.id ?? null,
      currentPresetName: this.currentPreset?.name ?? null,
      activePresetId: this.activePreset?.id ?? null,
      activePresetName: this.activePreset?.name ?? null,
      requestedPresetId: this.lastRequestedPreset?.id ?? null,
      requestedPresetName: this.lastRequestedPreset?.name ?? null,
      fallbackMode: this.fallbackMode,
      lastFailedPresetId: this.lastFailedPresetId,
      lastPresetInfo: this.lastPresetInfo,
      lastError: this.lastError,
      bundlePath: this.bundlePath,
      renderConfig: { ...this.renderConfig },
    };
  }
}
