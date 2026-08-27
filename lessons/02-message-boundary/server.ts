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

  log(`connect ${socket.remoteAddress}:${socket.remotePort}`);
  socket.on("data", (chunk) => {
    messageNumber += 1;
    const text = chunk.toString("utf8");
    log(`message#${messageNumber} bytes=${chunk.length} text=${JSON.stringify(text)}`);
  });
  socket.on("end", () => log("end"));
  socket.on("close", () => log("close"));
  socket.on("error", (error) => log(`error ${error.message}`));
});

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  server.listen(port, "127.0.0.1", () => {
    console.log(`message boundary server: 127.0.0.1:${port}`);
  });
}
