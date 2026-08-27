import { connect } from "node:net";

type Mode = "split" | "combined";

const port = Number(process.env.PORT ?? 4002);
const mode = process.argv.find((argument) => argument.startsWith("--mode="))?.slice(7) ?? "split";

if (mode !== "split" && mode !== "combined") {
  throw new Error("mode must be split or combined");
}

const socket = connect({ host: "127.0.0.1", port });
let sequence = 0;
const log = (event: string): void => {
  sequence += 1;
  console.log(`[client #${sequence}] ${event}`);
};

socket.on("connect", () => {
  log(`connect mode=${mode}`);
  if (mode === "split") {
    socket.write("HEL");
    setTimeout(() => socket.end("LOWORLD"), 25);
    return;
  }

  socket.cork();
  socket.write("HELLO");
  socket.write("WORLD");
  socket.uncork();
  socket.end();
});
socket.on("finish", () => log("finish"));
socket.on("close", () => log("close"));
socket.on("error", (error) => log(`error ${error.message}`));
