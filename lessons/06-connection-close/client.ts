import { once } from "node:events";
import { connect } from "node:net";
import { pathToFileURL } from "node:url";

import { createEventLogger } from "./event-log.js";

type CloseMode = "graceful" | "forced";

function parseMode(argv: string[]): CloseMode | undefined {
  const mode = argv.find((argument) => argument.startsWith("--mode="));
  if (mode === "--mode=graceful") return "graceful";
  if (mode === "--mode=forced") return "forced";
  return undefined;
}

export async function runConnectionCloseClient(
  mode: CloseMode,
  port = Number(process.env.PORT ?? 4_006),
  logger: (line: string) => void = console.log,
): Promise<void> {
  const socket = connect({ host: "127.0.0.1", port });
  const log = createEventLogger("client", logger);
  const chunks: Buffer[] = [];
  const closed = new Promise<void>((resolve) => socket.once("close", resolve));

  socket.on("connect", () => log("연결 수립", `127.0.0.1:${port}`));
  socket.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
    log("데이터 수신", `bytes=${chunk.length}`);
  });
  socket.on("end", () => log("상대 송신 종료"));
  socket.on("finish", () => log("송신 종료"));
  socket.on("close", () => log("연결 종료"));
  socket.on("error", (error) => log("오류", error.message));

  await once(socket, "connect");
  if (mode === "graceful") {
    log("정상 종료 시작", "client-final");
    socket.end("client-final");
  } else {
    log("강제 로컬 정리 시작", "client-partial");
    socket.write("client-partial");
    socket.destroy(new Error("forced local teardown"));
  }

  await closed;
  if (mode === "graceful") {
    log("서버 응답 확인", Buffer.concat(chunks).toString("utf8"));
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const mode = parseMode(process.argv.slice(2));
  if (!mode) {
    console.error("사용법: npm run lesson:06:client -- --mode=graceful|forced");
    process.exitCode = 1;
  } else {
    void runConnectionCloseClient(mode).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`connection close client 실행 오류: ${message}`);
      process.exitCode = 1;
    });
  }
}
