import { encodeFrame } from "./frame.js";

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

function parseJson(payload: Buffer): unknown {
  try {
    return JSON.parse(payload.toString("utf8"));
  } catch {
    throw new MessageDecodeError("payload는 올바른 JSON이어야 합니다");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MessageDecodeError(`${field}은(는) 비어 있지 않은 문자열이어야 합니다`);
  }
  return value.trim();
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
    return { type: "join", name: readText(value.name, "name") };
  }
  if (value.type === "chat") {
    return { type: "chat", text: readText(value.text, "text") };
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

