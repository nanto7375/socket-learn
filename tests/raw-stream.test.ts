import assert from "node:assert/strict";
import { once } from "node:events";
import { connect } from "node:net";
import { test } from "node:test";

import {
  createRawStreamServer,
  type RawChunkEvent,
} from "../lessons/01-raw-stream/server.js";
import { closeServer, listen } from "./helpers/net.js";

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

  assert.deepEqual(chunks, [
    {
      bytes: 6,
      hex: "ec9588eb8595",
      text: "안녕",
    },
  ]);
});
