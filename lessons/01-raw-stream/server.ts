import { createServer, type Server } from "node:net";
import { pathToFileURL } from "node:url";

export interface RawChunkEvent {
  bytes: number;
  hex: string;
  text: string;
}

export interface RawStreamServerOptions {
  logger?: (line: string) => void;
  onChunk?: (event: RawChunkEvent) => void;
}

export function formatChunk(chunk: Buffer): RawChunkEvent {
  return {
    bytes: chunk.length,
    hex: chunk.toString("hex"),
    text: chunk.toString("utf8"),
  };
}

export function createRawStreamServer(
  options: RawStreamServerOptions = {},
): Server {
  const logger = options.logger ?? console.log;
  let nextConnectionId = 0;

  return createServer((socket) => {
    const connectionId = ++nextConnectionId;
    let sequence = 0;
    const peer = `${socket.remoteAddress}:${socket.remotePort}`;
    const log = (event: string, detail = ""): void => {
      sequence += 1;
      logger(
        `[connection:${connectionId} #${sequence}] ${event}${detail ? ` ${detail}` : ""}`,
      );
    };

    log("connect", peer);
    socket.on("data", (chunk) => {
      const event = formatChunk(Buffer.from(chunk));
      log(
        "data",
        `bytes=${event.bytes} hex=${event.hex} text=${JSON.stringify(event.text)}`,
      );
      options.onChunk?.(event);
    });
    socket.on("end", () => log("end"));
    socket.on("close", () => log("close"));
    socket.on("error", (error) => log("error", error.message));
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.PORT ?? 4001);
  createRawStreamServer().listen(port, "127.0.0.1", () => {
    console.log(`raw stream server: 127.0.0.1:${port}`);
  });
}
