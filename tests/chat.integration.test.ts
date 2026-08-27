import assert from "node:assert/strict";
import { createServer } from "node:net";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

import { startChatClient } from "../lessons/04-cli-chat/client.js";
import { startChatServer } from "../lessons/04-cli-chat/server.js";
import { encodeFrame } from "../src/protocol/frame.js";
import { encodeMessage } from "../src/protocol/message.js";
import { connectChatClient } from "./helpers/chat-client.js";
import { closeServer, listen } from "./helpers/net.js";

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

test("테스트 클라이언트는 다음 메시지의 type이 다르면 순서 오류를 알린다", async (t) => {
  const server = await startChatServer({ port: 0, logger: () => undefined });
  const client = await connectChatClient(server.port);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  client.send({ type: "join", name: "ordered" });
  await assert.rejects(client.nextMessage("chat"), /다음 메시지는 system.*chat을 기다렸습니다/);

  client.send({ type: "chat", text: "다음 순서" });
  assert.deepEqual(await client.nextMessage("chat"), {
    type: "chat",
    from: "ordered",
    text: "다음 순서",
  });
});

test("테스트 클라이언트의 연결 실패는 닫힘 대기 Promise를 비동기로 거절하지 않는다", async () => {
  const unusedServer = createServer();
  const port = await listen(unusedServer);
  await closeServer(unusedServer);

  await assert.rejects(connectChatClient(port), /ECONNREFUSED/);
});

test("CLI는 연결과 join 뒤에 이미 준비된 stdin 줄을 chat으로 보낸다", async (t) => {
  const server = await startChatServer({ port: 0, logger: () => undefined });
  const observer = await connectChatClient(server.port);
  observer.send({ type: "join", name: "observer" });
  await observer.nextMessage("system");

  const client = startChatClient({
    name: "piped",
    port: server.port,
    input: Readable.from(["연결 뒤 입력\n"]),
  });
  t.after(async () => {
    client.close();
    await observer.close();
    await server.close();
  });

  await observer.nextMessage("system");
  assert.deepEqual(await observer.nextMessage("chat"), {
    type: "chat",
    from: "piped",
    text: "연결 뒤 입력",
  });
});
