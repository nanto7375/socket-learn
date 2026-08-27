import { encodeFrame } from "./frame.js";

export const MAX_NAME_BYTES = 256;
export const MAX_CHAT_TEXT_BYTES = 8_192;

export type ProtocolErrorCode =
  | "INVALID_FRAME"
  | "INVALID_MESSAGE"
  | "NOT_JOINED";

export type ClientMessage =
  | { type: "join"; name: string }
  | { type: "chat"; text: string };

export type ServerMessage =
  | { type: "system"; text: string }
  | { type: "chat"; from: string; text: string }
  | { type: "error"; code: ProtocolErrorCode; message: string };

export class MessageDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageDecodeError";
  }
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function parseJson(payload: Buffer): unknown {
  let text: string;
  try {
    text = utf8Decoder.decode(payload);
  } catch {
    throw new MessageDecodeError("payload는 올바른 UTF-8이어야 합니다");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new MessageDecodeError("payload는 올바른 JSON이어야 합니다");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown, field: string, maxBytes?: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MessageDecodeError(`${field}은(는) 비어 있지 않은 문자열이어야 합니다`);
  }
  const text = value.trim();
  if (maxBytes !== undefined && Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new MessageDecodeError(`${field}은(는) ${maxBytes}바이트 이하여야 합니다`);
  }
  return text;
}

export function encodeMessage(
  message: ClientMessage | ServerMessage,
): Buffer {
  return encodeFrame(Buffer.from(JSON.stringify(message), "utf8"));
}

function parseObject(payload: Buffer): Record<string, unknown> {
  const value = parseJson(payload);
  if (!isRecord(value)) {
    throw new MessageDecodeError("메시지는 JSON 객체여야 합니다");
  }
  return value;
}

export function parseClientMessage(payload: Buffer): ClientMessage {
  const value = parseObject(payload);
  if (value.type === "join") {
    return {
      type: "join",
      name: readText(value.name, "name", MAX_NAME_BYTES),
    };
  }
  if (value.type === "chat") {
    return {
      type: "chat",
      text: readText(value.text, "text", MAX_CHAT_TEXT_BYTES),
    };
  }
  throw new MessageDecodeError("알 수 없는 클라이언트 메시지 type입니다");
}

const ERROR_CODES = new Set<ProtocolErrorCode>([
  "INVALID_FRAME",
  "INVALID_MESSAGE",
  "NOT_JOINED",
]);

export function parseServerMessage(payload: Buffer): ServerMessage {
  const value = parseObject(payload);
  if (value.type === "system") {
    return { type: "system", text: readText(value.text, "text") };
  }
  if (value.type === "chat") {
    return {
      type: "chat",
      from: readText(value.from, "from"),
      text: readText(value.text, "text"),
    };
  }
  if (
    value.type === "error" &&
    typeof value.code === "string" &&
    ERROR_CODES.has(value.code as ProtocolErrorCode)
  ) {
    return {
      type: "error",
      code: value.code as ProtocolErrorCode,
      message: readText(value.message, "message"),
    };
  }
  throw new MessageDecodeError("알 수 없는 서버 메시지 type 또는 error code입니다");
}
