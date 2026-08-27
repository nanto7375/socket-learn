import { once } from "node:events";
import net from "node:net";

import { FrameDecoder } from "../../src/protocol/frame.js";
import {
  encodeMessage,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from "../../src/protocol/message.js";

type MessageOfType<T extends ServerMessage["type"]> = Extract<
  ServerMessage,
  { type: T }
>;

export interface TestChatClient {
  send(message: ClientMessage): void;
  sendRaw(frame: Buffer): void;
  nextMessage<T extends ServerMessage["type"]>(
    type: T,
  ): Promise<MessageOfType<T>>;
  closed(): Promise<void>;
  close(): Promise<void>;
}

interface WaitingMessage {
  type: ServerMessage["type"];
  resolve: (message: ServerMessage) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export async function connectChatClient(port: number): Promise<TestChatClient> {
  const socket = net.createConnection({ host: "127.0.0.1", port });
  const decoder = new FrameDecoder();
  const received: ServerMessage[] = [];
  const waiting: WaitingMessage[] = [];
  const closedPromise = once(socket, "close").then(() => undefined);
  let closing = false;

  socket.on("error", () => undefined);
  socket.on("data", (chunk: Buffer) => {
    for (const payload of decoder.push(chunk)) {
      const message = parseServerMessage(payload);
      const index = waiting.findIndex((candidate) => candidate.type === message.type);
      if (index < 0) {
        received.push(message);
        continue;
      }

      const [candidate] = waiting.splice(index, 1);
      if (candidate) {
        clearTimeout(candidate.timeout);
        candidate.resolve(message);
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onConnect = () => {
      socket.off("error", onError);
      resolve();
    };
    const onError = (error: Error) => {
      socket.off("connect", onConnect);
      reject(error);
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });

  return {
    send(message) {
      socket.write(encodeMessage(message));
    },
    sendRaw(frame) {
      socket.write(frame);
    },
    nextMessage(type) {
      const index = received.findIndex((message) => message.type === type);
      if (index >= 0) {
        const [message] = received.splice(index, 1);
        return Promise.resolve(message as MessageOfType<typeof type>);
      }

      return new Promise<MessageOfType<typeof type>>((resolve, reject) => {
        const timeout = setTimeout(() => {
          const index = waiting.findIndex((candidate) => candidate.timeout === timeout);
          if (index >= 0) waiting.splice(index, 1);
          reject(
            new Error(
              `${type} 메시지를 기다리다 시간이 초과되었습니다. 수신 메시지: ${JSON.stringify(received)}`,
            ),
          );
        }, 1_000);
        waiting.push({
          type,
          timeout,
          resolve: (message) => resolve(message as MessageOfType<typeof type>),
          reject,
        });
      });
    },
    closed() {
      return closedPromise;
    },
    async close() {
      if (socket.destroyed) return;
      if (!closing) {
        closing = true;
        socket.end();
      }
      await closedPromise;
    },
  };
}
