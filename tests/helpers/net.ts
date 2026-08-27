import { once } from "node:events";
import type { AddressInfo, Server } from "node:net";

export async function listen(server: Server, port = 0): Promise<number> {
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

export async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}
