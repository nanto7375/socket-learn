import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { pathToFileURL } from "node:url";

import { FrameDecoder, InvalidFrameError } from "../../src/protocol/frame.js";
import {
  encodeMessage,
  MessageDecodeError,
  parseClientMessage,
  type ClientMessage,
  type ProtocolErrorCode,
} from "../../src/protocol/message.js";

export interface ChatServerOptions {
  port?: number;
  logger?: (message: string) => void;
}

export interface ChatServerHandle {
  server: Server;
  port: number;
  joinedCount(): number;
  close(): Promise<void>;
}

interface ClientState {
  connectionId: number;
  name?: string;
  decoder: FrameDecoder;
  cleaned: boolean;
  sequence: number;
}

const DEFAULT_PORT = 4_004;

export async function startChatServer(
  options: ChatServerOptions = {},
): Promise<ChatServerHandle> {
  const port = options.port ?? Number(process.env.PORT ?? DEFAULT_PORT);
  const logger = options.logger ?? console.log;
  const clients = new Map<Socket, ClientState>();
  let nextConnectionId = 0;
  let closePromise: Promise<void> | undefined;

  const logConnection = (
    state: ClientState,
    event: string,
    detail = "",
  ): void => {
    state.sequence += 1;
    logger(
      `[연결:${state.connectionId} #${state.sequence}] ${event}${detail ? ` ${detail}` : ""}`,
    );
  };

  const cleanup = (socket: Socket, state: ClientState): void => {
    if (state.cleaned) return;
    state.cleaned = true;
    clients.delete(socket);
    logConnection(state, "연결 정리");
  };

  const sendFrame = (
    socket: Socket,
    state: ClientState,
    frame: Buffer,
  ): void => {
    if (socket.destroyed || socket.writableEnded) return;
    const writable = socket.write(frame);
    if (!writable) logConnection(state, "전송 지연(backpressure)");
  };

  const broadcastFrame = (frame: Buffer): void => {
    for (const [socket, state] of clients) {
      if (state.name !== undefined) sendFrame(socket, state, frame);
    }
  };

  const sendError = (
    socket: Socket,
    state: ClientState,
    code: ProtocolErrorCode,
    message: string,
  ): void => {
    sendFrame(socket, state, encodeMessage({ type: "error", code, message }));
  };

  const handleMessage = (
    socket: Socket,
    state: ClientState,
    message: ClientMessage,
  ): void => {
    if (socket.writableEnded) return;

    if (message.type === "join") {
      if (state.name !== undefined) {
        sendError(socket, state, "INVALID_MESSAGE", "join은 한 번만 허용됩니다.");
        socket.end();
        return;
      }
      const joinedFrame = encodeMessage({
        type: "system",
        text: `${message.name}님이 참여했습니다.`,
      });
      state.name = message.name;
      broadcastFrame(joinedFrame);
      return;
    }

    if (state.name === undefined) {
      sendError(socket, state, "NOT_JOINED", "먼저 join 메시지를 보내세요.");
      return;
    }

    const chatFrame = encodeMessage({
      type: "chat",
      from: state.name,
      text: message.text,
    });
    broadcastFrame(chatFrame);
  };

  const server = createServer((socket) => {
    const state: ClientState = {
      connectionId: ++nextConnectionId,
      decoder: new FrameDecoder(),
      cleaned: false,
      sequence: 0,
    };
    clients.set(socket, state);
    logConnection(state, "연결됨", `${socket.remoteAddress}:${socket.remotePort}`);

    socket.on("data", (chunk: Buffer) => {
      try {
        for (const payload of state.decoder.push(chunk)) {
          const message = parseClientMessage(payload);
          handleMessage(socket, state, message);
        }
      } catch (error) {
        if (error instanceof InvalidFrameError) {
          sendError(socket, state, "INVALID_FRAME", error.message);
        } else if (error instanceof MessageDecodeError) {
          sendError(socket, state, "INVALID_MESSAGE", error.message);
        } else {
          logConnection(state, "예상하지 못한 오류", String(error));
        }
        socket.end();
      }
    });
    socket.on("close", () => cleanup(socket, state));
    socket.on("error", (error) => {
      logConnection(state, "소켓 오류", error.message);
      cleanup(socket, state);
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    server.once("listening", onListening);
    server.once("error", onError);
    server.listen(port, "127.0.0.1");
  });

  const address = server.address() as AddressInfo;
  return {
    server,
    port: address.port,
    joinedCount: () =>
      [...clients.values()].filter((state) => state.name !== undefined).length,
    close: () => {
      if (closePromise) return closePromise;
      closePromise = new Promise<void>((resolve, reject) => {
        for (const socket of clients.keys()) socket.destroy();
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      return closePromise;
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startChatServer().then((handle) => {
    console.log(`채팅 서버 시작: 127.0.0.1:${handle.port}`);
  });
}
