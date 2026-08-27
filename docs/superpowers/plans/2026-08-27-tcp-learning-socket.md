# TCP 학습용 소켓 구현 계획

> **에이전트 작업자용:** 이 계획을 작업 단위로 실행할 때 `superpowers:subagent-driven-development`(권장) 또는 `superpowers:executing-plans` 스킬을 반드시 사용한다. 진행 상태는 체크박스(`- [ ]`)로 추적한다.

**목표:** TCP의 스트림, 메시지 프레이밍, backpressure, 연결 종료를 단계별로 관찰할 수 있는 TypeScript CLI 채팅 실습 프로젝트를 만든다.

**아키텍처:** 실습 01과 02는 문제를 그대로 노출하는 독립 코드로 유지한다. 실습 03에서 4바이트 길이 헤더 기반 프로토콜을 `src/protocol`에 도입하고, 실습 04 이후가 이를 재사용한다. 자동 검증은 결정적인 프레임 단위 테스트와 실제 localhost TCP 통합 테스트로 나눈다.

**기술 스택:** Node.js 24, TypeScript, `node:net`, `tsx`, Node.js 내장 `node:test`

**설계 문서:** `docs/superpowers/specs/2026-08-27-tcp-learning-socket-design.md`

## 전체 제약

- 프로젝트 경로는 `/Users/seungwoo/dev/coding/socket-learn`이다.
- 운영체제 TCP 소켓은 `node:net`을 사용하고 `socket()` 시스템 호출은 재구현하지 않는다.
- 런타임 의존성은 추가하지 않는다.
- 개발 의존성은 `typescript`, `@types/node`, `tsx`로 제한한다.
- payload는 UTF-8 JSON이며 4바이트 unsigned big-endian 길이 헤더를 사용한다.
- payload의 유효한 크기는 1바이트 이상 65,536바이트 이하이다.
- 인증, UI, DB, TLS 구현, 자동 재연결, 운영 수준의 느린 클라이언트 정책은 만들지 않는다.
- 모든 문서는 한글로 작성하고, 보장된 TCP 동작과 실행 환경에서 관찰한 현상을 구분한다.
- 각 구현 작업은 실패하는 테스트, 최소 구현, 통과 확인, 커밋 순서로 진행한다.
- 원격 저장소로 push하지 않는다.

---

## 파일 구조

구현이 끝났을 때의 책임 경계는 다음과 같다.

```text
socket-learn/
├── .gitignore                         # 빌드 결과와 의존성 제외
├── package.json                       # 실행, 검사, 실습 명령
├── package-lock.json                  # 개발 의존성 고정
├── tsconfig.json                      # 엄격한 ESM TypeScript 설정
├── README.md                          # 전체 학습 순서와 실행 안내
├── src/
│   └── protocol/
│       ├── frame.ts                   # 길이 헤더 인코딩과 점진적 디코딩
│       └── message.ts                 # JSON 직렬화와 런타임 메시지 검증
├── lessons/
│   ├── 01-raw-stream/
│   │   ├── server.ts                  # 원시 data chunk 관찰 서버
│   │   └── client.ts                  # UTF-8 데이터를 보내는 CLI
│   ├── 02-message-boundary/
│   │   ├── boundary.ts                # 같은 바이트의 서로 다른 chunk 배치
│   │   ├── server.ts                  # data 이벤트를 메시지로 오해하는 서버
│   │   └── client.ts                  # split/combined 쓰기 실험
│   ├── 03-length-prefixed-protocol/
│   │   ├── server.ts                  # 프레임을 복원하는 서버
│   │   └── client.ts                  # 프레임 분할/결합 송신 실험
│   ├── 04-cli-chat/
│   │   ├── server.ts                  # 연결 상태와 브로드캐스트
│   │   └── client.ts                  # readline 기반 채팅 CLI
│   ├── 05-backpressure/
│   │   ├── flow.ts                    # write false와 drain 대기 루프
│   │   ├── producer.ts                # 작은 highWaterMark를 쓰는 빠른 생산자
│   │   └── consumer.ts                # 수신을 잠시 멈추는 느린 소비자
│   └── 06-connection-close/
│       ├── event-log.ts               # 연결 이벤트 순번 기록
│       ├── server.ts                  # 기본/half-open 종료 비교 서버
│       └── client.ts                  # graceful/forced 종료 실험
└── tests/
    ├── helpers/
    │   ├── net.ts                     # listen/connect/close 비동기 헬퍼
    │   └── chat-client.ts             # 통합 테스트용 프레임 클라이언트
    ├── raw-stream.test.ts
    ├── message-boundary.test.ts
    ├── frame.test.ts
    ├── message.test.ts
    ├── chat.integration.test.ts
    ├── backpressure.test.ts
    └── connection-close.integration.test.ts
```

---

### 작업 1: 프로젝트 기반과 원시 TCP 스트림

**파일:**
- 생성: `.gitignore`
- 생성: `package.json`
- 생성: `package-lock.json`
- 생성: `tsconfig.json`
- 생성: `tests/helpers/net.ts`
- 생성: `tests/raw-stream.test.ts`
- 생성: `lessons/01-raw-stream/server.ts`
- 생성: `lessons/01-raw-stream/client.ts`

**인터페이스:**
- 생성: `createRawStreamServer(options?: RawStreamServerOptions): net.Server`
- 생성: `formatChunk(chunk: Buffer): RawChunkEvent`
- 생성: `listen(server: net.Server, port?: number): Promise<number>`
- 생성: `closeServer(server: net.Server): Promise<void>`
- 이후 작업은 이 설정과 테스트 헬퍼를 사용한다.

- [ ] **1단계: Node.js/TypeScript 기반 설정을 만든다**

