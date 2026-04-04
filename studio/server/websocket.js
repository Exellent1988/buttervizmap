import crypto from "crypto";
import { EventEmitter } from "events";

function createAcceptValue(clientKey) {
  return crypto
    .createHash("sha1")
    .update(`${clientKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
}

function encodeFrame(payload) {
  const body = Buffer.from(payload);
  let header;

  if (body.length < 126) {
    header = Buffer.from([0x81, body.length]);
  } else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }

  return Buffer.concat([header, body]);
}

function decodeFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const firstByte = buffer[offset];
    const secondByte = buffer[offset + 1];
    const opcode = firstByte & 0x0f;
    let payloadLength = secondByte & 0x7f;
    const masked = (secondByte & 0x80) !== 0;
    let cursor = offset + 2;

    if (payloadLength === 126) {
      if (cursor + 2 > buffer.length) {
        break;
      }
      payloadLength = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (payloadLength === 127) {
      if (cursor + 8 > buffer.length) {
        break;
      }
      payloadLength = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = cursor + maskLength + payloadLength - offset;
    if (offset + frameLength > buffer.length) {
      break;
    }

    const mask = masked ? buffer.slice(cursor, cursor + 4) : null;
    cursor += maskLength;
    const payload = buffer.slice(cursor, cursor + payloadLength);

    if (mask) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }

    if (opcode === 0x8) {
      messages.push({ type: "close" });
    } else if (opcode === 0x9) {
      messages.push({ type: "ping", payload: payload.toString("utf8") });
    } else if (opcode === 0x1) {
      messages.push({ type: "text", payload: payload.toString("utf8") });
    }

    offset += frameLength;
  }

  return {
    messages,
    remaining: buffer.slice(offset),
  };
}

export class WebSocketPeer extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);

    socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      const { messages, remaining } = decodeFrames(this.buffer);
      this.buffer = remaining;
      messages.forEach((message) => {
        if (message.type === "close") {
          this.close();
        } else if (message.type === "ping") {
          this.socket.write(Buffer.from([0x8a, 0x00]));
        } else {
          this.emit("message", message.payload);
        }
      });
    });

    socket.on("close", () => this.emit("close"));
    socket.on("end", () => this.emit("close"));
    socket.on("error", (error) => this.emit("error", error));
  }

  send(payload) {
    this.socket.write(encodeFrame(payload));
  }

  close() {
    if (!this.socket.destroyed) {
      this.socket.end(Buffer.from([0x88, 0x00]));
    }
    this.emit("close");
  }
}

export function upgradeToWebSocket(request, socket) {
  const clientKey = request.headers["sec-websocket-key"];
  if (!clientKey) {
    socket.destroy();
    return null;
  }

  const headers = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${createAcceptValue(clientKey)}`,
    "\r\n",
  ];

  socket.write(headers.join("\r\n"));
  return new WebSocketPeer(socket);
}

