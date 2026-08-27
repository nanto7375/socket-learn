export const HEADER_BYTES = 4;
export const MAX_PAYLOAD_BYTES = 65_536;

export class InvalidFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFrameError";
  }
}

function assertPayloadLength(length: number): void {
  if (length < 1 || length > MAX_PAYLOAD_BYTES) {
    throw new InvalidFrameError(
      `payload length must be between 1 and ${MAX_PAYLOAD_BYTES}: ${length}`,
    );
  }
}

export function encodeFrame(payload: Buffer): Buffer {
  assertPayloadLength(payload.length);
  const header = Buffer.allocUnsafe(HEADER_BYTES);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export class FrameDecoder {
  #buffer = Buffer.alloc(0);

  push(chunk: Buffer): Buffer[] {
    if (chunk.length > 0) {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
    }

    const payloads: Buffer[] = [];
    while (this.#buffer.length >= HEADER_BYTES) {
      const payloadLength = this.#buffer.readUInt32BE(0);
      assertPayloadLength(payloadLength);
      const frameLength = HEADER_BYTES + payloadLength;
      if (this.#buffer.length < frameLength) break;

      payloads.push(Buffer.from(this.#buffer.subarray(HEADER_BYTES, frameLength)));
      this.#buffer = this.#buffer.subarray(frameLength);
    }
    return payloads;
  }
}
