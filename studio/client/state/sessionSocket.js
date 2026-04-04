import {
  MESSAGE_TYPES,
  decodeAudioFrame,
  encodeAudioFrame,
  parseSocketMessage,
  serializeSocketMessage,
} from "../../shared/protocol.js";

export class SessionSocket {
  constructor({ role, sessionId, onMessage, onStatusChange, getHelloPayload }) {
    this.role = role;
    this.sessionId = sessionId;
    this.onMessage = onMessage;
    this.onStatusChange = onStatusChange;
    this.getHelloPayload = getHelloPayload;
    this.socket = null;
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
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/ws`;
    this.socket = new WebSocket(url);
    this.debugState.url = url;
    this.onStatusChange?.("connecting");
    this.debugState.lastStatus = "connecting";

    this.socket.addEventListener("open", () => {
      this.onStatusChange?.("connected");
      this.debugState.lastStatus = "connected";
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
      this.onStatusChange?.("offline");
      this.debugState.lastStatus = "offline";
    });

    this.socket.addEventListener("error", () => {
      this.onStatusChange?.("error");
      this.debugState.lastStatus = "error";
      this.debugState.lastErrorAt = new Date().toISOString();
    });
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
      payload: { project },
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
      readyState: this.socket?.readyState ?? WebSocket.CLOSED,
    };
  }
}
