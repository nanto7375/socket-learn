import { createServer } from "node:net";
import { pathToFileURL } from "node:url";

const port = Number(process.env.PORT ?? 4002);
let nextConnectionId = 0;

const server = createServer((socket) => {
  const connectionId = ++nextConnectionId;
  let sequence = 0;
  let messageNumber = 0;
  const log = (message: string): void => {
    sequence += 1;
    console.log(`[connection:${connectionId} #${sequence}] ${message}`);
  };

  log(`연결됨 ${socket.remoteAddress}:${socket.remotePort}`);
  socket.on("data", (chunk) => {
    messageNumber += 1;
    const text = chunk.toString("utf8");
    log(`수신 message#${messageNumber} bytes=${chunk.length} text=${JSON.stringify(text)}`);
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
    console.log(`메시지 경계 서버 시작: 127.0.0.1:${port}`);
  });
}
