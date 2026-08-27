import assert from "node:assert/strict";
import { once } from "node:events";
import { connect } from "node:net";
import { test } from "node:test";

import {
  createRawStreamServer,
  formatChunk,
  type RawChunkEvent,
} from "../lessons/01-raw-stream/server.js";
import { closeServer, listen } from "./helpers/net.js";

test("formatChunk은 한 chunk의 바이트 수, 16진수, UTF-8 표현을 만든다", () => {
  assert.deepEqual(formatChunk(Buffer.from("안녕")), {
    bytes: 6,
    hex: "ec9588eb8595",
    text: "안녕",
  });
});

test("서버는 UTF-8 문자를 실제 바이트 기준으로 관찰한다", async (t) => {
  const chunks: RawChunkEvent[] = [];
  const server = createRawStreamServer({
    logger: () => undefined,
    onChunk: (chunk) => chunks.push(chunk),
  });
  const port = await listen(server);
  t.after(() => closeServer(server));

  const socket = connect({ host: "127.0.0.1", port });
  await once(socket, "connect");
  socket.end("안녕");
  await once(socket, "close");

  const received = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk.hex, "hex")),
  );
  assert.ok(chunks.length > 0);
  assert.equal(
    chunks.reduce((total, chunk) => total + chunk.bytes, 0),
    6,
  );
  assert.equal(received.length, 6);
  assert.equal(received.toString("hex"), "ec9588eb8595");
  assert.equal(received.toString("utf8"), "안녕");
});
