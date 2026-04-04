import { StudioCompositor } from "../rendering/compositor.js";

export class OutputApp {
  constructor({ root, store, sessionSocket }) {
    this.root = root;
    this.store = store;
    this.sessionSocket = sessionSocket;
    this.compositor = null;
    this.nextRenderAt = 0;
  }

  mount() {
    this.root.innerHTML = `
      <div class="output-stage">
        <canvas id="output-canvas"></canvas>
        <div class="output-status" id="output-status">Waiting for session snapshot…</div>
      </div>
    `;

    this.canvas = this.root.querySelector("#output-canvas");
    this.status = this.root.querySelector("#output-status");
    this.compositor = new StudioCompositor(this.canvas);

    this.store.subscribe((state) => {
      this.compositor.setProject(state.project);
      this.compositor.setAudioFrame(state.lastAudioFrame);
      this.status.textContent = `${state.project.meta.name} · ${state.connectionStatus}`;
    });

    const loop = async (timestamp) => {
      const frameInterval = 1000 / this.store.state.project.output.rendering.frameLimit;
      if (timestamp < this.nextRenderAt) {
        requestAnimationFrame(loop);
        return;
      }
      this.nextRenderAt = timestamp + frameInterval;
      await this.compositor.render(timestamp);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  handleMessage(message) {
    if (message.type === "AUDIO_FRAME") {
      this.compositor.setAudioFrame(message.payload);
    }
  }
}