`package.json`의 핵심 내용:

```json
{
  "name": "socket-learn",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "tsx --test tests/**/*.test.ts",
    "lesson:01:server": "tsx lessons/01-raw-stream/server.ts",
    "lesson:01:client": "tsx lessons/01-raw-stream/client.ts"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "rootDir": ".",
    "outDir": "dist",
    "sourceMap": true,
    "declaration": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "lessons/**/*.ts", "tests/**/*.ts"]
}
```

`.gitignore`:

```gitignore
node_modules/
dist/
*.log
.DS_Store
```

실행:

```bash
npm install --save-dev typescript @types/node tsx
```

예상: `package-lock.json`이 생성되고 런타임 `dependencies`는 비어 있다.

- [ ] **2단계: 원시 chunk 포맷 테스트를 먼저 작성한다**

`tests/raw-stream.test.ts`:

```ts
import assert from "node:assert/strict";
import { once } from "node:events";
import { connect } from "node:net";
import { test } from "node:test";

import {
  createRawStreamServer,
  type RawChunkEvent,
} from "../lessons/01-raw-stream/server.js";
import { closeServer, listen } from "./helpers/net.js";

test("서버는 UTF-8 문자를 실제 바이트 기준으로 관찰한다", async (t) => {
  const chunks: RawChunkEvent[] = [];
  const server = createRawStreamServer({
    logger: () => undefined,
    onChunk: (chunk) => chunks.push(chunk),
  });
  const port = await listen(server);
  t.after(() => closeServer(server));

  const socket = connect({ host: "127.0.0.1", port });
  await once(socket, "connect");
  socket.end("안녕");
  await once(socket, "close");

  assert.deepEqual(chunks, [
    {
      bytes: 6,
      hex: Buffer.from("안녕").toString("hex"),
      text: "안녕",
    },
  ]);
});
```

`tests/helpers/net.ts`는 뒤의 모든 TCP 통합 테스트가 공유할 수 있도록 이 단계에서 완성한다.

```ts
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
```

- [ ] **3단계: 테스트가 필요한 구현이 없어 실패하는지 확인한다**

실행:

```bash
npx tsx --test tests/raw-stream.test.ts
```

예상: `lessons/01-raw-stream/server.js` 모듈을 찾지 못해 FAIL.

- [ ] **4단계: 원시 서버를 최소 구현한다**

`lessons/01-raw-stream/server.ts`의 핵심 구현:

```ts
import { createServer, type Server } from "node:net";
import { pathToFileURL } from "node:url";

export interface RawChunkEvent {
  bytes: number;
  hex: string;
  text: string;
}

export interface RawStreamServerOptions {
  logger?: (line: string) => void;
  onChunk?: (event: RawChunkEvent) => void;
}

export function formatChunk(chunk: Buffer): RawChunkEvent {
  return {
    bytes: chunk.length,
    hex: chunk.toString("hex"),
    text: chunk.toString("utf8"),
  };
}

export function createRawStreamServer(
  options: RawStreamServerOptions = {},
): Server {
  const logger = options.logger ?? console.log;
  let nextConnectionId = 0;
  return createServer((socket) => {
    const connectionId = ++nextConnectionId;
    let sequence = 0;
    const peer = `${socket.remoteAddress}:${socket.remotePort}`;
    const log = (event: string, detail = ""): void => {
      sequence += 1;
      logger(
        `[connection:${connectionId} #${sequence}] ${event}${detail ? ` ${detail}` : ""}`,
      );
    };
    log("connect", peer);
    socket.on("data", (chunk) => {
      const event = formatChunk(chunk);
      log(
        "data",
        `bytes=${event.bytes} hex=${event.hex} text=${JSON.stringify(event.text)}`,
      );
      options.onChunk?.(event);
    });
    socket.on("end", () => log("end"));
    socket.on("close", () => log("close"));
    socket.on("error", (error) => log("error", error.message));
  });
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4001);
  createRawStreamServer().listen(port, "127.0.0.1", () => {
    console.log(`raw stream server: 127.0.0.1:${port}`);
  });
}
```

`lessons/01-raw-stream/client.ts`는 다음 흐름으로 연결 이벤트를 순서대로 기록한다.

```ts
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
```

- [ ] **5단계: 테스트, 타입 검사, 빌드를 확인한다**

```bash
npx tsx --test tests/raw-stream.test.ts
npm run typecheck
npm run build
```

예상: 모든 명령 PASS. 빌드 결과는 `dist/lessons/01-raw-stream`과 `dist/tests` 아래에 생성된다.

- [ ] **6단계: 작업 1을 커밋한다**

```bash
git add .gitignore package.json package-lock.json tsconfig.json lessons/01-raw-stream tests/helpers/net.ts tests/raw-stream.test.ts
git commit -m "feat: add raw TCP stream lesson"
```

---

### 작업 2: 메시지 경계 문제 재현

**파일:**
- 생성: `lessons/02-message-boundary/boundary.ts`
- 생성: `lessons/02-message-boundary/server.ts`
- 생성: `lessons/02-message-boundary/client.ts`
- 생성: `tests/message-boundary.test.ts`
- 수정: `package.json`

**인터페이스:**
- 생성: `splitBytes(bytes: Buffer, splitPoints: readonly number[]): Buffer[]`
- 생성: `interpretEachChunkAsMessage(chunks: readonly Buffer[]): string[]`
- 이 작업은 같은 바이트라도 data chunk 배치에 따라 잘못 해석한 메시지가 달라짐을 보여준다.

- [ ] **1단계: 동일한 바이트 스트림의 서로 다른 chunk 해석 테스트를 작성한다**

`tests/message-boundary.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  interpretEachChunkAsMessage,
  splitBytes,
} from "../lessons/02-message-boundary/boundary.js";

