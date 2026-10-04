import { describe, expect, it } from "vitest";
import { writeWebResponseToNodeResponse } from "./httpResponse";

class FakeNodeResponse {
  chunks: Buffer[] = [];
  ended = false;
  headers = new Map<string, number | string | string[]>();
  statusCode = 0;

  end(chunk?: Buffer) {
    if (chunk) {
      this.chunks.push(chunk);
    }
    this.ended = true;
  }

  setHeader(key: string, value: number | string | string[]) {
    this.headers.set(key, value);
  }

  write(chunk: Buffer) {
    this.chunks.push(chunk);
  }
}

describe("writeWebResponseToNodeResponse", () => {
  it("streams Web Response body chunks before the body is complete", async () => {
    let releaseSecondChunk: (() => void) | undefined;
    const secondChunkReady = new Promise<void>((resolve) => {
      releaseSecondChunk = resolve;
    });
    const response = new Response(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode("first\n"));
          await secondChunkReady;
          controller.enqueue(new TextEncoder().encode("second\n"));
          controller.close();
        },
      }),
      {
        headers: { "content-type": "application/x-ndjson; charset=utf-8" },
        status: 202,
      },
    );
    const nodeResponse = new FakeNodeResponse();

    const writePromise = writeWebResponseToNodeResponse(nodeResponse, response);
    await Promise.resolve();

    expect(nodeResponse.statusCode).toBe(202);
    expect(nodeResponse.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(Buffer.concat(nodeResponse.chunks).toString("utf8")).toBe("first\n");
    expect(nodeResponse.ended).toBe(false);

    releaseSecondChunk?.();
    await writePromise;

    expect(Buffer.concat(nodeResponse.chunks).toString("utf8")).toBe("first\nsecond\n");
    expect(nodeResponse.ended).toBe(true);
  });
});
