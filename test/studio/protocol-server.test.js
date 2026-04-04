import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { createStudioServer } from "../../studio/server/index.js";
import {
  MESSAGE_TYPES,
  decodeAudioFrame,
  encodeAudioFrame,
  mergeProjectPatch,
  parseSocketMessage,
  serializeSocketMessage,
} from "../../studio/shared/protocol.js";
import { createDefaultProject } from "../../studio/shared/project.js";

function waitForSocketOpen(socket) {
  return new Promise((resolve) => {
    socket.addEventListener("open", () => resolve(), { once: true });
  });
}

function waitForSocketClose(socket) {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    socket.addEventListener("close", () => resolve(), { once: true });
  });
}

function waitForSocketMessage(socket, expectedType) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", handler);
      reject(new Error(`Timed out waiting for socket message: ${expectedType}`));
    }, 5000);

    const handler = (event) => {
      const message = parseSocketMessage(event.data);
      if (!expectedType || message.type === expectedType) {
        clearTimeout(timeout);
        socket.removeEventListener("message", handler);
        resolve(message);
      }
    };

    socket.addEventListener("message", handler);
  });
}

describe("studio protocol and LAN sync server", () => {
  let studioServer;
  let serverInfo;
  let listenError = null;

  beforeAll(async () => {
    try {
      studioServer = createStudioServer({ port: 0, host: "127.0.0.1" });
      serverInfo = await studioServer.start();
    } catch (error) {
      listenError = error;
    }
  });

  afterAll(async () => {
    if (studioServer && serverInfo) {
      await studioServer.stop();
    }
  });

  test("serializes messages and merges patches", () => {
    const project = createDefaultProject();
    const patch = {
      globalLayer: { presetId: "solar-curtain" },
      output: { width: 1920 },
    };
    const merged = mergeProjectPatch(project, patch);
    const serialized = serializeSocketMessage({
      type: MESSAGE_TYPES.PROJECT_PATCH,
      payload: { patch },
    });

    expect(parseSocketMessage(serialized).type).toBe(MESSAGE_TYPES.PROJECT_PATCH);
    expect(merged.globalLayer.presetId).toBe("solar-curtain");
    expect(merged.output.width).toBe(1920);
  });

  test("encodes and decodes audio frames", () => {
    const frame = {
      frame: 3,
      timeByteArray: Uint8Array.from([0, 1, 2, 3]),
      timeByteArrayL: Uint8Array.from([4, 5, 6, 7]),
      timeByteArrayR: Uint8Array.from([8, 9, 10, 11]),
    };

    const decoded = decodeAudioFrame(encodeAudioFrame(frame));

    expect(Array.from(decoded.timeByteArrayL)).toEqual([4, 5, 6, 7]);
    expect(decoded.frame).toBe(3);
  });

  test("broadcasts project snapshots and audio frames from admin to viewers", async () => {
    if (listenError) {
      expect(listenError.code).toBe("EPERM");
      return;
    }

    const sessionId = "studio-sync-test";
    const adminSocket = new WebSocket(`ws://127.0.0.1:${serverInfo.port}/ws`);
    const viewerSocket = new WebSocket(`ws://127.0.0.1:${serverInfo.port}/ws`);

    await waitForSocketOpen(adminSocket);
    const adminSnapshotPromise = waitForSocketMessage(
      adminSocket,
      MESSAGE_TYPES.PROJECT_SNAPSHOT
    );
    adminSocket.send(
      serializeSocketMessage({
        type: MESSAGE_TYPES.HELLO,
        payload: { role: "admin", sessionId },
      })
    );
    await adminSnapshotPromise;

    await waitForSocketOpen(viewerSocket);
    const viewerInitialSnapshotPromise = waitForSocketMessage(
      viewerSocket,
      MESSAGE_TYPES.PROJECT_SNAPSHOT
    );
    viewerSocket.send(
      serializeSocketMessage({
        type: MESSAGE_TYPES.HELLO,
        payload: { role: "viewer", sessionId },
      })
    );
    await viewerInitialSnapshotPromise;

    const nextProject = createDefaultProject();
    nextProject.meta.name = "Synced Session";
    const viewerProjectMessagePromise = waitForSocketMessage(
      viewerSocket,
      MESSAGE_TYPES.PROJECT_SNAPSHOT
    );
    adminSocket.send(
      serializeSocketMessage({
        type: MESSAGE_TYPES.PROJECT_SNAPSHOT,
        payload: { project: nextProject },
      })
    );
    const viewerProjectMessage = await viewerProjectMessagePromise;
    expect(viewerProjectMessage.payload.project.meta.name).toBe("Synced Session");

    const viewerAudioMessagePromise = waitForSocketMessage(
      viewerSocket,
      MESSAGE_TYPES.AUDIO_FRAME
    );
    adminSocket.send(
      serializeSocketMessage({
        type: MESSAGE_TYPES.AUDIO_FRAME,
        payload: encodeAudioFrame({
          frame: 7,
          timeByteArray: Uint8Array.from([1, 2, 3, 4]),
          timeByteArrayL: Uint8Array.from([4, 5, 6, 7]),
          timeByteArrayR: Uint8Array.from([7, 8, 9, 10]),
        }),
      })
    );
    const viewerAudioMessage = await viewerAudioMessagePromise;
    expect(viewerAudioMessage.payload.frame).toBe(7);

    adminSocket.close();
    viewerSocket.close();
    await Promise.all([waitForSocketClose(adminSocket), waitForSocketClose(viewerSocket)]);
  });

  test("serves the repo preset catalog over HTTP", async () => {
    if (listenError) {
      expect(listenError.code).toBe("EPERM");
      return;
    }

    const response = await fetch(`http://127.0.0.1:${serverInfo.port}/api/presets`);
    const payload = await response.json();

    expect(response.ok).toBe(true);
    expect(Array.isArray(payload.presets)).toBe(true);
    expect(payload.presets.length).toBeGreaterThan(400);
    expect(payload.presets[0]).toEqual(
      expect.objectContaining({
        sourceType: "file",
        sourcePresetId: expect.any(String),
        meta: expect.objectContaining({
          author: expect.any(String),
          category: "repo",
          pack: expect.any(String),
        }),
      })
    );
  });
});
