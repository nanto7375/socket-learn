import { createServer } from "node:net";
import { pathToFileURL } from "node:url";

const port = Number(process.env.PORT ?? 4_005);
let nextConnectionId = 0;

const server = createServer((socket) => {
  const connectionId = ++nextConnectionId;
  let sequence = 0;
  let receivedBytes = 0;
  const log = (message: string): void => {
    sequence += 1;
    console.log(`[연결:${connectionId} #${sequence}] ${message}`);
  };

  log(`연결됨 ${socket.remoteAddress}:${socket.remotePort}`);
  socket.pause();
  log("읽기 일시 중지 1초 후 재개");
  setTimeout(() => {
    socket.resume();
    log("읽기 재개");
  }, 1_000);

  socket.on("data", (chunk: Buffer) => {
    receivedBytes += chunk.length;
    log(`수신 bytes=${chunk.length} 누적=${receivedBytes}`);
  });
  socket.on("end", () => log(`입력 종료 누적=${receivedBytes}`));
  socket.on("close", () => log("연결 종료"));
  socket.on("error", (error) => log(`오류 ${error.message}`));
});

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  server.listen(port, "127.0.0.1", () => {
    console.log(`느린 소비자 시작: 127.0.0.1:${port}`);
  });
}
