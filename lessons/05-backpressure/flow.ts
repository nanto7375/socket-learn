import { once } from "node:events";
import type { Writable } from "node:stream";

export type FlowEvent =
  | { type: "write"; accepted: boolean; bytes: number }
  | { type: "pause" }
  | { type: "drain" };

export async function writeWithBackpressure(
  writable: Writable,
  chunks: Iterable<Buffer>,
  onEvent: (event: FlowEvent) => void = () => undefined,
): Promise<void> {
  for (const chunk of chunks) {
    const accepted = writable.write(chunk);
    onEvent({ type: "write", accepted, bytes: chunk.length });
    if (!accepted) {
      onEvent({ type: "pause" });
      await once(writable, "drain");
      onEvent({ type: "drain" });
    }
  }
}
