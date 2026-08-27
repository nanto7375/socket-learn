# TCP Learning Socket Design

Date: 2026-08-27
Status: Approved in conversation
Project: `/Users/seungwoo/dev/coding/my-socket`

## Purpose

Build a small TypeScript CLI chat system on top of Node.js `node:net` to learn how TCP behaves. The project is an observation-first course, not a production socket library. Each lesson first exposes one TCP property, then introduces only enough code to handle that property.

## Goals

- Observe that TCP is a byte stream without application-message boundaries.
- Reproduce data arriving as partial frames or multiple frames in one chunk.
- Design and implement a length-prefixed application protocol.
- Build a multi-client CLI chat using that protocol.
- Observe backpressure through `socket.write()` and `drain`.
- Compare graceful close, abrupt close, and half-close behavior.
- Make every lesson independently runnable and explained in the root README.
- Verify framing with deterministic tests and chat behavior over real localhost TCP connections.

## Non-goals

- Authentication or authorization
- Browser or graphical UI
- Database persistence or chat history
- Encryption or a TLS implementation
- Automatic reconnection, clustering, or production deployment
- Reimplementing the operating system `socket()` syscall
- A production-grade slow-client policy

## Technical Boundary

Node.js `node:net` owns the operating-system TCP socket. Project code owns the application layer above it: frame encoding, incremental frame decoding, message validation, connection state, and chat behavior. TypeScript is used throughout.

Runtime dependencies are avoided. Development dependencies are limited to TypeScript, Node type definitions, and `tsx`. Tests use the Node.js built-in `node:test` runner.

## Project Structure

```text
my-socket/
├── lessons/
│   ├── 01-raw-stream/
│   ├── 02-message-boundary/
│   ├── 03-length-prefixed-protocol/
│   ├── 04-cli-chat/
│   ├── 05-backpressure/
│   └── 06-connection-close/
├── src/
│   └── protocol/
├── tests/
├── docs/superpowers/specs/
├── package.json
├── tsconfig.json
└── README.md
```

Lessons 01 and 02 intentionally contain small, local code that exposes a problem. Reusable protocol code appears only in lesson 03, under `src/protocol`, after the need for it has been demonstrated. Later lessons import that code instead of duplicating it.

## Learning Sequence

### 01 - Raw stream

Run a TCP server and one CLI client. Log connection metadata and the size, hexadecimal representation, and UTF-8 view of every `data` chunk. This establishes that the API exposes bytes delivered over a connection, not chat messages.

### 02 - Message boundary

Send several logical messages using different write sizes and timing. Demonstrate that calls to `write()` do not define boundaries for the receiver. Natural chunking is nondeterministic, so the lesson must not promise identical logs on every run. Deterministic examples separately feed split and combined chunks to a deliberately naive parser.

### 03 - Length-prefixed protocol

Introduce a four-byte length header, a frame encoder, and an incremental decoder. Show the decoder retaining an incomplete frame and extracting multiple complete frames in a loop.

### 04 - CLI chat

Build a server that tracks joined connections and broadcasts chat messages. Build a terminal client that reads lines from standard input. Keep connection state per client so a malformed or disconnected peer cannot terminate the server or corrupt another peer's state.

### 05 - Backpressure

Use a fast producer and intentionally slow consumer. Log the return value of `socket.write()`, pause production when it returns `false`, and resume on `drain`. Clarify that `false` means the user-space write buffer reached its threshold; it does not mean the bytes were rejected or delivered to the peer.

### 06 - Connection close

Log `data`, `end`, `finish`, `close`, and `error` with monotonic sequence numbers. Compare graceful `end()`, forced local teardown, and `allowHalfOpen` behavior. Include optional packet-capture instructions for observing connection establishment and FIN exchange, without making Wireshark a prerequisite.

## Wire Protocol

Each frame has this shape:

```text
+----------------------------+------------------------------+
| 4-byte unsigned big-endian | UTF-8 JSON payload           |
| payload byte length        | exactly the declared length  |
+----------------------------+------------------------------+
```

Rules:

