import { describe, expect, it, vi } from "vitest";
import { createLlmRuntime } from "./llmRuntime";
import type { LlmProviderPlugin } from "./modelProvider";
import type { LlmSecretProviderId, LlmSecretStore } from "./llmSecretStore";

function secretStore(values: Partial<Record<LlmSecretProviderId, string>>): LlmSecretStore {
  return {
    deleteApiKey: vi.fn(),
    getApiKey: vi.fn(async (providerId: LlmSecretProviderId) => values[providerId] ?? null),
    getStatus: vi.fn(),
    setApiKey: vi.fn(),
  };
}

function plugin(id: LlmProviderPlugin["id"]): LlmProviderPlugin {
  return {
    connectionSettingsPolicy: "none",
    createModel: vi.fn(),
    displayName: id,
    envKey: `${id}_API_KEY`,
    id,
    kind: "llm-provider",
    models: [],
  };
}

describe("LLM runtime", () => {
  it("resolves missing API keys from the secret store without overriding configured keys", async () => {
    const runtime = createLlmRuntime({
      config: {
        providers: {
          anthropic: {},
          deepseek: { apiKey: "configured-deepseek-key" },
          gemini: {},
          openai: {},
          "openai-compatible": {},
        },
      },
      secretStore: secretStore({
        anthropic: "anthropic-secret",
        deepseek: "deepseek-secret",
        gemini: "gemini-secret",
        openai: "openai-secret",
        "openai-compatible": "compatible-secret",
      }),
    });

    const { config } = await runtime.resolve();

    expect(config.providers.anthropic.apiKey).toBe("anthropic-secret");
    expect(config.providers.deepseek.apiKey).toBe("configured-deepseek-key");
    expect(config.providers.gemini.apiKey).toBe("gemini-secret");
    expect(config.providers.openai.apiKey).toBe("openai-secret");
    expect(config.providers["openai-compatible"]?.apiKey).toBe("compatible-secret");
  });

  it("preserves explicitly injected provider plugins", async () => {
    const plugins = [plugin("openai")];
    const runtime = createLlmRuntime({
      config: {
        providers: { anthropic: {}, deepseek: {}, gemini: {}, openai: {} },
      },
      llmProviderPlugins: plugins,
      secretStore: secretStore({}),
    });

    await expect(runtime.resolve()).resolves.toMatchObject({ plugins });
  });

  it("does not read a secret when the API key is already configured", async () => {
    const store = secretStore({});
    const runtime = createLlmRuntime({
      config: {
        providers: {
          anthropic: { apiKey: "configured-anthropic-key" },
          deepseek: { apiKey: "configured-deepseek-key" },
          gemini: { apiKey: "configured-gemini-key" },
          openai: { apiKey: "configured-openai-key" },
          "openai-compatible": { apiKey: "configured-compatible-key" },
        },
      },
      secretStore: store,
    });

    await runtime.resolve();

    expect(store.getApiKey).not.toHaveBeenCalled();
  });
});
