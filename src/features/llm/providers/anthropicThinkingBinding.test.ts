import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAnthropicModelProviderPlugin } from "./anthropic";

describe("Claude thinking prefix binding", () => {
  it.each(["claude-fable-5-2", "claude-sonnet-5-5", "claude-haiku-5-5"])(
    "allows %s to continue after a system prompt change between tool steps",
    async (modelId) => {
      const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
        Response.json(
          { type: "error", error: { type: "invalid_request_error", message: "test stop" } },
          { status: 400 },
        ),
      );
      const plugin = createAnthropicModelProviderPlugin({
        config: { apiKey: "test-key" },
        createAnthropicProvider: (settings) => createAnthropic({ ...settings, fetch }),
      });

      await expect(generateText({
        maxOutputTokens: 4096,
        maxRetries: 0,
        model: plugin.createModel(modelId),
        system: "Updated system prompt",
        messages: [
          { role: "user", content: "Call ping" },
          {
            role: "assistant",
            content: [
              { type: "reasoning", text: "", providerOptions: { anthropic: { signature: "test-signature" } } },
              { type: "tool-call", toolCallId: "toolu_test", toolName: "ping", input: {} },
            ],
          },
          {
            role: "tool",
            content: [{ type: "tool-result", toolCallId: "toolu_test", toolName: "ping", output: { type: "text", value: "pong" } }],
          },
        ],
        tools: { ping: tool({ inputSchema: z.object({}) }) },
      })).rejects.toThrow("test stop");

      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0]!;
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(new Headers(init?.headers).get("anthropic-beta")).toContain("thinking-binding-controls-2026-08-01");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: modelId,
        max_tokens: 4096,
        thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
        tools: [{ name: "ping" }],
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            content: expect.arrayContaining([{ type: "thinking", thinking: "", signature: "test-signature" }]),
          }),
        ]),
      });
      expect(body).not.toHaveProperty("temperature");
    },
  );
});
