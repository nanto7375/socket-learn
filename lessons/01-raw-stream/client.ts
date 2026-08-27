import { connect } from "node:net";

const port = Number(process.env.PORT ?? 4001);
const text = process.argv.slice(2).join(" ") || "안녕 TCP";
const socket = connect({ host: "127.0.0.1", port });
let sequence = 0;
const log = (event: string, detail = ""): void => {
  sequence += 1;
  console.log(`[client #${sequence}] ${event}${detail ? ` ${detail}` : ""}`);
};

socket.on("connect", () => {
  log("connect");
  socket.end(text);
});
socket.on("finish", () => log("finish"));
socket.on("close", () => log("close"));
socket.on("error", (error) => log("error", error.message));
