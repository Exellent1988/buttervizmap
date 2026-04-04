import { materializePresetDefinition } from "../../shared/defaultPresets.js";
import { MockRenderer } from "./mockRenderer.js";

let butterchurnPromise = null;
const remotePresetCache = new Map();

async function loadButterchurnModule() {
  if (!butterchurnPromise) {
    butterchurnPromise = (async () => {
      for (const candidatePath of ["/dist/butterchurn.min.js", "/dist/butterchurn.js"]) {
        try {
          return await import(candidatePath);
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
      remotePresetCache.set(
        presetEntry.sourcePresetId,
        fetch(`/api/presets/${encodeURIComponent(presetEntry.sourcePresetId)}`).then(
          async (response) => {
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
          }
        )
      );
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
  }

  async init() {
    if (this.initialized) {
      return;
    }

    const butterchurnModule = await loadButterchurnModule();
    if (butterchurnModule?.default?.createVisualizer) {
      const outputCanvas = document.createElement("canvas");
      outputCanvas.width = this.width;
      outputCanvas.height = this.height;
      this.runtime = {
        type: "butterchurn",
        canvas: outputCanvas,
        visualizer: butterchurnModule.default.createVisualizer(null, outputCanvas, {
          width: this.width,
          height: this.height,
          pixelRatio: 1,
          textureRatio: this.renderConfig.canvasScale,
          meshWidth: this.renderConfig.meshWidth,
          meshHeight: this.renderConfig.meshHeight,
        }),
      };
      this.runtimeMode = "butterchurn";
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
      this.runtime.visualizer.setRendererSize(width, height, {
        pixelRatio: 1,
        textureRatio: this.renderConfig.canvasScale,
        meshWidth: this.renderConfig.meshWidth,
        meshHeight: this.renderConfig.meshHeight,
      });
      this.runtime.visualizer.setCanvas(this.runtime.canvas);
    }
  }

  async setRenderConfig(renderConfig = {}) {
    this.renderConfig = {
      ...this.renderConfig,
      ...renderConfig,
    };

    await this.init();
    if (this.runtime?.type === "butterchurn") {
      this.runtime.visualizer.setRendererSize(this.width, this.height, {
        pixelRatio: 1,
        textureRatio: this.renderConfig.canvasScale,
        meshWidth: this.renderConfig.meshWidth,
        meshHeight: this.renderConfig.meshHeight,
      });
      this.runtime.visualizer.setCanvas(this.runtime.canvas);
    }
  }

  async loadPreset(presetEntry, blendTime = 0) {
    this.currentPreset = presetEntry;
    this.mockRenderer.loadPreset(presetEntry);
    this.forceMock = presetEntry?.sourceType === "solid";
    this.lastError = null;
    await this.init();
    if (this.runtime?.type === "butterchurn" && !this.forceMock) {
      try {
        const preset = await resolvePresetRuntime(presetEntry);
        await this.runtime.visualizer.loadPreset(preset, blendTime);
        this.lastPresetInfo = {
          presetId: presetEntry.id,
          presetName: presetEntry.name,
          sourceType: presetEntry.sourceType,
          blendTime,
          loadedAt: new Date().toISOString(),
        };
      } catch (error) {
        this.runtimeMode = "error";
        this.lastError = error instanceof Error ? error.message : String(error);
        console.error("ButterVizMap preset load failed", {
          presetId: presetEntry.id,
          sourcePresetId: presetEntry.sourcePresetId,
          error,
        });
      }
    } else if (this.forceMock) {
      this.lastPresetInfo = {
        presetId: presetEntry.id,
        presetName: presetEntry.name,
        sourceType: presetEntry.sourceType,
        blendTime,
        loadedAt: new Date().toISOString(),
      };
    }
  }

  async render({ timestamp, audioFrame, interactionSummary }) {
    this.mockRenderer.render({ timestamp, audioFrame, interactionSummary });
    if (this.runtime?.type === "butterchurn" && this.currentPreset && !this.forceMock) {
      this.runtime.visualizer.render({
        audioLevels: audioFrame,
        elapsedTime: timestamp * 0.001,
      });
    }
  }

  getCanvas() {
    if (this.runtime?.type === "butterchurn" && !this.forceMock) {
      return this.runtime.canvas;
    }

    return this.mockRenderer.getCanvas();
  }

  getRuntimeMode() {
    if (this.forceMock) {
      return "solid";
    }

    return this.runtimeMode;
  }

  getDebugState() {
    return {
      runtimeMode: this.getRuntimeMode(),
      currentPresetId: this.currentPreset?.id ?? null,
      currentPresetName: this.currentPreset?.name ?? null,
      lastPresetInfo: this.lastPresetInfo,
      lastError: this.lastError,
      renderConfig: { ...this.renderConfig },
    };
  }
}
