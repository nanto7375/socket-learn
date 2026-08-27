import { once } from "node:events";
import { Socket } from "node:net";
import { pathToFileURL } from "node:url";

import { type FlowEvent, writeWithBackpressure } from "./flow.js";

const port = Number(process.env.PORT ?? 4_005);
const chunk = Buffer.alloc(64 * 1024, "a");
const chunks = Array.from({ length: 32 }, () => chunk);

async function run(): Promise<void> {
  const socketOptions: NonNullable<ConstructorParameters<typeof Socket>[0]> & {
    writableHighWaterMark: number;
  } = { writableHighWaterMark: 1_024 };
  const socket = new Socket(socketOptions);
  let sequence = 0;
  const log = (message: string): void => {
    sequence += 1;
    console.log(`[생산자 #${sequence}] ${message}`);
  };
  const logFlow = (event: FlowEvent): void => {
    if (event.type === "write") {
      log(`쓰기 bytes=${event.bytes} accepted=${event.accepted}`);
      return;
    }
    log(event.type === "pause" ? "쓰기 대기 drain까지 중지" : "drain 수신 쓰기 재개");
  };

  socket.on("error", (error) => log(`오류 ${error.message}`));
  socket.connect({ host: "127.0.0.1", port });
  await once(socket, "connect");
  log(`연결됨 127.0.0.1:${port}`);
  await writeWithBackpressure(socket, chunks, logFlow);
  socket.end();
  await once(socket, "close");
  log("연결 종료");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`생산자 실행 오류: ${message}`);
    process.exitCode = 1;
  });
}
