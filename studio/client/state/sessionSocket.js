import {
  MESSAGE_TYPES,
  decodeAudioFrame,
  encodeAudioFrame,
  parseSocketMessage,
  serializeSocketMessage,
} from "../../shared/protocol.js";
import { createSyncProject } from "../../shared/project.js";

export class SessionSocket {
  constructor({ role, sessionId, onMessage, onStatusChange, getHelloPayload }) {
    this.role = role;
    this.sessionId = sessionId;
    this.onMessage = onMessage;
    this.onStatusChange = onStatusChange;
    this.getHelloPayload = getHelloPayload;
    this.socket = null;
    this.reconnectHandle = null;
    this.manualClose = false;
    this.reconnectAttempts = 0;
    this.debugState = {
      lastStatus: "offline",
      sentMessages: 0,
      receivedMessages: 0,
      lastSentAt: null,
      lastReceivedAt: null,
      lastErrorAt: null,
    };
  }

  connect() {
    clearTimeout(this.reconnectHandle);
    this.reconnectHandle = null;
    this.manualClose = false;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/ws`;
    this.socket = new WebSocket(url);
    this.debugState.url = url;
    this.onStatusChange?.("connecting");
    this.debugState.lastStatus = "connecting";

    this.socket.addEventListener("open", () => {
      this.onStatusChange?.("connected");
      this.debugState.lastStatus = "connected";
      this.reconnectAttempts = 0;
      const extraPayload = this.getHelloPayload?.() ?? {};
      this.send({
        type: MESSAGE_TYPES.HELLO,
        payload: {
          role: this.role,
          sessionId: this.sessionId,
          ...extraPayload,
        },
      });
    });

    this.socket.addEventListener("message", (event) => {
      const message = parseSocketMessage(event.data);
      this.debugState.receivedMessages += 1;
      this.debugState.lastReceivedAt = new Date().toISOString();
      if (message.type === MESSAGE_TYPES.AUDIO_FRAME) {
        message.payload = decodeAudioFrame(message.payload);
      }
      this.onMessage?.(message);
    });

    this.socket.addEventListener("close", () => {
      const nextStatus = this.manualClose ? "offline" : "reconnecting";
      this.onStatusChange?.(nextStatus);
      this.debugState.lastStatus = nextStatus;
      this.socket = null;
      if (!this.manualClose) {
        this.scheduleReconnect();
      }
    });

    this.socket.addEventListener("error", () => {
      this.onStatusChange?.("error");
      this.debugState.lastStatus = "error";
      this.debugState.lastErrorAt = new Date().toISOString();
    });
  }

  scheduleReconnect() {
    if (this.reconnectHandle) {
      return;
    }

    const delay = Math.min(5000, 500 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.debugState.nextReconnectDelayMs = delay;
    this.reconnectHandle = setTimeout(() => {
      this.reconnectHandle = null;
      this.connect();
    }, delay);
  }

  send(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.debugState.sentMessages += 1;
    this.debugState.lastSentAt = new Date().toISOString();
    this.socket.send(serializeSocketMessage(message));
  }

  sendProject(project) {
    this.send({
      type: MESSAGE_TYPES.PROJECT_SNAPSHOT,
      payload: { project: createSyncProject(project) },
    });
  }

  sendSceneRecall(sceneId) {
    this.send({
      type: MESSAGE_TYPES.SCENE_RECALL,
      payload: { sceneId },
    });
  }

  sendAudioFrame(audioFrame) {
    this.send({
      type: MESSAGE_TYPES.AUDIO_FRAME,
      payload: encodeAudioFrame(audioFrame),
    });
  }

  getDebugState() {
    return {
      ...this.debugState,
      reconnectAttempts: this.reconnectAttempts,
      readyState: this.socket?.readyState ?? WebSocket.CLOSED,
    };
  }

  disconnect() {
    this.manualClose = true;
    clearTimeout(this.reconnectHandle);
    this.reconnectHandle = null;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      this.socket.close();
    }
  }
}
