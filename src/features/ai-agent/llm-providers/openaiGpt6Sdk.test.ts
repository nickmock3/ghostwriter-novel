import { createOpenAI } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createOpenAIModelProviderPlugin } from "./openai";

describe("GPT-6 OpenAI SDK request", () => {
  it.each(["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"])(
    "uses Responses with tools and omits sampling for %s",
    async (modelId) => {
      const requests: Array<{ body: Record<string, unknown>; url: string }> = [];
      const plugin = createOpenAIModelProviderPlugin({
        config: { apiKey: "test-key" },
        createOpenAIProvider: (settings) =>
          createOpenAI({
            ...settings,
            fetch: async (url, init) => {
              requests.push({
                body: JSON.parse(String(init?.body)) as Record<string, unknown>,
                url: String(url),
              });
              return new Response(JSON.stringify({ error: { message: "test stop", type: "invalid_request_error" } }), {
                headers: { "content-type": "application/json" },
                status: 400,
              });
            },
          }),
      });

      await expect(
        generateText({
          maxRetries: 0,
          model: plugin.createModel(modelId),
          prompt: "Call the ping tool",
          temperature: 0.5,
          tools: {
            ping: tool({
              description: "A test tool",
              execute: async () => "pong",
              inputSchema: z.object({}),
            }),
          },
        }),
      ).rejects.toThrow("test stop");

      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe("https://api.openai.com/v1/responses");
      expect(requests[0]?.body.model).toBe(modelId);
      expect(requests[0]?.body.reasoning).toMatchObject({ summary: "auto" });
      expect(requests[0]?.body).not.toHaveProperty("temperature");
      expect(requests[0]?.body.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: "ping" })]));
    },
  );
});