test("같은 바이트도 chunk 경계를 메시지 경계로 오해하면 결과가 달라진다", () => {
  const bytes = Buffer.from("HELLOWORLD");

  const split = splitBytes(bytes, [5]);
  const fragmented = splitBytes(bytes, [2, 7]);

  assert.deepEqual(interpretEachChunkAsMessage(split), ["HELLO", "WORLD"]);
  assert.deepEqual(interpretEachChunkAsMessage(fragmented), [
    "HE",
    "LLOWO",
    "RLD",
  ]);
  assert.equal(Buffer.concat(split).equals(Buffer.concat(fragmented)), true);
});

test("여러 논리 메시지가 한 chunk로 합쳐질 수도 있다", () => {
  const combined = [Buffer.concat([Buffer.from("ONE"), Buffer.from("TWO")])];
  assert.deepEqual(interpretEachChunkAsMessage(combined), ["ONETWO"]);
});
```

- [ ] **2단계: 테스트 실패를 확인한다**

```bash
npx tsx --test tests/message-boundary.test.ts
```

예상: `boundary.js` 모듈이 없어 FAIL.

- [ ] **3단계: 경계 실험 함수를 구현한다**

`lessons/02-message-boundary/boundary.ts`:

```ts
export function splitBytes(
  bytes: Buffer,
  splitPoints: readonly number[],
): Buffer[] {
  const points = [0, ...splitPoints, bytes.length];
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    if (end === undefined || start < 0 || end <= start || end > bytes.length) {
      throw new RangeError("splitPoints must be strictly increasing");
    }
    return bytes.subarray(start, end);
  });
}

export function interpretEachChunkAsMessage(
  chunks: readonly Buffer[],
): string[] {
  return chunks.map((chunk) => chunk.toString("utf8"));
}
```

`server.ts`는 각 `data` 이벤트에 `message#N`, 바이트 길이, UTF-8 문자열을 출력한다. `client.ts`는 `--mode=split`이면 `HEL`과 `LOWORLD`를 25ms 간격으로 쓰고, `--mode=combined`이면 `socket.cork()` 안에서 `HELLO`와 `WORLD`를 연속으로 쓴 뒤 `uncork()`와 `end()`를 호출한다. README에는 실제 data 이벤트 경계가 매번 동일하다고 보장할 수 없음을 명시한다.

- [ ] **4단계: 실행 스크립트를 추가한다**

```bash
npm pkg set scripts.lesson:02:server="tsx lessons/02-message-boundary/server.ts"
npm pkg set scripts.lesson:02:client="tsx lessons/02-message-boundary/client.ts"
```

- [ ] **5단계: 작업 2 검증을 실행한다**

```bash
npx tsx --test tests/message-boundary.test.ts
npm run typecheck
npm run build
```

예상: 모두 PASS.

- [ ] **6단계: 작업 2를 커밋한다**

```bash
git add package.json package-lock.json lessons/02-message-boundary tests/message-boundary.test.ts
git commit -m "feat: demonstrate missing TCP message boundaries"
```

---

### 작업 3: 길이 헤더 프레임 인코더와 점진적 디코더

**파일:**
- 생성: `src/protocol/frame.ts`
- 생성: `tests/frame.test.ts`
- 생성: `lessons/03-length-prefixed-protocol/server.ts`
- 생성: `lessons/03-length-prefixed-protocol/client.ts`
- 수정: `package.json`

**인터페이스:**
- 생성: `MAX_PAYLOAD_BYTES = 65_536`
- 생성: `encodeFrame(payload: Buffer): Buffer`
- 생성: `InvalidFrameError extends Error`
- 생성: `FrameDecoder.push(chunk: Buffer): Buffer[]`
- 이후 메시지와 채팅 작업은 이 API만 사용해 TCP chunk를 payload로 복원한다.

- [ ] **1단계: 프레임 경계 전체를 검사하는 실패 테스트를 작성한다**

`tests/frame.test.ts`의 필수 테스트:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  encodeFrame,
  FrameDecoder,
  InvalidFrameError,
  MAX_PAYLOAD_BYTES,
} from "../src/protocol/frame.js";

test("헤더는 UTF-8 문자열 길이가 아닌 payload 바이트 길이를 기록한다", () => {
  const frame = encodeFrame(Buffer.from("안녕"));
  assert.equal(frame.readUInt32BE(0), 6);
  assert.equal(frame.subarray(4).toString("utf8"), "안녕");
});

test("프레임의 모든 가능한 위치에서 나뉘어도 하나로 복원한다", () => {
  const frame = encodeFrame(Buffer.from("hello"));
  for (let split = 1; split < frame.length; split += 1) {
    const decoder = new FrameDecoder();
    assert.deepEqual(decoder.push(frame.subarray(0, split)), []);
    assert.deepEqual(decoder.push(frame.subarray(split)), [
      Buffer.from("hello"),
    ]);
  }
});

test("한 chunk의 여러 프레임과 마지막 미완성 프레임을 처리한다", () => {
  const one = encodeFrame(Buffer.from("one"));
  const two = encodeFrame(Buffer.from("two"));
  const three = encodeFrame(Buffer.from("three"));
  const decoder = new FrameDecoder();

  assert.deepEqual(
    decoder.push(Buffer.concat([one, two, three.subarray(0, 6)])),
    [Buffer.from("one"), Buffer.from("two")],
  );
  assert.deepEqual(decoder.push(three.subarray(6)), [Buffer.from("three")]);
});

