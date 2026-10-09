import { describe, expect, it } from "vitest";
import { createModelProviderApiHandler } from "./modelProviderApi";
import { createLlmSecretStore, type SystemCredentialAdapter } from "./secrets/llmSecretStore";

function memoryAdapter(initial: Record<string, string> = {}): SystemCredentialAdapter {
  const values = new Map(Object.entries(initial));

  return {
    async deletePassword(_service, account) {
      values.delete(account);
    },
    async getPassword(_service, account) {
      return values.get(account) ?? null;
    },
    async setPassword(_service, account, password) {
      values.set(account, password);
    },
  };
}

describe("model provider API", () => {
  it("returns allowed provider and model choices with availability reasons", async () => {
    const response = await createModelProviderApiHandler({
      config: {
        providers: {
          anthropic: {},
          deepseek: { apiKey: "deepseek-secret" },
          gemini: {},
          openai: {},
        },
      },
      secretStore: createLlmSecretStore({
        adapter: memoryAdapter(),
        env: {},
      }),
    })(new Request("http://localhost/api/llm/providers"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      providers: [
        {
          displayName: "DeepSeek",
          id: "deepseek",
          models: [
            {
              available: true,
              contextWindowTokens: 1_000_000,
              displayName: "DeepSeek V4 Pro",
              id: "deepseek-v4-pro",
              supportsTools: true,
            },
            {
              available: true,
              contextWindowTokens: 1_000_000,
              displayName: "DeepSeek V4 Flash",
              id: "deepseek-v4-flash",
              supportsTools: true,
            },
            {
              available: true,
              contextWindowTokens: 1_000_000,
              displayName: "DeepSeek V4.1 Flash",
              id: "deepseek-flash",
              supportsTemperature: false,
              supportsTools: true,
            },
          ],
        },
        {
          displayName: "OpenAI",
          id: "openai",
          models: [
            {
              available: false,
              contextWindowTokens: 400_000,
              displayName: "GPT 5.4 Mini",
              id: "gpt-5.4-mini",
              supportsTools: true,
              unavailableReason: "OpenAI のAPIキーが未設定です。",
            },
            {
              available: false,
              displayName: "GPT 5.5",
              id: "gpt-5.5",
              supportsTools: true,
              unavailableReason: "OpenAI のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 1_050_000,
              displayName: "GPT 5.6 Sol",
              id: "gpt-5.6-sol",
              supportsTools: true,
              unavailableReason: "OpenAI のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 1_050_000,
              displayName: "GPT 5.6 Terra",
              id: "gpt-5.6-terra",
              supportsTools: true,
              unavailableReason: "OpenAI のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 1_050_000,
              displayName: "GPT 5.6 Luna",
              id: "gpt-5.6-luna",
              supportsTools: true,
              unavailableReason: "OpenAI のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 1_050_000,
              displayName: "GPT-6 Astra",
              id: "gpt-6-astra",
              supportsTemperature: false,
              supportsTools: true,
              unavailableReason: "OpenAI のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 1_050_000,
              displayName: "GPT-6 Sol",
              id: "gpt-6-sol",
              supportsTemperature: false,
              supportsTools: true,
              unavailableReason: "OpenAI のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 1_050_000,
              displayName: "GPT-6 Luna",
              id: "gpt-6-luna",
              supportsTemperature: false,
              supportsTools: true,
              unavailableReason: "OpenAI のAPIキーが未設定です。",
            },
          ],
        },
        {
          displayName: "Gemini",
          id: "gemini",
          models: [
            {
              available: false,
              contextWindowTokens: 1_048_576,
              displayName: "Gemini 3.8 Flash",
              id: "gemini-3.8-flash",
              supportsTemperature: false,
              supportsTools: true,
              unavailableReason: "Gemini のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 1_048_576,
              displayName: "Gemini 3.7 Flash",
              id: "gemini-3.7-flash",
              supportsTemperature: false,
              supportsTools: true,
              unavailableReason: "Gemini のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 1_048_576,
              displayName: "Gemini 3.6 Flash",
              id: "gemini-3.6-flash",
              supportsTemperature: false,
              supportsTools: true,
              unavailableReason: "Gemini のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 1_048_576,
              displayName: "Gemini 3.5 Flash-Lite",
              id: "gemini-3.5-flash-lite",
              supportsTemperature: false,
              supportsTools: true,
              unavailableReason: "Gemini のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 1_048_576,
              displayName: "Gemini 3.5 Flash",
              id: "gemini-3.5-flash",
              supportsTools: true,
              unavailableReason: "Gemini のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 1_048_576,
              displayName: "Gemini 3.1 Flash Lite",
              id: "gemini-3.1-flash-lite",
              supportsTools: true,
              unavailableReason: "Gemini のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 1_048_576,
              displayName: "Gemini 3.1 Pro",
              id: "gemini-3.1-pro",
              supportsTools: true,
              unavailableReason: "Gemini のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 1_048_576,
              displayName: "Gemini 3.1 Flash",
              id: "gemini-3.1-flash",
              supportsTools: true,
              unavailableReason: "Gemini のAPIキーが未設定です。",
            },
          ],
        },
        {
          displayName: "Anthropic",
          id: "anthropic",
          models: [
            {
              available: false,
              contextWindowTokens: 1_000_000,
              displayName: "Claude Sonnet 4.6",
              id: "claude-sonnet-4-6",
              supportsTools: true,
              unavailableReason: "Anthropic のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 1_000_000,
              displayName: "Claude Opus 4.7",
              id: "claude-opus-4-7",
              supportsTemperature: false,
              supportsTools: true,
              unavailableReason: "Anthropic のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 200_000,
              displayName: "Claude Haiku 4.5",
              id: "claude-haiku-4-5",
              supportsTools: true,
              unavailableReason: "Anthropic のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 1_000_000,
              displayName: "Claude Fable 5",
              id: "claude-fable-5",
              supportsTemperature: false,
              supportsTools: true,
              unavailableReason: "Anthropic のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 1_000_000,
              displayName: "Claude Opus 4.8",
              id: "claude-opus-4-8",
              supportsTemperature: false,
              supportsTools: true,
              unavailableReason: "Anthropic のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 1_000_000,
              displayName: "Claude Sonnet 5",
              id: "claude-sonnet-5",
              supportsTemperature: false,
              supportsTools: true,
              unavailableReason: "Anthropic のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 200_000,
              displayName: "Claude Haiku 4.5 (2025-10-01)",
              id: "claude-haiku-4-5-20251001",
              supportsTools: true,
              unavailableReason: "Anthropic のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 1_000_000,
              displayName: "Claude Opus 5",
              id: "claude-opus-5",
              supportsTemperature: false,
              supportsTools: true,
              unavailableReason: "Anthropic のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 1_000_000,
              displayName: "Claude Opus 5.5",
              id: "claude-opus-5-5",
              supportsTemperature: false,
              supportsTools: true,
              unavailableReason: "Anthropic のAPIキーが未設定です。",
            },
            {
              available: false,
              contextWindowTokens: 1_000_000,
              displayName: "Claude Fable 5.1",
              id: "claude-fable-5-1",
              supportsTemperature: false,
              supportsTools: true,
              unavailableReason: "Anthropic のAPIキーが未設定です。",
            },
          ],
        },
        {
          displayName: "OpenAI互換",
          id: "openai-compatible",
          models: [
            {
              available: false,
              displayName: "local-model",
              id: "local-model",
              supportsTools: false,
              unavailableReason: "このモデルはツール実行に対応していません。",
            },
          ],
        },
      ],
    });
  });

  it("rejects unsupported methods", async () => {
    const response = await createModelProviderApiHandler()(
      new Request("http://localhost/api/llm/providers", { method: "POST" }),
    );

    expect(response.status).toBe(405);
  });

  it("marks models available when the API key comes from the system secret store", async () => {
    const response = await createModelProviderApiHandler({
      config: {
        providers: {
          anthropic: {},
          deepseek: {},
          gemini: {},
          openai: {},
        },
      },
      secretStore: createLlmSecretStore({
        adapter: memoryAdapter({ "ghostwriter/openai": "openai-system-secret" }),
        env: {},
      }),
    })(new Request("http://localhost/api/llm/providers"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.providers.find((provider: { id: string }) => provider.id === "openai")).toEqual({
      displayName: "OpenAI",
      id: "openai",
      models: [
        {
          available: true,
          contextWindowTokens: 400_000,
          displayName: "GPT 5.4 Mini",
          id: "gpt-5.4-mini",
          supportsTools: true,
        },
        {
          available: true,
          displayName: "GPT 5.5",
          id: "gpt-5.5",
          supportsTools: true,
        },
        {
          available: true,
          contextWindowTokens: 1_050_000,
          displayName: "GPT 5.6 Sol",
          id: "gpt-5.6-sol",
          supportsTools: true,
        },
        {
          available: true,
          contextWindowTokens: 1_050_000,
          displayName: "GPT 5.6 Terra",
          id: "gpt-5.6-terra",
          supportsTools: true,
        },
        {
          available: true,
          contextWindowTokens: 1_050_000,
          displayName: "GPT 5.6 Luna",
          id: "gpt-5.6-luna",
          supportsTools: true,
        },
        {
          available: true,
          contextWindowTokens: 1_050_000,
          displayName: "GPT-6 Astra",
          id: "gpt-6-astra",
          supportsTemperature: false,
          supportsTools: true,
        },
        {
          available: true,
          contextWindowTokens: 1_050_000,
          displayName: "GPT-6 Sol",
          id: "gpt-6-sol",
          supportsTemperature: false,
          supportsTools: true,
        },
        {
          available: true,
          contextWindowTokens: 1_050_000,
          displayName: "GPT-6 Luna",
          id: "gpt-6-luna",
          supportsTemperature: false,
          supportsTools: true,
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("openai-system-secret");
  });

  it("marks Anthropic available when the API key comes from the system secret store", async () => {
    const response = await createModelProviderApiHandler({
      config: {
        providers: {
          anthropic: {},
          deepseek: {},
          gemini: {},
          openai: {},
        },
      },
      secretStore: createLlmSecretStore({
        adapter: memoryAdapter({ "ghostwriter/anthropic": "anthropic-system-secret" }),
        env: {},
      }),
    })(new Request("http://localhost/api/llm/providers"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.providers.find((provider: { id: string }) => provider.id === "anthropic")).toEqual({
      displayName: "Anthropic",
      id: "anthropic",
      models: [
        {
          available: true,
          contextWindowTokens: 1_000_000,
          displayName: "Claude Sonnet 4.6",
          id: "claude-sonnet-4-6",
          supportsTools: true,
        },
        {
          available: true,
          contextWindowTokens: 1_000_000,
          displayName: "Claude Opus 4.7",
          id: "claude-opus-4-7",
          supportsTemperature: false,
          supportsTools: true,
        },
        {
          available: true,
          contextWindowTokens: 200_000,
          displayName: "Claude Haiku 4.5",
          id: "claude-haiku-4-5",
          supportsTools: true,
        },
        {
          available: true,
          contextWindowTokens: 1_000_000,
          displayName: "Claude Fable 5",
          id: "claude-fable-5",
          supportsTemperature: false,
          supportsTools: true,
        },
        {
          available: true,
          contextWindowTokens: 1_000_000,
          displayName: "Claude Opus 4.8",
          id: "claude-opus-4-8",
          supportsTemperature: false,
          supportsTools: true,
        },
        {
          available: true,
          contextWindowTokens: 1_000_000,
          displayName: "Claude Sonnet 5",
          id: "claude-sonnet-5",
          supportsTemperature: false,
          supportsTools: true,
        },
        {
          available: true,
          contextWindowTokens: 200_000,
          displayName: "Claude Haiku 4.5 (2025-10-01)",
          id: "claude-haiku-4-5-20251001",
          supportsTools: true,
        },
        {
          available: true,
          contextWindowTokens: 1_000_000,
          displayName: "Claude Opus 5",
          id: "claude-opus-5",
          supportsTemperature: false,
          supportsTools: true,
        },
        {
          available: true,
          contextWindowTokens: 1_000_000,
          displayName: "Claude Opus 5.5",
          id: "claude-opus-5-5",
          supportsTemperature: false,
          supportsTools: true,
        },
        {
          available: true,
          contextWindowTokens: 1_000_000,
          displayName: "Claude Fable 5.1",
          id: "claude-fable-5-1",
          supportsTemperature: false,
          supportsTools: true,
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("anthropic-system-secret");
  });
});
