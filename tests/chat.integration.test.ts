import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

import { startChatServer } from "../lessons/04-cli-chat/server.js";
import { encodeFrame } from "../src/protocol/frame.js";
import { encodeMessage } from "../src/protocol/message.js";
import { connectChatClient } from "./helpers/chat-client.js";

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  throw new Error("condition was not met");
}

test("두 클라이언트가 참여하고 채팅을 브로드캐스트한다", async (t) => {
  const server = await startChatServer({ port: 0, logger: () => undefined });
  t.after(() => server.close());
  const alice = await connectChatClient(server.port);
  const bob = await connectChatClient(server.port);
  t.after(async () => {
    await Promise.all([alice.close(), bob.close()]);
  });

  alice.send({ type: "join", name: "alice" });
  await alice.nextMessage("system");
  bob.send({ type: "join", name: "bob" });
  await bob.nextMessage("system");
  await alice.nextMessage("system");

  alice.send({ type: "chat", text: "안녕" });
  assert.deepEqual(await bob.nextMessage("chat"), {
    type: "chat",
    from: "alice",
    text: "안녕",
  });
});

test("참여 전 chat은 오류 후에도 연결을 유지한다", async () => {
  const server = await startChatServer({ port: 0, logger: () => undefined });
  const client = await connectChatClient(server.port);
  try {
    client.send({ type: "chat", text: "먼저 보냄" });
    assert.equal((await client.nextMessage("error")).code, "NOT_JOINED");
    client.send({ type: "join", name: "late" });
    assert.equal((await client.nextMessage("system")).type, "system");
  } finally {
    await client.close();
    await server.close();
  }
});

test("한 번에 보낸 join과 chat 프레임을 순서대로 처리한다", async (t) => {
  const server = await startChatServer({ port: 0, logger: () => undefined });
  t.after(() => server.close());
  const observer = await connectChatClient(server.port);
  const sender = await connectChatClient(server.port);
  t.after(async () => {
    await Promise.all([observer.close(), sender.close()]);
  });

  observer.send({ type: "join", name: "observer" });
  await observer.nextMessage("system");

  sender.sendRaw(
    Buffer.concat([
      encodeMessage({ type: "join", name: "sender" }),
      encodeMessage({ type: "chat", text: "붙여서 전송" }),
    ]),
  );

  await observer.nextMessage("system");
  assert.deepEqual(await observer.nextMessage("chat"), {
    type: "chat",
    from: "sender",
    text: "붙여서 전송",
  });
});

test("잘못된 JSON을 보낸 연결만 종료한다", async (t) => {
  const server = await startChatServer({ port: 0, logger: () => undefined });
  t.after(() => server.close());
  const healthy = await connectChatClient(server.port);
  const malformed = await connectChatClient(server.port);
  t.after(async () => {
    await Promise.all([healthy.close(), malformed.close()]);
  });

  healthy.send({ type: "join", name: "healthy" });
  await healthy.nextMessage("system");

  malformed.sendRaw(encodeFrame(Buffer.from("{")));
  assert.equal(
    (await malformed.nextMessage("error")).code,
    "INVALID_MESSAGE",
  );
  await malformed.closed();

  healthy.send({ type: "chat", text: "still alive" });
  assert.equal((await healthy.nextMessage("chat")).text, "still alive");
});

test("두 번째 join은 오류 후 연결을 정리한다", async (t) => {
  const server = await startChatServer({ port: 0, logger: () => undefined });
  t.after(() => server.close());
  const client = await connectChatClient(server.port);
  t.after(() => client.close());

  client.send({ type: "join", name: "once" });
  await client.nextMessage("system");
  client.send({ type: "join", name: "twice" });

  assert.equal((await client.nextMessage("error")).code, "INVALID_MESSAGE");
  await client.closed();
  await waitFor(() => server.joinedCount() === 0);
  assert.equal(server.joinedCount(), 0);
});