test("0바이트와 최대 크기 초과 길이를 즉시 거부한다", () => {
  for (const length of [0, MAX_PAYLOAD_BYTES + 1]) {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(length);
    assert.throws(
      () => new FrameDecoder().push(header),
      InvalidFrameError,
    );
  }
});
```

- [ ] **2단계: 프레임 테스트 실패를 확인한다**

```bash
npx tsx --test tests/frame.test.ts
```

예상: `src/protocol/frame.js`가 없어 FAIL.

- [ ] **3단계: 인코더와 점진적 디코더를 최소 구현한다**

`src/protocol/frame.ts`:

```ts
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
```

- [ ] **4단계: 프레임 테스트가 통과하는지 확인한다**

```bash
npx tsx --test tests/frame.test.ts
```

예상: 4개 테스트 PASS.

- [ ] **5단계: 실제 TCP 위의 프레임 분할/결합 실습을 만든다**

`server.ts`는 연결마다 `FrameDecoder`를 하나씩 만들고 각 `data` chunk의 크기와 `decoder.push(chunk)`가 돌려준 payload 개수를 기록한다. `client.ts`는 다음 두 프레임을 만든다.

```ts
const first = encodeFrame(Buffer.from("첫 번째 메시지"));
const second = encodeFrame(Buffer.from("두 번째 메시지"));

socket.write(first.subarray(0, 2));
socket.write(Buffer.concat([first.subarray(2), second]));
socket.end();
```

이 배치는 헤더 일부와 나머지 프레임을 서로 다른 쓰기로 보내고, 이어서 두 번째 프레임까지 결합한다. 서버의 실제 `data` 이벤트 경계는 달라질 수 있지만 디코딩 결과는 항상 두 메시지여야 한다.

스크립트 추가:

```bash
npm pkg set scripts.lesson:03:server="tsx lessons/03-length-prefixed-protocol/server.ts"
npm pkg set scripts.lesson:03:client="tsx lessons/03-length-prefixed-protocol/client.ts"
```

- [ ] **6단계: 작업 3 전체를 검증한다**

```bash
npx tsx --test tests/frame.test.ts
npm run typecheck
npm run build
```

예상: 모두 PASS.

- [ ] **7단계: 작업 3을 커밋한다**

```bash
git add package.json package-lock.json src/protocol/frame.ts lessons/03-length-prefixed-protocol tests/frame.test.ts
git commit -m "feat: add length-prefixed frame protocol"
```

---

### 작업 4: JSON 메시지 계약과 런타임 검증

**파일:**
- 생성: `src/protocol/message.ts`
- 생성: `tests/message.test.ts`

**인터페이스:**
- 생성: `ClientMessage`, `ServerMessage`, `ProtocolErrorCode`
- 생성: `MessageDecodeError extends Error`
- 생성: `encodeMessage(message: ClientMessage | ServerMessage): Buffer`
- 생성: `parseClientMessage(payload: Buffer): ClientMessage`
- 생성: `parseServerMessage(payload: Buffer): ServerMessage`

- [ ] **1단계: 메시지 직렬화와 잘못된 입력 테스트를 작성한다**

`tests/message.test.ts`의 핵심 테스트:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { FrameDecoder } from "../src/protocol/frame.js";
import {
  encodeMessage,
  MessageDecodeError,
  parseClientMessage,
  parseServerMessage,
} from "../src/protocol/message.js";

test("한글 메시지를 프레임으로 인코딩하고 다시 검증한다", () => {
  const [payload] = new FrameDecoder().push(
    encodeMessage({ type: "chat", text: " 안녕 " }),
  );
  assert.ok(payload);
  assert.deepEqual(parseClientMessage(payload), {
    type: "chat",
    text: "안녕",
  });
});

test("잘못된 JSON, 빈 문자열, 알 수 없는 type을 거부한다", () => {
  const invalidPayloads = [
    Buffer.from("{"),
    Buffer.from(JSON.stringify({ type: "join", name: "  " })),
    Buffer.from(JSON.stringify({ type: "unknown" })),
  ];
  for (const payload of invalidPayloads) {
    assert.throws(() => parseClientMessage(payload), MessageDecodeError);
  }
});

test("서버 error 메시지의 code를 검증한다", () => {
  const value = Buffer.from(
    JSON.stringify({
      type: "error",
      code: "NOT_JOINED",
      message: "먼저 참여하세요.",
    }),
  );
  assert.deepEqual(parseServerMessage(value), {
    type: "error",
    code: "NOT_JOINED",
    message: "먼저 참여하세요.",
  });
});
```

- [ ] **2단계: 메시지 테스트 실패를 확인한다**

```bash
npx tsx --test tests/message.test.ts
```

예상: `src/protocol/message.js`가 없어 FAIL.

- [ ] **3단계: 타입과 런타임 파서를 구현한다**

`src/protocol/message.ts`는 다음 타입을 그대로 제공한다.

