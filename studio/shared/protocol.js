export const MESSAGE_TYPES = {
  HELLO: "HELLO",
  PROJECT_SNAPSHOT: "PROJECT_SNAPSHOT",
  PROJECT_PATCH: "PROJECT_PATCH",
  SCENE_RECALL: "SCENE_RECALL",
  AUDIO_FRAME: "AUDIO_FRAME",
  VIEWER_STATE: "VIEWER_STATE",
  PING: "PING",
  PONG: "PONG",
};

export function serializeSocketMessage(message) {
  return JSON.stringify(message);
}

export function parseSocketMessage(message) {
  const parsed = JSON.parse(message);
  if (!parsed.type) {
    throw new Error("Socket message is missing a type");
  }

  return parsed;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function mergeProjectPatch(target, patch) {
  if (!isPlainObject(target) || !isPlainObject(patch)) {
    return patch;
  }

  const merged = { ...target };

  Object.keys(patch).forEach((key) => {
    if (BLOCKED_KEYS.has(key)) {
      return;
    }
    const value = patch[key];
    if (Array.isArray(value)) {
      merged[key] = value;
    } else if (isPlainObject(value) && isPlainObject(target[key])) {
      merged[key] = mergeProjectPatch(target[key], value);
    } else {
      merged[key] = value;
    }
  });

  return merged;
}

export function encodeAudioFrame(audioFrame) {
  return {
    frame: audioFrame.frame,
    timeByteArray: Array.from(audioFrame.timeByteArray),
    timeByteArrayL: Array.from(audioFrame.timeByteArrayL),
    timeByteArrayR: Array.from(audioFrame.timeByteArrayR),
  };
}

export function decodeAudioFrame(encodedFrame) {
  return {
    frame: encodedFrame.frame,
    timeByteArray: Uint8Array.from(encodedFrame.timeByteArray),
    timeByteArrayL: Uint8Array.from(encodedFrame.timeByteArrayL),
    timeByteArrayR: Uint8Array.from(encodedFrame.timeByteArrayR),
  };
}

