import { connect } from "node:net";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

import { FrameDecoder } from "../../src/protocol/frame.js";
import { encodeMessage, parseServerMessage } from "../../src/protocol/message.js";

export interface ChatClientOptions {
  name: string;
  port?: number;
  input?: NodeJS.ReadableStream;
}

export interface ChatClientHandle {
  close(): void;
}

export function startChatClient(options: ChatClientOptions): ChatClientHandle {
  const port = options.port ?? Number(process.env.PORT ?? 4_004);
  const socket = connect({ host: "127.0.0.1", port });
  const decoder = new FrameDecoder();
  const source = options.input ?? process.stdin;
  let input: readline.Interface | undefined;
  let closing = false;

  const close = (): void => {
    if (closing) return;
    closing = true;
    input?.close();
    socket.end();
  };

  socket.on("connect", () => {
    if (closing) return;
    socket.write(encodeMessage({ type: "join", name: options.name }));
    input = readline.createInterface({ input: source });
    input.on("line", (text) => {
      socket.write(encodeMessage({ type: "chat", text }));
    });
  });
  socket.on("data", (chunk: Buffer) => {
    try {
      for (const payload of decoder.push(chunk)) {
        const message = parseServerMessage(payload);
        if (message.type === "system") {
          console.log(`[시스템] ${message.text}`);
        } else if (message.type === "chat") {
          console.log(`${message.from}: ${message.text}`);
        } else {
          console.error(`[오류 ${message.code}] ${message.message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`서버 응답 오류: ${message}`);
      close();
    }
  });
  socket.on("error", (error) => console.error(`연결 오류: ${error.message}`));
  socket.on("close", () => input?.close());

  return { close };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const name = process.argv[2];
  if (!name) {
    console.error("사용법: npm run lesson:04:client -- <이름>");
    process.exitCode = 1;
  } else {
    const client = startChatClient({ name });
    process.once("SIGINT", client.close);
  }
}
