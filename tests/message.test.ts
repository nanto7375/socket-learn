import assert from "node:assert/strict";
import { test } from "node:test";

import { FrameDecoder } from "../src/protocol/frame.js";
import {
  encodeMessage,
  MAX_CHAT_TEXT_BYTES,
  MAX_NAME_BYTES,
  MessageDecodeError,
  parseClientMessage,
  parseServerMessage,
} from "../src/protocol/message.js";

test("한글 메시지를 프레임으로 인코딩하고 다시 검증한다", () => {
  const [payload] = new FrameDecoder().push(
    encodeMessage({ type: "chat", text: " 안녕 " }),
  );
  assert.ok(payload);
  assert.deepEqual(parseClientMessage(payload), {
    type: "chat",
    text: "안녕",
  });
});

test("잘못된 JSON, 빈 문자열, 알 수 없는 type을 거부한다", () => {
  const invalidPayloads = [
    Buffer.from("{"),
    Buffer.from(JSON.stringify({ type: "join", name: "  " })),
    Buffer.from(JSON.stringify({ type: "unknown" })),
  ];
  for (const payload of invalidPayloads) {
    assert.throws(() => parseClientMessage(payload), MessageDecodeError);
  }
});

test("JSON 문자열 안의 잘못된 UTF-8 바이트를 대체 문자로 허용하지 않는다", () => {
  const malformedPayloads = [
    Buffer.concat([
      Buffer.from('{"type":"chat","text":"'),
      Buffer.from([0xff]),
      Buffer.from('"}'),
    ]),
    Buffer.concat([
      Buffer.from('{"type":"join","name":"'),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('"}'),
    ]),
  ];

  for (const payload of malformedPayloads) {
    assert.throws(
      () => parseClientMessage(payload),
      (error: unknown) =>
        error instanceof MessageDecodeError && /UTF-8/.test(error.message),
    );
  }
});

test("trim 이후 이름과 채팅 내용의 UTF-8 바이트 상한을 검증한다", () => {
  const exactName = `${"가".repeat(84)}abcd`;
  const exactChatText = `${"가".repeat(2_730)}ab`;
  assert.equal(Buffer.byteLength(exactName), MAX_NAME_BYTES);
  assert.equal(Buffer.byteLength(exactChatText), MAX_CHAT_TEXT_BYTES);

  assert.deepEqual(
    parseClientMessage(
      Buffer.from(JSON.stringify({ type: "join", name: ` ${exactName} ` })),
    ),
    { type: "join", name: exactName },
  );
  assert.deepEqual(
    parseClientMessage(
      Buffer.from(
        JSON.stringify({ type: "chat", text: ` ${exactChatText} ` }),
      ),
    ),
    { type: "chat", text: exactChatText },
  );

  assert.throws(
    () =>
      parseClientMessage(
        Buffer.from(
          JSON.stringify({ type: "join", name: `${exactName}a` }),
        ),
      ),
    (error: unknown) =>
      error instanceof MessageDecodeError &&
      error.message.includes(`name은(는) ${MAX_NAME_BYTES}바이트 이하여야 합니다`),
  );
  assert.throws(
    () =>
      parseClientMessage(
        Buffer.from(
          JSON.stringify({ type: "chat", text: `${exactChatText}a` }),
        ),
      ),
    (error: unknown) =>
      error instanceof MessageDecodeError &&
      error.message.includes(
        `text은(는) ${MAX_CHAT_TEXT_BYTES}바이트 이하여야 합니다`,
      ),
  );
});

test("서버 error 메시지의 code를 검증한다", () => {
  const value = Buffer.from(
    JSON.stringify({
      type: "error",
      code: "NOT_JOINED",
      message: "먼저 참여하세요.",
    }),
  );
  assert.deepEqual(parseServerMessage(value), {
    type: "error",
    code: "NOT_JOINED",
    message: "먼저 참여하세요.",
  });
});

test("JSON 객체가 아닌 메시지를 거부한다", () => {
  for (const value of [null, [], "text", 1, true]) {
    assert.throws(
      () => parseClientMessage(Buffer.from(JSON.stringify(value))),
      MessageDecodeError,
    );
  }
});

test("메시지 필드의 잘못된 shape을 거부한다", () => {
  const invalidValues = [
    { type: "join", name: 1 },
    { type: "chat", text: "\t" },
    { type: "system", text: "" },
    { type: "chat", from: "alice", text: null },
    { type: "error", code: "NOT_JOINED", message: " " },
  ];
  for (const value of invalidValues) {
    assert.throws(
      () => parseServerMessage(Buffer.from(JSON.stringify(value))),
      MessageDecodeError,
    );
  }
});

test("서버 error 메시지의 알 수 없는 code를 거부한다", () => {
  assert.throws(
    () =>
      parseServerMessage(
        Buffer.from(
          JSON.stringify({
            type: "error",
            code: "UNKNOWN",
            message: "오류",
          }),
        ),
      ),
    MessageDecodeError,
  );
});
