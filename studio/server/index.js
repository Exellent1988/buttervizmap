import fs from "fs/promises";
import http from "http";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  createDefaultProject,
  createSyncProject,
  mergePresetLibraryCatalog,
  normalizeProject,
} from "../shared/project.js";
import {
  MESSAGE_TYPES,
  mergeProjectPatch,
  parseSocketMessage,
  serializeSocketMessage,
} from "../shared/protocol.js";
import { upgradeToWebSocket } from "./websocket.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, "../client");
const STUDIO_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(__dirname, "../..");
const PRESET_ROOTS = [
  {
    pack: "butterchurn-presets",
    root: path.resolve(STUDIO_ROOT, "preset-catalog/butterchurn-presets"),
  },
  {
    pack: "butterchurn-presets",
    root: path.resolve(REPO_ROOT, "node_modules/butterchurn-presets/presets/converted"),
  },
  {
    pack: "wasm-eel",
    root: path.resolve(REPO_ROOT, "experiments/wasm-eel/presets"),
  },
];
const PARITY_PRESET_PATTERNS = [
  /unchained\s*-\s*rewop/i,
  /aderrasi\s*-\s*potion of spirits/i,
  /mindblob mix/i,
  /spiral artifact/i,
];

function getPresetMeta(fileName) {
  const label = fileName.replace(/\.json$/i, "");
  const author = label.split(/\s+-\s+/)[0].split(",")[0].trim() || "Repo";
  return {
    author,
    category: "repo",
    parityTarget: PARITY_PRESET_PATTERNS.some((pattern) => pattern.test(label)),
  };
}

async function getAvailablePresetRoots() {
  const roots = await Promise.all(
    PRESET_ROOTS.map(async (entry) => {
      try {
        const stats = await fs.stat(entry.root);
        return stats.isDirectory() ? entry : null;
      } catch (error) {
        return null;
      }
    })
  );

  return roots.filter(Boolean);
}

async function listPresetEntries() {
  const roots = await getAvailablePresetRoots();
  const entriesById = new Map();

  for (const rootEntry of roots) {
    const files = (await fs.readdir(rootEntry.root))
      .filter((fileName) => fileName.endsWith(".json"))
      .sort((left, right) => left.localeCompare(right, "en"));

    for (const fileName of files) {
      if (entriesById.has(fileName)) {
        continue;
      }

      entriesById.set(fileName, {
        id: fileName,
        name: fileName.replace(/\.json$/i, ""),
        sourceType: "file",
        sourcePresetId: fileName,
        meta: {
          ...getPresetMeta(fileName),
          pack: rootEntry.pack,
        },
      });
    }
  }

  return [...entriesById.values()].sort((left, right) =>
    left.name.localeCompare(right.name, "en")
  );
}

let presetCatalogPromise = null;

async function getPresetCatalog() {
  if (!presetCatalogPromise) {
    presetCatalogPromise = listPresetEntries().catch((error) => {
      presetCatalogPromise = null;
      throw error;
    });
  }

  return presetCatalogPromise;
}

async function readPresetFile(fileName) {
  const roots = await getAvailablePresetRoots();
  for (const rootEntry of roots) {
    const presetPath = path.resolve(rootEntry.root, fileName);
    if (!presetPath.startsWith(rootEntry.root)) {
      continue;
    }

    try {
      return await fs.readFile(presetPath, "utf8");
    } catch (error) {
      // continue searching in fallback roots
    }
  }

  throw new Error(`Preset not found: ${fileName}`);
}

function summarizePresetCatalog(presets) {
  return {
    total: presets.length,
    bySourceType: presets.reduce((accumulator, preset) => {
      accumulator[preset.sourceType] = (accumulator[preset.sourceType] ?? 0) + 1;
      return accumulator;
    }, {}),
    byPack: presets.reduce((accumulator, preset) => {
      const pack = preset.meta?.pack ?? "unknown";
      accumulator[pack] = (accumulator[pack] ?? 0) + 1;
      return accumulator;
    }, {}),
  };
}

function getContentType(filePath) {
  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  if (filePath.endsWith(".png")) {
    return "image/png";
  }
  return "text/html; charset=utf-8";
}