- The header describes bytes, not JavaScript string characters.
- Valid payload length is 1 through 65,536 bytes.
- The encoder calculates length from the encoded `Buffer`.
- The decoder waits until at least four header bytes are buffered.
- It rejects an invalid length before waiting for or allocating its payload.
- It emits frames only when all declared payload bytes are buffered.
- It continues parsing until no complete frame remains.
- Any remaining partial header or payload stays buffered for the next chunk.

JSON keeps serialization readable so the exercises stay focused on TCP framing. It is not presented as the most compact wire format.

## Message Contract

Client-to-server messages:

```ts
type ClientMessage =
  | { type: "join"; name: string }
  | { type: "chat"; text: string };
```

Server-to-client messages:

```ts
type ServerMessage =
  | { type: "system"; text: string }
  | { type: "chat"; from: string; text: string }
  | {
      type: "error";
      code: "INVALID_FRAME" | "INVALID_MESSAGE" | "NOT_JOINED";
      message: string;
    };
```

Names and chat text must be non-empty strings after trimming. A client may join once; a second `join` is `INVALID_MESSAGE` and closes that connection. A `chat` message before `join`, an unknown message type, or a structurally invalid JSON value is a protocol error.

## Data Flow

Sending:

```text
CLI line -> typed message -> JSON -> UTF-8 Buffer
         -> 4-byte length header + payload -> socket.write()
```

Receiving:

```text
TCP data chunk -> decoder accumulation -> zero or more complete frames
               -> JSON parse -> runtime validation -> connection action
```

The chat server broadcasts a newly encoded server message to all joined clients. TCP preserves byte order within each connection, but ordering between different clients is defined only by the order in which the server handles their messages.

## Backpressure

The protocol encoder returns a `Buffer`; it does not hide `socket.write()`. This keeps the write result observable. Lesson 05 owns the full pause-and-`drain` loop. The chat lesson logs backpressure if encountered but deliberately does not grow into a production slow-consumer queueing system.

The README explains that a robust production chat server would need a bounded per-client queue or a disconnect policy. That policy remains out of scope.

## Error Handling

- Invalid declared length: send `INVALID_FRAME` when the connection is still writable, then end that connection.
- Invalid JSON or message shape: send `INVALID_MESSAGE`, then end that connection.
- Chat before join: send `NOT_JOINED` and keep the connection open so the client can join correctly.
- Socket I/O error: log it with the connection identifier and tear down only that connection.
- Client disconnect: remove it from the joined-client registry exactly once.
- Server startup error: report the port and error, then exit non-zero.

No parser or event callback may allow malformed peer input to become an uncaught exception that exits the server.

## Observability

Lesson logs include a connection identifier and a monotonically increasing event sequence number. The raw-stream and connection-close lessons also include chunk byte length. Backpressure logs include the `write()` result and the corresponding `drain` event.

The README distinguishes observations guaranteed by TCP from incidental chunk sizes produced by one operating-system run.

## Testing

### Frame unit tests

- Header split after each of its first three bytes
- Payload split at every possible byte boundary
- Several complete frames delivered in one chunk
- Complete frames followed by an incomplete frame
- Empty and oversized declared lengths
- Non-ASCII UTF-8 payload length
- Malformed JSON and structurally invalid messages

These cases call the decoder with explicit chunk sequences, making boundary tests deterministic.

### TCP integration tests

Use real localhost TCP sockets rather than mocks to verify:

- Two clients can join and exchange a broadcast message.
- Multiple frames sent together are processed in order.
- One malformed client is isolated from healthy clients.
- Disconnect cleanup removes the correct client.
- The server can shut down without leaving open test handles.

### Manual labs

Each lesson has commands, expected observations, and questions to answer. Any observation that depends on OS buffering or timing is labeled nondeterministic rather than asserted as a guaranteed result.

## Completion Criteria

- All six lessons run from documented commands.
- The CLI chat supports at least two simultaneous clients.
- The decoder handles arbitrary valid chunk partitions and concatenations.
- Type checking and compilation pass.
- Unit and real-TCP integration tests pass.
- The README explains what happened, why the next layer was introduced, and which behavior is guaranteed versus merely observed.
- Optional packet-capture instructions cover handshake and graceful close without being required for automated verification.
