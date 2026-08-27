import assert from "node:assert/strict";
import { test } from "node:test";

import {
  interpretEachChunkAsMessage,
  splitBytes,
} from "../lessons/02-message-boundary/boundary.js";

test("같은 바이트도 chunk 경계를 메시지 경계로 오해하면 결과가 달라진다", () => {
  const bytes = Buffer.from("HELLOWORLD");

  const split = splitBytes(bytes, [5]);
  const fragmented = splitBytes(bytes, [2, 7]);

  assert.deepEqual(interpretEachChunkAsMessage(split), ["HELLO", "WORLD"]);
  assert.deepEqual(interpretEachChunkAsMessage(fragmented), [
    "HE",
    "LLOWO",
    "RLD",
  ]);
  assert.equal(Buffer.concat(split).equals(Buffer.concat(fragmented)), true);
});

test("여러 논리 메시지가 한 chunk로 합쳐질 수도 있다", () => {
  const combined = [Buffer.concat([Buffer.from("ONE"), Buffer.from("TWO")])];
  assert.deepEqual(interpretEachChunkAsMessage(combined), ["ONETWO"]);
});
