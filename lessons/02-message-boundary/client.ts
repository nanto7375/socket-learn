import { connect } from "node:net";

type Mode = "split" | "combined";

const port = Number(process.env.PORT ?? 4002);
const mode = process.argv.find((argument) => argument.startsWith("--mode="))?.slice(7) ?? "split";

if (mode !== "split" && mode !== "combined") {
  throw new Error("mode는 split 또는 combined이어야 합니다");
}

const socket = connect({ host: "127.0.0.1", port });
let sequence = 0;
const log = (event: string): void => {
  sequence += 1;
  console.log(`[client #${sequence}] ${event}`);
};

socket.on("connect", () => {
  log(`연결됨 mode=${mode}`);
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
socket.on("finish", () => log("쓰기 완료"));
socket.on("close", () => log("연결 종료"));
socket.on("error", (error) => log(`오류 ${error.message}`));
