import assert from "node:assert/strict";
import { once } from "node:events";
import { connect } from "node:net";
import { test } from "node:test";

import { startHalfOpenServer } from "../lessons/06-connection-close/server.js";
import { closeServer } from "./helpers/net.js";

test("클라이언트가 송신을 끝내도 서버는 응답을 보낼 수 있다", async (t) => {
  const { server, port } = await startHalfOpenServer(0, () => undefined);
  t.after(() => closeServer(server));

  const socket = connect({ host: "127.0.0.1", port });
  const chunks: Buffer[] = [];
  socket.on("data", (chunk: Buffer) => chunks.push(chunk));
  await once(socket, "connect");

  socket.end("client-final");
  await once(socket, "close");

  assert.equal(Buffer.concat(chunks).toString("utf8"), "server-after-fin");
});
