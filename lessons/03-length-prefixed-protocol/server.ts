import { createServer } from "node:net";
import { pathToFileURL } from "node:url";

import { FrameDecoder } from "../../src/protocol/frame.js";

const port = Number(process.env.PORT ?? 4003);
let nextConnectionId = 0;

const server = createServer((socket) => {
  const connectionId = ++nextConnectionId;
  let sequence = 0;
  const decoder = new FrameDecoder();
  const log = (message: string): void => {
    sequence += 1;
    console.log(`[connection:${connectionId} #${sequence}] ${message}`);
  };

  log(`연결됨 ${socket.remoteAddress}:${socket.remotePort}`);
  socket.on("data", (chunk) => {
    if (!Buffer.isBuffer(chunk)) {
      log("수신 오류 Buffer가 아닌 chunk입니다");
      socket.destroy();
      return;
    }

    try {
      const payloads = decoder.push(chunk);
      log(`수신 chunk bytes=${chunk.length} decoded=${payloads.length}`);
      for (const payload of payloads) {
        log(`복원 메시지 text=${JSON.stringify(payload.toString("utf8"))}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`프레임 오류 ${message}`);
      socket.destroy();
    }
  });
  socket.on("end", () => log("입력 종료"));
  socket.on("close", () => log("연결 종료"));
  socket.on("error", (error) => log(`오류 ${error.message}`));
});

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  server.listen(port, "127.0.0.1", () => {
    console.log(`길이 헤더 프로토콜 서버 시작: 127.0.0.1:${port}`);
  });
}
