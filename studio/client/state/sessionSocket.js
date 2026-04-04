import {
  MESSAGE_TYPES,
  decodeAudioFrame,
  encodeAudioFrame,
  parseSocketMessage,
  serializeSocketMessage,
} from "../../shared/protocol.js";

export class SessionSocket {
  constructor({ role, sessionId, onMessage, onStatusChange }) {
    this.role = role;
    this.sessionId = sessionId;
    this.onMessage = onMessage;
    this.onStatusChange = onStatusChange;
    this.socket = null;
  }

  connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/ws`;
    this.socket = new WebSocket(url);
    this.onStatusChange?.("connecting");

    this.socket.addEventListener("open", () => {
      this.onStatusChange?.("connected");
      this.send({
        type: MESSAGE_TYPES.HELLO,
        payload: {
          role: this.role,
          sessionId: this.sessionId,
        },
      });
    });

    this.socket.addEventListener("message", (event) => {
      const message = parseSocketMessage(event.data);
      if (message.type === MESSAGE_TYPES.AUDIO_FRAME) {
        message.payload = decodeAudioFrame(message.payload);
      }
      this.onMessage?.(message);
    });

    this.socket.addEventListener("close", () => {
      this.onStatusChange?.("offline");
    });

    this.socket.addEventListener("error", () => {
      this.onStatusChange?.("error");
    });
  }

  send(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
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
}