```ts
import { encodeFrame } from "./frame.js";

export type ProtocolErrorCode =
  | "INVALID_FRAME"
  | "INVALID_MESSAGE"
  | "NOT_JOINED";

export type ClientMessage =
  | { type: "join"; name: string }
  | { type: "chat"; text: string };

export type ServerMessage =
  | { type: "system"; text: string }
  | { type: "chat"; from: string; text: string }
  | { type: "error"; code: ProtocolErrorCode; message: string };

export class MessageDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageDecodeError";
  }
}

function parseJson(payload: Buffer): unknown {
  try {
    return JSON.parse(payload.toString("utf8"));
  } catch {
    throw new MessageDecodeError("payload must be valid JSON");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MessageDecodeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

export function encodeMessage(
  message: ClientMessage | ServerMessage,
): Buffer {
  return encodeFrame(Buffer.from(JSON.stringify(message), "utf8"));
}

function parseObject(payload: Buffer): Record<string, unknown> {
  const value = parseJson(payload);
  if (!isRecord(value)) {
    throw new MessageDecodeError("message must be a JSON object");
  }
  return value;
}

export function parseClientMessage(payload: Buffer): ClientMessage {
  const value = parseObject(payload);
  if (value.type === "join") {
    return { type: "join", name: readText(value.name, "name") };
  }
  if (value.type === "chat") {
    return { type: "chat", text: readText(value.text, "text") };
  }
  throw new MessageDecodeError("unknown client message type");
}

const ERROR_CODES = new Set<ProtocolErrorCode>([
  "INVALID_FRAME",
  "INVALID_MESSAGE",
  "NOT_JOINED",
]);

export function parseServerMessage(payload: Buffer): ServerMessage {
  const value = parseObject(payload);
  if (value.type === "system") {
    return { type: "system", text: readText(value.text, "text") };
  }
  if (value.type === "chat") {
    return {
      type: "chat",
      from: readText(value.from, "from"),
      text: readText(value.text, "text"),
    };
  }
  if (
    value.type === "error" &&
    typeof value.code === "string" &&
    ERROR_CODES.has(value.code as ProtocolErrorCode)
  ) {
    return {
      type: "error",
      code: value.code as ProtocolErrorCode,
      message: readText(value.message, "message"),
    };
  }
  throw new MessageDecodeError("unknown server message type");
}
```

- [ ] **4단계: 메시지 테스트와 전체 정적 검사를 실행한다**

```bash
npx tsx --test tests/message.test.ts
npm run typecheck
npm run build
```

예상: 모두 PASS.

- [ ] **5단계: 작업 4를 커밋한다**

```bash
git add src/protocol/message.ts tests/message.test.ts
git commit -m "feat: validate framed chat messages"
```

---

### 작업 5: 여러 클라이언트 CLI 채팅

**파일:**
- 생성: `tests/helpers/chat-client.ts`
- 생성: `tests/chat.integration.test.ts`
- 생성: `lessons/04-cli-chat/server.ts`
- 생성: `lessons/04-cli-chat/client.ts`
- 수정: `package.json`

**인터페이스:**
- 생성: `startChatServer(options?: ChatServerOptions): Promise<ChatServerHandle>`
- `ChatServerHandle`: `server`, `port`, `joinedCount()`, `close()`
- 테스트 클라이언트: `connectChatClient(port)`, `send(message)`, `sendRaw(frame)`, `nextMessage(type)`, `closed()`, `close()`

- [ ] **1단계: 실제 TCP 채팅 통합 테스트를 작성한다**

`tests/chat.integration.test.ts`는 각 테스트 후 서버와 클라이언트를 닫고 다음을 검증한다.

```ts
test("두 클라이언트가 참여하고 채팅을 브로드캐스트한다", async (t) => {
  const server = await startChatServer({ port: 0, logger: () => undefined });
  t.after(() => server.close());
  const alice = await connectChatClient(server.port);
  const bob = await connectChatClient(server.port);
  t.after(async () => {
    await Promise.all([alice.close(), bob.close()]);
  });

  alice.send({ type: "join", name: "alice" });
  await alice.nextMessage("system");
  bob.send({ type: "join", name: "bob" });
  await bob.nextMessage("system");
  await alice.nextMessage("system");

  alice.send({ type: "chat", text: "안녕" });
  assert.deepEqual(await bob.nextMessage("chat"), {
    type: "chat",
    from: "alice",
    text: "안녕",
  });
});

test("참여 전 chat은 오류 후에도 연결을 유지한다", async () => {
  const server = await startChatServer({ port: 0, logger: () => undefined });
  const client = await connectChatClient(server.port);
  try {
    client.send({ type: "chat", text: "먼저 보냄" });
    assert.equal((await client.nextMessage("error")).code, "NOT_JOINED");
    client.send({ type: "join", name: "late" });
    assert.equal((await client.nextMessage("system")).type, "system");
  } finally {
    await client.close();
    await server.close();
  }
});
```

같은 파일에 다음 세 테스트를 추가한다.

```ts
test("한 번에 보낸 join과 chat 프레임을 순서대로 처리한다", async (t) => {
  const server = await startChatServer({ port: 0, logger: () => undefined });
  t.after(() => server.close());
  const observer = await connectChatClient(server.port);
  const sender = await connectChatClient(server.port);
  t.after(async () => {
    await Promise.all([observer.close(), sender.close()]);
  });

  observer.send({ type: "join", name: "observer" });
  await observer.nextMessage("system");

  sender.sendRaw(
    Buffer.concat([
      encodeMessage({ type: "join", name: "sender" }),
      encodeMessage({ type: "chat", text: "붙여서 전송" }),
    ]),
  );

  await observer.nextMessage("system");
  assert.deepEqual(await observer.nextMessage("chat"), {
    type: "chat",
    from: "sender",
    text: "붙여서 전송",
  });
});

test("잘못된 JSON을 보낸 연결만 종료한다", async (t) => {
  const server = await startChatServer({ port: 0, logger: () => undefined });
  t.after(() => server.close());
  const healthy = await connectChatClient(server.port);
  const malformed = await connectChatClient(server.port);
  t.after(async () => {
    await Promise.all([healthy.close(), malformed.close()]);
  });

  healthy.send({ type: "join", name: "healthy" });
  await healthy.nextMessage("system");

  malformed.sendRaw(encodeFrame(Buffer.from("{")));
  assert.equal(
    (await malformed.nextMessage("error")).code,
    "INVALID_MESSAGE",
  );
  await malformed.closed();

  healthy.send({ type: "chat", text: "still alive" });
  assert.equal((await healthy.nextMessage("chat")).text, "still alive");
});

test("두 번째 join은 오류 후 연결을 정리한다", async (t) => {
  const server = await startChatServer({ port: 0, logger: () => undefined });
  t.after(() => server.close());
  const client = await connectChatClient(server.port);

  client.send({ type: "join", name: "once" });
  await client.nextMessage("system");
  client.send({ type: "join", name: "twice" });

  assert.equal((await client.nextMessage("error")).code, "INVALID_MESSAGE");
  await client.closed();
  await waitFor(() => server.joinedCount() === 0);
  assert.equal(server.joinedCount(), 0);
});
```

