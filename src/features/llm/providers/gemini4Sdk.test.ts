import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { stepCountIs, streamText, tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createGeminiModelProviderPlugin } from "./gemini";

function geminiStream(parts: Record<string, unknown>[]) {
  const chunk = {
    candidates: [{ content: { role: "model", parts }, finishReason: "STOP", index: 0 }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3, totalTokenCount: 15 },
  };
  return new Response(`data: ${JSON.stringify(chunk)}\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("Gemini 4 SDK streaming", () => {
  it.each(["gemini-4-carbon", "gemini-4-argon", "gemini-4-hydrogen"])(
    "streams %s and sends back the signature with its tool result",
    async (modelId) => {
      const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => geminiStream([{ text: "Done." }]))
        .mockImplementationOnce(async () => geminiStream([
          { functionCall: { name: "ping", args: {}, id: "test-call" }, thoughtSignature: "test-signature" },
        ]));
      const plugin = createGeminiModelProviderPlugin({
        config: { apiKey: "test-key" },
        createGoogleProvider: (settings) => createGoogleGenerativeAI({ ...settings, fetch }),
      });

      const result = streamText({
        maxOutputTokens: 4096,
        maxRetries: 0,
        model: plugin.createModel(modelId),
        prompt: "Call ping",
        stopWhen: stepCountIs(2),
        tools: { ping: tool({ execute: async () => "pong", inputSchema: z.object({}) }) },
      });
      await expect(result.text).resolves.toBe("Done.");
      await expect(result.totalUsage).resolves.toMatchObject({ inputTokens: 24, outputTokens: 6 });

      expect(fetch).toHaveBeenCalledTimes(2);
      const [url, init] = fetch.mock.calls[1]!;
      expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse`);
      expect(JSON.parse(String(init?.body))).toMatchObject({
        contents: expect.arrayContaining([
          { role: "model", parts: [{ functionCall: { name: "ping", args: {}, id: "test-call" }, thoughtSignature: "test-signature" }] },
          { role: "user", parts: [{ functionResponse: expect.objectContaining({ name: "ping", id: "test-call" }) }] },
        ]),
        generationConfig: { maxOutputTokens: 4096 },
      });
    },
  );
});
