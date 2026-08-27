import { once } from "node:events";
import {
  createServer,
  type AddressInfo,
  type Server,
} from "node:net";
import { pathToFileURL } from "node:url";

import { createEventLogger } from "./event-log.js";

export async function startHalfOpenServer(
  port = 0,
  logger: (line: string) => void = console.log,
): Promise<{ server: Server; port: number }> {
  let nextConnectionId = 0;
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    const connectionId = ++nextConnectionId;
    const log = createEventLogger(`connection:${connectionId}`, logger);
    const chunks: Buffer[] = [];

    log("연결 수립");
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      log("데이터 수신", `bytes=${chunk.length}`);
    });
    socket.on("end", () => {
      log("상대 송신 종료", Buffer.concat(chunks).toString("utf8"));
      socket.end("server-after-fin");
    });
    socket.on("finish", () => log("송신 종료"));
    socket.on("close", () => log("연결 종료"));
    socket.on("error", (error) => log("오류", error.message));
  });

  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  return {
    server,
    port: (server.address() as AddressInfo).port,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { port } = await startHalfOpenServer(
    Number(process.env.PORT ?? 4_006),
  );
  console.log(`connection close server: 127.0.0.1:${port}`);
}