테스트 파일의 `waitFor`:

```ts
import { setTimeout as delay } from "node:timers/promises";

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  throw new Error("condition was not met");
}
```

- [ ] **2단계: 채팅 통합 테스트 실패를 확인한다**

```bash
npx tsx --test tests/chat.integration.test.ts
```

예상: 채팅 서버와 테스트 클라이언트 모듈이 없어 FAIL.

- [ ] **3단계: 연결별 상태를 가진 채팅 서버를 구현한다**

`server.ts`의 연결 상태:

```ts
interface ClientState {
  name?: string;
  decoder: FrameDecoder;
  cleaned: boolean;
  sequence: number;
}
```

데이터 처리 순서는 다음 코드 형태로 고정한다.

```ts
socket.on("data", (chunk) => {
  try {
    for (const payload of state.decoder.push(chunk)) {
      const message = parseClientMessage(payload);
      handleMessage(socket, state, message);
    }
  } catch (error) {
    if (error instanceof InvalidFrameError) {
      sendError(socket, "INVALID_FRAME", error.message);
    } else if (error instanceof MessageDecodeError) {
      sendError(socket, "INVALID_MESSAGE", error.message);
    } else {
      logConnection(state, "unexpected-error", String(error));
    }
    socket.end();
  }
});
```

`handleMessage` 규칙:

```ts
if (message.type === "join") {
  if (state.name !== undefined) {
    sendError(socket, "INVALID_MESSAGE", "join is allowed once");
    socket.end();
    return;
  }
  state.name = message.name;
  broadcast({ type: "system", text: `${message.name}님이 참여했습니다.` });
  return;
}

if (state.name === undefined) {
  sendError(socket, "NOT_JOINED", "먼저 join 메시지를 보내세요.");
  return;
}

broadcast({ type: "chat", from: state.name, text: message.text });
```

`logConnection(state, event, detail)`은 `state.sequence`를 1씩 증가시키고 연결 식별자와 함께 출력한다. `send`는 `socket.write(encodeMessage(message))`의 반환값을 확인해 `false`이면 `logConnection`으로 `backpressure`를 기록한다. `close`와 `error`는 멱등인 `cleanup()`을 호출해 클라이언트 Map에서 정확히 한 번 제거한다. `ChatServerHandle.close()`는 남은 소켓을 `destroy()`한 뒤 `server.close()` 완료를 기다린다.

- [ ] **4단계: 통합 테스트용 프레임 클라이언트를 구현한다**

`tests/helpers/chat-client.ts`는 실제 `net.Socket`, `FrameDecoder`, `parseServerMessage`를 사용한다. 수신 메시지는 FIFO 배열에 넣고, `nextMessage(type)`는 이미 도착한 해당 타입 메시지를 꺼내거나 1초 제한 Promise로 다음 메시지를 기다린다. 제한 시간이 지나면 수신한 메시지 목록을 포함한 오류로 실패한다. `sendRaw`는 제공된 Buffer를 그대로 `socket.write()`한다.

```ts
type MessageOfType<T extends ServerMessage["type"]> = Extract<
  ServerMessage,
  { type: T }
>;

export interface TestChatClient {
  send(message: ClientMessage): void;
  sendRaw(frame: Buffer): void;
  nextMessage<T extends ServerMessage["type"]>(
    type: T,
  ): Promise<MessageOfType<T>>;
  closed(): Promise<void>;
  close(): Promise<void>;
}

export function connectChatClient(port: number): Promise<TestChatClient>;
```

`closed()`는 소켓 생성 시 등록한 단일 close Promise를 반환한다. `close()`는 이미 닫혔으면 즉시 끝나고, 열려 있으면 `socket.end()` 후 같은 close Promise를 기다리므로 반복 호출해도 안전하다.

- [ ] **5단계: readline 기반 CLI 클라이언트를 구현한다**

`client.ts`는 `process.argv[2]`를 이름으로 받고 없으면 사용법을 출력한 뒤 종료 코드 1로 끝낸다. 연결 직후 `join` 프레임을 보내고, `readline.createInterface({ input: process.stdin })`의 각 줄을 `chat` 프레임으로 전송한다. 서버 응답은 `FrameDecoder`와 `parseServerMessage`로 복원해 `system`, `chat`, `error` 형식으로 출력한다. `SIGINT`에서는 readline을 닫고 `socket.end()`를 호출한다.

스크립트:

```bash
npm pkg set scripts.lesson:04:server="tsx lessons/04-cli-chat/server.ts"
npm pkg set scripts.lesson:04:client="tsx lessons/04-cli-chat/client.ts"
```

- [ ] **6단계: 채팅과 전체 회귀 검사를 실행한다**

```bash
npx tsx --test tests/chat.integration.test.ts
npm test
npm run typecheck
npm run build
```

예상: 모두 PASS이며 열린 handle 경고가 없다.

- [ ] **7단계: 작업 5를 커밋한다**

