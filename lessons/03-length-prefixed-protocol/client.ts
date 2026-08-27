import { connect } from "node:net";

import { encodeFrame } from "../../src/protocol/frame.js";

const port = Number(process.env.PORT ?? 4003);
const socket = connect({ host: "127.0.0.1", port });
let sequence = 0;
const log = (event: string): void => {
  sequence += 1;
  console.log(`[client #${sequence}] ${event}`);
};

socket.on("connect", () => {
  const first = encodeFrame(Buffer.from("첫 번째 메시지"));
  const second = encodeFrame(Buffer.from("두 번째 메시지"));

  log("연결됨");
  socket.write(first.subarray(0, 2));
  socket.write(Buffer.concat([first.subarray(2), second]));
  socket.end();
});
socket.on("finish", () => log("쓰기 완료"));
socket.on("close", () => log("연결 종료"));
socket.on("error", (error) => log(`오류 ${error.message}`));
