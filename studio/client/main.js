import { applySceneToProject, createSyncProject } from "../shared/project.js";
import { StudioStore } from "./state/studioStore.js";
import { SessionSocket } from "./state/sessionSocket.js";
import { AdminApp } from "./ui/adminApp.js";
import { OutputApp } from "./ui/outputApp.js";

async function loadStudioConfig() {
  const response = await fetch("/studio-config.json");
  return response.json();
}

function getSessionIdFromPath() {
  const outputMatch = location.pathname.match(/^\/output\/(.+)$/);
  if (outputMatch) {
    return outputMatch[1];
  }

  const saved = localStorage.getItem("buttervizmap.sessionId");
  if (saved) {
    return saved;
  }

  const generated =
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  localStorage.setItem("buttervizmap.sessionId", generated);
  return generated;
}

async function boot() {
  const root = document.querySelector("#app");
  const studioConfig = await loadStudioConfig();
  const sessionId = getSessionIdFromPath();
  const role = location.pathname.startsWith("/output/") ? "viewer" : "admin";
  const store = new StudioStore(role);
  let app;

  const sessionSocket = new SessionSocket({
    role: role === "admin" ? "admin" : "viewer",
    sessionId,
    getHelloPayload:
      role === "admin"
        ? () => ({
            project: createSyncProject(store.state.project),
          })
        : undefined,
    onStatusChange: (status) => store.setConnectionStatus(status),
    onMessage: (message) => {
      if (message.type === "PROJECT_SNAPSHOT") {
        store.setProject(message.payload.project, {
          preserveSelection: true,
          skipAutosave: role !== "admin",
          source: "session",
        });
      }

      if (message.type === "VIEWER_STATE") {
        store.setViewerCount(message.payload.viewers);
      }

      if (message.type === "SCENE_RECALL") {
        store.setProject(applySceneToProject(store.state.project, message.payload.sceneId), {
          preserveSelection: true,
          skipAutosave: role !== "admin",
          source: "scene-recall",
        });
      }

      if (message.type === "AUDIO_FRAME") {
        store.setAudioFrame(message.payload);
      }

      app?.handleMessage?.(message);
    },
  });

  if (role === "admin") {
    app = new AdminApp({
      root,
      store,
      sessionSocket,
      sessionId,
      lanAddress: studioConfig.lanAddress,
      publicOrigin: studioConfig.publicOrigin,
    });
  } else {
    app = new OutputApp({
      root,
      store,
      sessionSocket,
    });
  }

  globalThis.__buttervizmap = {
    role,
    sessionId,
    store,
    sessionSocket,
    app,
  };

  app.mount();
  sessionSocket.connect();
}

boot();