```bash
git add package.json package-lock.json lessons/04-cli-chat tests/helpers/chat-client.ts tests/chat.integration.test.ts
git commit -m "feat: add framed multi-client CLI chat"
```

---

### 작업 6: Backpressure 관찰

**파일:**
- 생성: `lessons/05-backpressure/flow.ts`
- 생성: `lessons/05-backpressure/producer.ts`
- 생성: `lessons/05-backpressure/consumer.ts`
- 생성: `tests/backpressure.test.ts`
- 수정: `package.json`

**인터페이스:**
- 생성: `writeWithBackpressure(writable: Writable, chunks: Iterable<Buffer>, onEvent?: (event: FlowEvent) => void): Promise<void>`
- `FlowEvent`는 `write`, `pause`, `drain`과 각 쓰기의 반환값을 기록한다.

- [ ] **1단계: 작은 highWaterMark로 pause와 drain을 강제하는 테스트를 작성한다**

`tests/backpressure.test.ts`:

```ts
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";

import {
  type FlowEvent,
  writeWithBackpressure,
} from "../lessons/05-backpressure/flow.js";

test("write가 false이면 drain까지 다음 chunk를 쓰지 않는다", async () => {
  const writes: string[] = [];
  const events: FlowEvent[] = [];
  const writable = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, callback) {
      writes.push(chunk.toString());
      setImmediate(callback);
    },
  });

  await writeWithBackpressure(
    writable,
    [Buffer.from("A"), Buffer.from("B")],
    (event) => events.push(event),
  );

  assert.deepEqual(writes, ["A", "B"]);
  assert.deepEqual(
    events.map((event) => event.type),
    ["write", "pause", "drain", "write", "pause", "drain"],
  );
});
```

- [ ] **2단계: backpressure 테스트 실패를 확인한다**

```bash
npx tsx --test tests/backpressure.test.ts
```

예상: `flow.js` 모듈이 없어 FAIL.

- [ ] **3단계: drain 대기 루프를 구현한다**

`lessons/05-backpressure/flow.ts`:

```ts
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
```

- [ ] **4단계: 실제 TCP 생산자와 느린 소비자를 만든다**

`consumer.ts`는 연결 직후 `socket.pause()`를 호출하고 1초 뒤 `socket.resume()`한다. 모든 `data`의 누적 바이트를 기록한다.

`producer.ts`는 `new Socket({ writableHighWaterMark: 1024 })`로 연결하고, 64 KiB Buffer 32개를 `writeWithBackpressure`에 전달한다. 각 `write`의 `accepted`, `pause`, `drain`을 순번과 함께 출력한 뒤 `socket.end()`한다. 이 설정은 쓰기 chunk가 highWaterMark보다 크므로 `false` 반환을 재현할 수 있다.

스크립트:

```bash
npm pkg set scripts.lesson:05:consumer="tsx lessons/05-backpressure/consumer.ts"
npm pkg set scripts.lesson:05:producer="tsx lessons/05-backpressure/producer.ts"
```

- [ ] **5단계: 작업 6 검증을 실행한다**

```bash
npx tsx --test tests/backpressure.test.ts
npm test
npm run typecheck
npm run build
```

예상: 모두 PASS.

- [ ] **6단계: 작업 6을 커밋한다**

```bash
git add package.json package-lock.json lessons/05-backpressure tests/backpressure.test.ts
git commit -m "feat: demonstrate TCP write backpressure"
```

---

### 작업 7: 정상 종료와 half-close 관찰

**파일:**
- 생성: `lessons/06-connection-close/event-log.ts`
- 생성: `lessons/06-connection-close/server.ts`
- 생성: `lessons/06-connection-close/client.ts`
- 생성: `tests/connection-close.integration.test.ts`
- 수정: `package.json`

**인터페이스:**
- 생성: `createEventLogger(label: string, sink?: (line: string) => void): (event: string, detail?: string) => void`
- 생성: `startHalfOpenServer(port?: number, logger?: (line: string) => void): Promise<{ server: net.Server; port: number }>`

- [ ] **1단계: half-close의 양방향 독립성을 확인하는 통합 테스트를 작성한다**

`tests/connection-close.integration.test.ts`:

```ts
import assert from "node:assert/strict";
import { once } from "node:events";
import { connect } from "node:net";
import { test } from "node:test";

import { startHalfOpenServer } from "../lessons/06-connection-close/server.js";
import { closeServer } from "./helpers/net.js";

test("클라이언트가 송신을 끝내도 서버는 응답을 보낼 수 있다", async (t) => {
  const { server, port } = await startHalfOpenServer(0, () => undefined);
  t.after(() => closeServer(server));

  const socket = connect({ host: "127.0.0.1", port });
  const chunks: Buffer[] = [];
  socket.on("data", (chunk) => chunks.push(chunk));
  await once(socket, "connect");

  socket.end("client-final");
  await once(socket, "close");

  assert.equal(Buffer.concat(chunks).toString("utf8"), "server-after-fin");
});
```

- [ ] **2단계: 연결 종료 테스트 실패를 확인한다**

```bash
npx tsx --test tests/connection-close.integration.test.ts
```

예상: 연결 종료 서버 모듈이 없어 FAIL.

- [ ] **3단계: 순번 로그와 half-open 서버를 구현한다**

`event-log.ts`:

```ts
export function createEventLogger(
  label: string,
  sink: (line: string) => void = console.log,
): (event: string, detail?: string) => void {
  let sequence = 0;
  return (event, detail) => {
    sequence += 1;
    sink(
      `[${label} #${sequence}] ${event}${detail ? ` ${detail}` : ""}`,
    );
  };
}
```

`server.ts`:

```ts
import { once } from "node:events";
import {
  createServer,
  type AddressInfo,
  type Server,
} from "node:net";
import { pathToFileURL } from "node:url";

