import { connect } from "node:net";
import readline from "node:readline";

import { FrameDecoder } from "../../src/protocol/frame.js";
import { encodeMessage, parseServerMessage } from "../../src/protocol/message.js";

const name = process.argv[2];

if (!name) {
  console.error("사용법: npm run lesson:04:client -- <이름>");
  process.exitCode = 1;
} else {
  const port = Number(process.env.PORT ?? 4_004);
  const socket = connect({ host: "127.0.0.1", port });
  const decoder = new FrameDecoder();
  const input = readline.createInterface({ input: process.stdin });
  let closing = false;

  const close = (): void => {
    if (closing) return;
    closing = true;
    input.close();
    socket.end();
  };

  socket.on("connect", () => {
    socket.write(encodeMessage({ type: "join", name }));
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
  socket.on("close", () => input.close());
  input.on("line", (text) => {
    socket.write(encodeMessage({ type: "chat", text }));
  });
  process.once("SIGINT", close);
}
