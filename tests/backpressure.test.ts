import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";

import {
  type FlowEvent,
  writeWithBackpressure,
} from "../lessons/05-backpressure/flow.js";

test("write가 false이면 drain까지 다음 chunk를 쓰지 않는다", async () => {
  const writes: string[] = [];
  const events: FlowEvent[] = [];
  const writable = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, callback) {
      writes.push(chunk.toString());
      setImmediate(callback);
    },
  });

  await writeWithBackpressure(
    writable,
    [Buffer.from("A"), Buffer.from("B")],
    (event) => events.push(event),
  );

  assert.deepEqual(writes, ["A", "B"]);
  assert.deepEqual(
    events.map((event) => event.type),
    ["write", "pause", "drain", "write", "pause", "drain"],
  );
});
