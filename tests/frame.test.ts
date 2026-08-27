import assert from "node:assert/strict";
import { test } from "node:test";

import {
  encodeFrame,
  FrameDecoder,
  InvalidFrameError,
  MAX_PAYLOAD_BYTES,
} from "../src/protocol/frame.js";

test("헤더는 UTF-8 문자열 길이가 아닌 payload 바이트 길이를 기록한다", () => {
  const frame = encodeFrame(Buffer.from("안녕"));
  assert.equal(frame.readUInt32BE(0), 6);
  assert.equal(frame.subarray(4).toString("utf8"), "안녕");
});

test("프레임의 모든 가능한 위치에서 나뉘어도 하나로 복원한다", () => {
  const frame = encodeFrame(Buffer.from("hello"));
  for (let split = 1; split < frame.length; split += 1) {
    const decoder = new FrameDecoder();
    assert.deepEqual(decoder.push(frame.subarray(0, split)), []);
    assert.deepEqual(decoder.push(frame.subarray(split)), [
      Buffer.from("hello"),
    ]);
  }
});

test("한 chunk의 여러 프레임과 마지막 미완성 프레임을 처리한다", () => {
  const one = encodeFrame(Buffer.from("one"));
  const two = encodeFrame(Buffer.from("two"));
  const three = encodeFrame(Buffer.from("three"));
  const decoder = new FrameDecoder();

  assert.deepEqual(
    decoder.push(Buffer.concat([one, two, three.subarray(0, 6)])),
    [Buffer.from("one"), Buffer.from("two")],
  );
  assert.deepEqual(decoder.push(three.subarray(6)), [Buffer.from("three")]);
});

test("0바이트와 최대 크기 초과 길이를 즉시 거부한다", () => {
  for (const length of [0, MAX_PAYLOAD_BYTES + 1]) {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(length);
    assert.throws(
      () => new FrameDecoder().push(header),
      InvalidFrameError,
    );
  }
});