import { createEventLogger } from "./event-log.js";

export async function startHalfOpenServer(
  port = 0,
  logger: (line: string) => void = console.log,
): Promise<{ server: Server; port: number }> {
  let nextConnectionId = 0;
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    const connectionId = ++nextConnectionId;
    const log = createEventLogger(`connection:${connectionId}`, logger);
    const chunks: Buffer[] = [];

    log("connect");
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      log("data", `bytes=${chunk.length}`);
    });
    socket.on("end", () => {
      log("end", Buffer.concat(chunks).toString("utf8"));
      socket.end("server-after-fin");
    });
    socket.on("finish", () => log("finish"));
    socket.on("close", () => log("close"));
    socket.on("error", (error) => log("error", error.message));
  });

  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  return {
    server,
    port: (server.address() as AddressInfo).port,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { port } = await startHalfOpenServer(
    Number(process.env.PORT ?? 4006),
  );
  console.log(`connection close server: 127.0.0.1:${port}`);
}
```

- [ ] **4단계: 종료 모드 CLI를 구현한다**

`client.ts`는 `--mode=graceful`과 `--mode=forced`를 받는다.

- graceful: 연결 후 `socket.end("client-final")`을 호출하고 서버 응답과 전체 이벤트 순서를 기록한다.
- forced: 연결 후 `socket.write("client-partial")`을 호출한 다음 `socket.destroy(new Error("forced local teardown"))`를 호출한다.

README에서는 `destroy()`가 애플리케이션의 강제 로컬 정리임을 설명하고, 한 번의 관찰만으로 특정 패킷 형태를 보장한다고 단정하지 않는다.

스크립트:

```bash
npm pkg set scripts.lesson:06:server="tsx lessons/06-connection-close/server.ts"
npm pkg set scripts.lesson:06:client="tsx lessons/06-connection-close/client.ts"
```

- [ ] **5단계: 작업 7 검증을 실행한다**

```bash
npx tsx --test tests/connection-close.integration.test.ts
npm test
npm run typecheck
npm run build
```

예상: 모두 PASS이며 테스트 종료 후 열린 소켓이 없다.

- [ ] **6단계: 작업 7을 커밋한다**

```bash
git add package.json package-lock.json lessons/06-connection-close tests/connection-close.integration.test.ts
git commit -m "feat: demonstrate TCP connection shutdown"
```

---

### 작업 8: 한글 학습 안내와 최종 검증

**파일:**
- 생성: `README.md`
- 수정: `package.json`
- 검증: 모든 `lessons/**/*.ts`, `src/**/*.ts`, `tests/**/*.ts`

**인터페이스:**
- README가 설치부터 여섯 실습까지의 유일한 시작점이 된다.
- package script가 각 서버와 클라이언트를 정확한 파일에 연결한다.

- [ ] **1단계: README에 학습 흐름과 실행 명령을 작성한다**

README는 다음 순서를 그대로 포함한다.

1. Node.js 24 이상과 `npm install`
2. 두 터미널에서 서버와 클라이언트를 실행하는 방법
3. 실습 01: 바이트 수, hex, UTF-8 로그에서 확인할 점
4. 실습 02: `write()` 횟수와 `data` 이벤트 횟수가 계약이 아닌 이유
5. 실습 03: 4바이트 길이 헤더와 누적 버퍼의 시간순 동작
6. 실습 04: 두 이름으로 CLI 채팅에 참여하는 명령
7. 실습 05: `false`가 전송 실패가 아닌 이유와 `drain`
8. 실습 06: FIN 관점의 `end`, `finish`, `close`, half-close
9. 보장과 관찰의 구분
10. `npm test`, `npm run typecheck`, `npm run build`
11. 선택 실습으로 Wireshark 표시 필터 `tcp.port == 4006`과 macOS loopback 인터페이스 `lo0`

각 실습에는 “실행”, “예상 관찰”, “생각해 볼 질문” 소제목을 둔다. chunk 개수와 크기는 비결정적이라고 명시하고, TCP가 한 연결 안에서 바이트 순서를 보존한다는 사실은 보장으로 표시한다.

- [ ] **2단계: 전체 테스트를 깨끗한 상태에서 실행한다**

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

예상:

- 모든 단위/통합 테스트 PASS
- TypeScript 오류 0개
- 빌드 종료 코드 0
- `git diff --check` 출력 없음

- [ ] **3단계: 여섯 실습의 CLI 시작을 확인한다**

각 서버는 4001부터 4006까지의 기본 포트를 사용한다. 서버를 시작해 listen 로그를 확인하고, 대응하는 클라이언트를 한 번 실행한 뒤 서버를 정상 종료한다. 포트 충돌 시 해당 실행에만 `PORT=0`을 사용하고 실제 할당 포트를 로그에서 확인한다.

검증 명령:

```bash
npm run lesson:01:server
npm run lesson:02:server
npm run lesson:03:server
npm run lesson:04:server
npm run lesson:05:consumer
npm run lesson:06:server
```

각 명령은 해당 실습의 listen 로그를 출력해야 한다. 장시간 실행 프로세스는 확인 직후 SIGINT로 종료한다.

- [ ] **4단계: 문서와 최종 상태를 커밋한다**

```bash
git add README.md package.json package-lock.json
git commit -m "docs: add TCP learning walkthrough"
```

- [ ] **5단계: 커밋 후 최종 상태를 다시 확인한다**

```bash
npm test
npm run typecheck
npm run build
git diff --check
git status --short --branch
```

예상: 검사 명령이 모두 PASS하고 작업 트리에 변경 사항이 없다. 원격 push는 실행하지 않는다.