function findLanAddress() {
  const interfaces = os.networkInterfaces();
  for (const values of Object.values(interfaces)) {
    for (const entry of values ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return "127.0.0.1";
}

function createSession(sessionId) {
  return {
    sessionId,
    project: createDefaultProject(),
    adminPeer: null,
    viewerPeers: new Set(),
    latestAudioFrame: null,
  };
}

export function createStudioServer({ port = 4177, host = "0.0.0.0" } = {}) {
  const sessions = new Map();
  let currentPort = port;
  const trackedSockets = new Set();
  const trackedPeers = new Set();

  function ensureSession(sessionId) {
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, createSession(sessionId));
    }

    return sessions.get(sessionId);
  }

  function send(peer, message) {
    peer.send(serializeSocketMessage(message));
  }

  async function ensureProjectCatalog(project) {
    const presetCatalog = await getPresetCatalog().catch(() => []);
    return mergePresetLibraryCatalog(project, presetCatalog);
  }

  function buildProjectSnapshotPayload(session) {
    return {
      sessionId: session.sessionId,
      project: createSyncProject(session.project),
    };
  }

  function notifyViewerState(session) {
    if (!session.adminPeer) {
      return;
    }

    send(session.adminPeer, {
      type: MESSAGE_TYPES.VIEWER_STATE,
      payload: {
        sessionId: session.sessionId,
        viewers: session.viewerPeers.size,
      },
    });
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    let filePath;
    let allowedRoot = CLIENT_ROOT;

    if (url.pathname === "/") {
      response.statusCode = 302;
      response.setHeader("Location", "/admin");
      response.end();
      return;
    }

    if (url.pathname === "/admin") {
      filePath = path.join(CLIENT_ROOT, "admin.html");
    } else if (url.pathname.startsWith("/output/")) {
      filePath = path.join(CLIENT_ROOT, "output.html");
    } else if (url.pathname.startsWith("/shared/")) {
      filePath = path.join(STUDIO_ROOT, url.pathname.slice(1));
      allowedRoot = STUDIO_ROOT;
    } else if (url.pathname.startsWith("/src/")) {
      filePath = path.join(REPO_ROOT, url.pathname.slice(1));
      allowedRoot = path.join(REPO_ROOT, "src");
    } else if (url.pathname.startsWith("/dist/")) {
      filePath = path.join(REPO_ROOT, url.pathname.slice(1));
      allowedRoot = path.join(REPO_ROOT, "dist");
    } else if (url.pathname === "/api/presets") {
      try {
        const presets = await getPresetCatalog();
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(
          JSON.stringify({
            presets,
            summary: summarizePresetCatalog(presets),
          })
        );
      } catch (error) {
        response.statusCode = 500;
        response.end(
          JSON.stringify({
            error: "Failed to list presets",
          })
        );
      }
      return;
    } else if (url.pathname.startsWith("/api/presets/")) {
      try {
        const fileName = decodeURIComponent(url.pathname.slice("/api/presets/".length));
        const file = await readPresetFile(fileName);
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(file);
      } catch (error) {
        response.statusCode = 404;
        response.end(
          JSON.stringify({
            error: "Preset not found",
          })
        );
      }
      return;
    } else if (url.pathname === "/studio-config.json") {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(
        JSON.stringify({
          wsPath: "/ws",
          lanAddress: findLanAddress(),
          port: currentPort,
        })
      );
      return;
    } else {
      filePath = path.join(CLIENT_ROOT, url.pathname);
    }

    try {
      const resolvedPath = path.resolve(filePath);
      if (!resolvedPath.startsWith(allowedRoot)) {
        response.statusCode = 403;
        response.end("Forbidden");
        return;
      }

      const file = await fs.readFile(resolvedPath);
      response.setHeader("Content-Type", getContentType(resolvedPath));
      response.end(file);
    } catch (error) {
      response.statusCode = 404;
      response.end("Not found");
    }
  });

  server.on("connection", (socket) => {
    trackedSockets.add(socket);
    socket.on("close", () => trackedSockets.delete(socket));
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    const peer = upgradeToWebSocket(request, socket, head);
    if (!peer) {
      return;
    }
    trackedPeers.add(peer);

    let activeSession = null;
    let activeRole = null;

    peer.on("message", async (rawMessage) => {
      let message;
      try {
        message = parseSocketMessage(rawMessage);
      } catch (error) {
        console.warn("ButterVizMap WS received invalid message", {
          preview: String(rawMessage).slice(0, 120),
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      try {
        if (message.type === MESSAGE_TYPES.HELLO) {
          activeRole = message.payload.role;
          activeSession = ensureSession(message.payload.sessionId);

          if (activeRole === "admin") {
            activeSession.adminPeer = peer;
            if (message.payload.project) {
              activeSession.project = await ensureProjectCatalog(
                normalizeProject(message.payload.project)
              );
            } else {
              activeSession.project = await ensureProjectCatalog(activeSession.project);
            }
            send(peer, {
              type: MESSAGE_TYPES.PROJECT_SNAPSHOT,
              payload: buildProjectSnapshotPayload(activeSession),
            });
            activeSession.viewerPeers.forEach((viewerPeer) =>
              send(viewerPeer, {
                type: MESSAGE_TYPES.PROJECT_SNAPSHOT,
                payload: buildProjectSnapshotPayload(activeSession),
              })
            );
          } else {
            activeSession.viewerPeers.add(peer);
            activeSession.project = await ensureProjectCatalog(activeSession.project);
            send(peer, {
              type: MESSAGE_TYPES.PROJECT_SNAPSHOT,
              payload: buildProjectSnapshotPayload(activeSession),
            });
            if (activeSession.latestAudioFrame) {
              send(peer, {
                type: MESSAGE_TYPES.AUDIO_FRAME,
                payload: activeSession.latestAudioFrame,
              });
            }
          }

          notifyViewerState(activeSession);
          return;
        }

        if (!activeSession) {
          return;
        }

        if (message.type === MESSAGE_TYPES.PROJECT_SNAPSHOT) {
          activeSession.project = await ensureProjectCatalog(
            normalizeProject(message.payload.project)
          );
          activeSession.viewerPeers.forEach((viewerPeer) =>
            send(viewerPeer, {
              type: MESSAGE_TYPES.PROJECT_SNAPSHOT,
              payload: buildProjectSnapshotPayload(activeSession),
            })
          );
          return;
        }

        if (message.type === MESSAGE_TYPES.PROJECT_PATCH) {
          activeSession.project = await ensureProjectCatalog(
            normalizeProject(mergeProjectPatch(activeSession.project, message.payload.patch))
          );
          activeSession.viewerPeers.forEach((viewerPeer) =>
            send(viewerPeer, {
              type: MESSAGE_TYPES.PROJECT_SNAPSHOT,
              payload: buildProjectSnapshotPayload(activeSession),
            })
          );
          return;
        }

        if (message.type === MESSAGE_TYPES.SCENE_RECALL) {
          if (activeSession.adminPeer && activeSession.adminPeer !== peer) {
            send(activeSession.adminPeer, message);
          }
          activeSession.viewerPeers.forEach((viewerPeer) => send(viewerPeer, message));
          return;
        }

        if (message.type === MESSAGE_TYPES.AUDIO_FRAME) {
          activeSession.latestAudioFrame = message.payload;
          activeSession.viewerPeers.forEach((viewerPeer) => send(viewerPeer, message));
          return;
        }

        if (message.type === MESSAGE_TYPES.PING) {
          send(peer, {
            type: MESSAGE_TYPES.PONG,
            payload: { timestamp: Date.now() },
          });
        }
      } catch (error) {
        console.error("ButterVizMap WS message handling failed", {
          type: message?.type,
          sessionId: activeSession?.sessionId,
          role: activeRole,
          error: error instanceof Error ? error.stack ?? error.message : String(error),
        });
      }
    });

    peer.on("error", (error) => {
      console.warn("ButterVizMap WS peer error", error);
    });

    peer.on("close", () => {
      trackedPeers.delete(peer);
      if (!activeSession) {
        return;
      }

      if (activeRole === "admin" && activeSession.adminPeer === peer) {
        activeSession.adminPeer = null;
      }

      activeSession.viewerPeers.delete(peer);
      notifyViewerState(activeSession);
    });
  });

  return {
    server,
    start() {
      return new Promise((resolve, reject) => {
        const handleError = (error) => {
          server.off("listening", handleListening);
          reject(error);
        };
        const handleListening = () => {
          server.off("error", handleError);
          currentPort = server.address().port;
          resolve({
            host,
            port: currentPort,
            lanAddress: findLanAddress(),
          });
        };

        server.once("error", handleError);
        server.once("listening", handleListening);
        server.listen(port, host);
      });
    },
    stop() {
      return new Promise((resolve, reject) => {
        trackedPeers.forEach((peer) => {
          try {
            peer.close();
          } catch (error) {
            // ignore cleanup errors during shutdown
          }
        });
        trackedSockets.forEach((socket) => {
          try {
            socket.destroy();
          } catch (error) {
            // ignore cleanup errors during shutdown
          }
        });
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const requestedPort = Number(process.env.PORT ?? 4177);
  const studioServer = createStudioServer({ port: requestedPort });
  studioServer.start().then(({ port, lanAddress }) => {
    console.log(`ButterVizMap Studio running on http://localhost:${port}/admin`);
    console.log(`LAN output URL base: http://${lanAddress}:${port}`);
  });
}
