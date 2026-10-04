import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { z } from "zod";
import { streamWritingObject } from "./streamWritingObject";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};

describe("streamWritingObject with the real SDK", () => {
  it("reports body characters before completion and excludes the old text", async () => {
    let controller!: ReadableStreamDefaultController<LanguageModelV4StreamPart>;
    const model = new MockLanguageModelV4({ doStream: async () => ({
      stream: new ReadableStream({ start(value) { controller = value; } }),
    }) });
    const onProgress = vi.fn();
    let settled = false;
    const pending = streamWritingObject({
      model, prompt: "rewrite", schema: z.object({ oldText: z.string(), newText: z.string() }), onProgress,
    }).then((value) => { settled = true; return value; });
    await vi.waitFor(() => expect(controller).toBeDefined());
    controller.enqueue({ type: "text-start", id: "t" });
    controller.enqueue({ type: "text-delta", id: "t", delta: '{"oldText":"old text does not count","newText":"新しい本文' });
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledWith(5));
    expect(settled).toBe(false);
    controller.enqueue({ type: "text-delta", id: "t", delta: 'です"}' });
    controller.enqueue({ type: "text-end", id: "t" });
    controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
    controller.close();
    await expect(pending).resolves.toMatchObject({ object: { newText: "新しい本文です" } });
    expect(onProgress.mock.calls.every(([count]) => typeof count === "number")).toBe(true);
  });

  it.each(["length", "invalid-json", "invalid-schema", "error", "missing-finish"] as const)(
    "rejects %s instead of releasing partial prose or waiting forever", async (failure) => {
      const model = new MockLanguageModelV4({ doStream: async () => ({
        stream: new ReadableStream({ start(controller) {
          controller.enqueue({ type: "text-start", id: "t" });
          controller.enqueue({ type: "text-delta", id: "t", delta: failure === "invalid-json" ? '{"content":' : failure === "invalid-schema" ? '{"wrong":123}' : '{"content":"partial manuscript"}' });
          controller.enqueue({ type: "text-end", id: "t" });
          if (failure === "error") controller.enqueue({ type: "error", error: new Error("stream failed") });
          else if (failure !== "missing-finish") controller.enqueue({ type: "finish", finishReason: { unified: failure === "length" ? "length" : "stop", raw: "test" }, usage });
          controller.close();
        } }),
      }) });
      await expect(streamWritingObject({ model, prompt: "write", schema: z.object({ content: z.string() }) })).rejects.toThrow();
    }, 2000,
  );
});
