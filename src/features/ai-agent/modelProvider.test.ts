import { describe, expect, it, vi } from "vitest";
import {
  createDeepSeekModelProvider,
  createAnthropicModelProvider,
  createGeminiModelProvider,
  createLlmModelProvider,
  createLlmProviderPlugins,
  createOpenAICompatibleModelProvider,
  createOpenAIModelProvider,
  defaultLlmProviderPlugins,
  listAvailableLlmProviders,
  resolveChatModelSelection,
} from "./modelProvider";
import { defaultLlmProviderPluginFactories } from "./llm-providers/providerFactories";

describe("DeepSeek model provider", () => {
  it("publishes verified model context windows through available model metadata", () => {
    const deepSeek = listAvailableLlmProviders({
      config: {
        providers: {
          anthropic: {},
          deepseek: { apiKey: "test-key" },
          gemini: {},
          openai: {},
          "openai-compatible": {},
        },
      },
      plugins: defaultLlmProviderPlugins,
    }).find((provider) => provider.id === "deepseek");

    expect(deepSeek?.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "deepseek-flash", contextWindowTokens: 1_000_000, supportsTemperature: false, supportsTools: true }),
        expect.objectContaining({ id: "deepseek-v4-pro", contextWindowTokens: 1_000_000 }),
        expect.objectContaining({ id: "deepseek-v4-flash", contextWindowTokens: 1_000_000 }),
      ]),
    );
  });

  it("reads DEEPSEEK_API_KEY and configures the native DeepSeek provider", () => {
    const calls: Array<{ apiKey: string; baseURL?: string }> = [];
    const chatCalls: string[] = [];
    const provider = createDeepSeekModelProvider({
      createDeepSeekProvider: (settings) => {
        calls.push({
          apiKey: settings.apiKey ?? "",
          baseURL: settings.baseURL,
        });
        return {
          chat: (modelId: string) => {
            chatCalls.push(modelId);
            return { modelId, provider: "test-deepseek-native" };
          },
        } as never;
      },
      config: { apiKey: "test-key" },
    });

    expect(provider.getLanguageModel("deepseek-v4-pro")).toMatchObject({
      modelId: "deepseek-v4-pro",
      provider: "test-deepseek-native",
    });
    expect(provider.getLanguageModel("deepseek-flash")).toMatchObject({
      modelId: "deepseek-flash",
      provider: "test-deepseek-native",
    });
    expect(calls).toEqual([
      { apiKey: "test-key", baseURL: "https://api.deepseek.com" },
      { apiKey: "test-key", baseURL: "https://api.deepseek.com" },
    ]);
    expect(chatCalls).toEqual(["deepseek-v4-pro", "deepseek-flash"]);
  });

  it("allows the DeepSeek base URL to be overridden", () => {
    const calls: Array<{ baseURL?: string }> = [];
    const provider = createDeepSeekModelProvider({
      createDeepSeekProvider: (settings) => {
        calls.push({ baseURL: settings.baseURL });
        return { chat: (modelId: string) => ({ modelId }) } as never;
      },
      config: { apiKey: "test-key", baseURL: "https://example.test/deepseek" },
    });

    provider.getLanguageModel("deepseek-v4-pro");

    expect(calls).toEqual([{ baseURL: "https://example.test/deepseek" }]);
  });

  it("fails clearly when DEEPSEEK_API_KEY is missing", () => {
    const provider = createDeepSeekModelProvider({
      createDeepSeekProvider: () => {
        throw new Error("should not create provider");
      },
      config: {},
    });

    expect(() => provider.getLanguageModel("deepseek-v4-pro")).toThrow(/DEEPSEEK_API_KEY/);
  });
});

describe("latest native API model metadata", () => {
  it("publishes OpenAI GPT-5.6 API models with their context window", () => {
    const openai = listAvailableLlmProviders({
      config: {
        providers: {
          anthropic: {},
          deepseek: {},
          gemini: {},
          openai: { apiKey: "test-key" },
          "openai-compatible": {},
        },
      },
    }).find((provider) => provider.id === "openai");

    expect(openai?.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: "GPT-6 Astra", id: "gpt-6-astra", contextWindowTokens: 1_050_000, supportsTemperature: false, supportsTools: true }),
        expect.objectContaining({ displayName: "GPT-6 Sol", id: "gpt-6-sol", contextWindowTokens: 1_050_000, supportsTemperature: false, supportsTools: true }),
        expect.objectContaining({ displayName: "GPT-6 Luna", id: "gpt-6-luna", contextWindowTokens: 1_050_000, supportsTemperature: false, supportsTools: true }),
        expect.objectContaining({
          contextWindowTokens: 1_050_000,
          id: "gpt-5.6-sol",
          supportsTools: true,
        }),
        expect.objectContaining({
          contextWindowTokens: 1_050_000,
          id: "gpt-5.6-terra",
          supportsTools: true,
        }),
        expect.objectContaining({
          contextWindowTokens: 1_050_000,
          id: "gpt-5.6-luna",
          supportsTools: true,
        }),
      ]),
    );
  });

  it("publishes current Anthropic API models and marks sampling restrictions", () => {
    const anthropic = listAvailableLlmProviders({
      config: {
        providers: {
          anthropic: { apiKey: "test-key" },
          deepseek: {},
          gemini: {},
          openai: {},
          "openai-compatible": {},
        },
      },
    }).find((provider) => provider.id === "anthropic");

    expect(anthropic?.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contextWindowTokens: 1_000_000,
          displayName: "Claude Opus 5.5",
          id: "claude-opus-5-5",
          supportsTemperature: false,
          supportsTools: true,
        }),
        expect.objectContaining({
          contextWindowTokens: 1_000_000,
          id: "claude-fable-5-1",
          supportsTemperature: false,
          supportsTools: true,
        }),
        expect.objectContaining({
          contextWindowTokens: 1_000_000,
          displayName: "Claude Opus 5",
          id: "claude-opus-5",
          supportsTemperature: false,
          supportsTools: true,
        }),
        expect.objectContaining({
          contextWindowTokens: 1_000_000,
          id: "claude-opus-4-7",
          supportsTemperature: false,
          supportsTools: true,
        }),
        expect.objectContaining({
          contextWindowTokens: 1_000_000,
          id: "claude-fable-5",
          supportsTemperature: false,
          supportsTools: true,
        }),
        expect.objectContaining({
          contextWindowTokens: 1_000_000,
          id: "claude-opus-4-8",
          supportsTemperature: false,
          supportsTools: true,
        }),
        expect.objectContaining({
          contextWindowTokens: 1_000_000,
          id: "claude-sonnet-5",
          supportsTemperature: false,
          supportsTools: true,
        }),
        expect.objectContaining({
          contextWindowTokens: 200_000,
          id: "claude-haiku-4-5-20251001",
          supportsTools: true,
        }),
      ]),
    );
  });
});

describe("OpenAI model provider", () => {
  it("reads OPENAI_API_KEY and configures the native OpenAI provider with base URL override", () => {
    const calls: Array<{ apiKey: string; baseURL?: string }> = [];
    const provider = createOpenAIModelProvider({
      createOpenAIProvider: (settings) => {
        calls.push({
          apiKey: settings.apiKey ?? "",
          baseURL: settings.baseURL,
        });
        return ((modelId: string) => ({ modelId, provider: "test-openai" })) as never;
      },
      config: { apiKey: "openai-key", baseURL: "https://example.test/openai" },
    });

    expect(provider.getLanguageModel("gpt-5.4-mini")).toMatchObject({
      modelId: "gpt-5.4-mini",
      provider: "test-openai",
    });
    expect(calls).toEqual([
      { apiKey: "openai-key", baseURL: "https://example.test/openai" },
    ]);
  });

  it("fails clearly when OPENAI_API_KEY is missing", () => {
    const provider = createOpenAIModelProvider({
      createOpenAIProvider: () => {
        throw new Error("should not create provider");
      },
      config: {},
    });

    expect(() => provider.getLanguageModel("gpt-5.4-mini")).toThrow(/OPENAI_API_KEY/);
  });
});

describe("OpenAI-compatible model provider", () => {
  it("configures an independent OpenAI-compatible provider with required base URL and optional API key", () => {
    const calls: Array<{ apiKey?: string; baseURL?: string }> = [];
    const provider = createOpenAICompatibleModelProvider({
      createOpenAIProvider: (settings) => {
        calls.push({
          apiKey: settings.apiKey,
          baseURL: settings.baseURL,
        });
        return {
          chat: (modelId: string) => ({ modelId, provider: "test-openai-compatible" }),
        } as never;
      },
      config: { baseURL: "http://localhost:1234/v1", models: ["local-model"] },
    });

    expect(provider.getLanguageModel("local-model")).toMatchObject({
      modelId: "local-model",
      provider: "test-openai-compatible",
    });
    expect(calls).toEqual([{ apiKey: undefined, baseURL: "http://localhost:1234/v1" }]);
  });

  it("fails clearly when OpenAI-compatible base URL is missing", () => {
    const provider = createOpenAICompatibleModelProvider({
      createOpenAIProvider: () => {
        throw new Error("should not create provider");
      },
      config: { models: ["local-model"] },
    });

    expect(() => provider.getLanguageModel("local-model")).toThrow(
      /GHOSTWRITER_OPENAI_COMPATIBLE_BASE_URL/,
    );
  });

  it("uses the user profile id to disambiguate duplicate OpenAI-compatible model IDs", () => {
    const calls: Array<{ baseURL?: string; modelId: string }> = [];
    const provider = createOpenAICompatibleModelProvider({
      createOpenAIProvider: (settings) => {
        return {
          chat: (modelId: string) => {
            calls.push({ baseURL: settings.baseURL, modelId });
            return { modelId };
          },
        } as never;
      },
      config: { models: ["shared-model"] },
      userProfiles: [
        {
          baseURL: "http://localhost:1234/v1",
          id: "user:lm-studio",
          maxOutputTokens: 4096,
          modelId: "shared-model",
          name: "LM Studio",
          providerId: "openai-compatible",
          source: "user",
          supportsToolsOverride: true,
          temperature: 0.3,
        },
        {
          baseURL: "https://openrouter.ai/api/v1",
          id: "user:openrouter",
          maxOutputTokens: 4096,
          modelId: "shared-model",
          name: "OpenRouter",
          providerId: "openai-compatible",
          source: "user",
          supportsToolsOverride: true,
          temperature: 0.3,
        },
      ],
    });

    provider.getLanguageModel("shared-model", "openai-compatible", "user:openrouter");

    expect(calls).toEqual([
      { baseURL: "https://openrouter.ai/api/v1", modelId: "shared-model" },
    ]);
  });
});

describe("Gemini model provider", () => {
  it("publishes the latest Gemini text model metadata", () => {
    const gemini = listAvailableLlmProviders({
      config: {
        providers: {
          anthropic: {},
          deepseek: {},
          gemini: { apiKey: "test-key" },
          openai: {},
          "openai-compatible": {},
        },
      },
      plugins: defaultLlmProviderPlugins,
    }).find((provider) => provider.id === "gemini");

    expect(gemini?.models).toEqual(
      expect.arrayContaining([
        {
          available: true,
          contextWindowTokens: 1_048_576,
          displayName: "Gemini 3.8 Flash",
          id: "gemini-3.8-flash",
          supportsTemperature: false,
          supportsTools: true,
        },
        {
          available: true,
          contextWindowTokens: 1_048_576,
          displayName: "Gemini 3.7 Flash",
          id: "gemini-3.7-flash",
          supportsTemperature: false,
          supportsTools: true,
        },
        {
          available: true,
          contextWindowTokens: 1_048_576,
          displayName: "Gemini 3.6 Flash",
          id: "gemini-3.6-flash",
          supportsTemperature: false,
          supportsTools: true,
        },
        {
          available: true,
          contextWindowTokens: 1_048_576,
          displayName: "Gemini 3.5 Flash-Lite",
          id: "gemini-3.5-flash-lite",
          supportsTemperature: false,
          supportsTools: true,
        },
      ]),
    );
  });

  it("reads GOOGLE_GENERATIVE_AI_API_KEY and configures the native Google provider with base URL override", () => {
    const calls: Array<{ apiKey: string; baseURL?: string }> = [];
    const provider = createGeminiModelProvider({
      createGoogleProvider: (settings) => {
        calls.push({
          apiKey: settings.apiKey ?? "",
          baseURL: settings.baseURL,
        });
        return ((modelId: string) => ({ modelId, provider: "test-google" })) as never;
      },
      config: { apiKey: "google-key", baseURL: "https://example.test/gemini" },
    });

    expect(provider.getLanguageModel("gemini-3.5-flash")).toMatchObject({
      modelId: "gemini-3.5-flash",
      provider: "test-google",
    });
    expect(calls).toEqual([
      { apiKey: "google-key", baseURL: "https://example.test/gemini" },
    ]);
  });

  it("fails clearly when GOOGLE_GENERATIVE_AI_API_KEY is missing", () => {
    const provider = createGeminiModelProvider({
      createGoogleProvider: () => {
        throw new Error("should not create provider");
      },
      config: {},
    });

    expect(() => provider.getLanguageModel("gemini-3.5-flash")).toThrow(
      /GOOGLE_GENERATIVE_AI_API_KEY/,
    );
  });
});

describe("Anthropic model provider", () => {
  it("reads ANTHROPIC_API_KEY and configures the native Anthropic provider with base URL override", () => {
    const calls: Array<{ apiKey: string; baseURL?: string }> = [];
    const provider = createAnthropicModelProvider({
      createAnthropicProvider: (settings) => {
        calls.push({
          apiKey: settings.apiKey ?? "",
          baseURL: settings.baseURL,
        });
        return ((modelId: string) => ({ modelId, provider: "test-anthropic" })) as never;
      },
      config: { apiKey: "anthropic-key", baseURL: "https://example.test/anthropic" },
    });

    expect(provider.getLanguageModel("claude-sonnet-4-6")).toMatchObject({
      modelId: "claude-sonnet-4-6",
      provider: "test-anthropic",
    });
    expect(calls).toEqual([
      { apiKey: "anthropic-key", baseURL: "https://example.test/anthropic" },
    ]);
  });

  it("fails clearly when ANTHROPIC_API_KEY is missing", () => {
    const provider = createAnthropicModelProvider({
      createAnthropicProvider: () => {
        throw new Error("should not create provider");
      },
      config: {},
    });

    expect(() => provider.getLanguageModel("claude-sonnet-4-6")).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("LLM provider registry", () => {
  it("keeps provider-specific factories outside the registry while preserving the default order", () => {
    expect(defaultLlmProviderPluginFactories.map((factory) => factory.id)).toEqual([
      "deepseek",
      "openai",
      "gemini",
      "anthropic",
      "openai-compatible",
    ]);
  });

  it("registers the supported providers and models", () => {
    expect(defaultLlmProviderPlugins.map((plugin) => plugin.id)).toEqual([
      "deepseek",
      "openai",
      "gemini",
      "anthropic",
      "openai-compatible",
    ]);
    expect(defaultLlmProviderPlugins.flatMap((plugin) => plugin.models.map((model) => model.id))).toEqual([
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "deepseek-flash",
      "gpt-5.4-mini",
      "gpt-5.5",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-6-astra",
      "gpt-6-sol",
      "gpt-6-luna",
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
      "gemini-3.1-pro",
      "gemini-3.1-flash",
      "claude-sonnet-4-6",
      "claude-opus-4-7",
      "claude-haiku-4-5",
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
      "claude-opus-5",
      "claude-opus-5-5",
      "claude-fable-5-1",
      "local-model",
    ]);
  });

  it("registers OpenAI-compatible separately from OpenAI and allows configured arbitrary model IDs", () => {
    const plugins = defaultLlmProviderPlugins;
    const openai = plugins.find((plugin) => plugin.id === "openai");
    const compatible = plugins.find((plugin) => plugin.id === "openai-compatible");

    expect(openai).toMatchObject({ displayName: "OpenAI", id: "openai" });
    expect(compatible).toMatchObject({
      connectionSettingsPolicy: "required-base-url",
      displayName: "OpenAI互換",
      id: "openai-compatible",
    });

    expect(
      resolveChatModelSelection({
        plugins: [
          {
            ...compatible!,
            models: [
              {
                available: true,
                displayName: "Local Model",
                id: "local-model",
                supportsTools: false,
              } as never,
            ],
          },
        ],
        requestedSelection: { modelId: "local-model", providerId: "openai-compatible" },
      }),
    ).toEqual({ modelId: "local-model", providerId: "openai-compatible" });
  });

  it("marks configured OpenAI-compatible tool models as tool-capable", () => {
    const [compatible] = createLlmProviderPlugins({
      config: {
        providers: {
          anthropic: {},
          deepseek: {},
          gemini: {},
          openai: {},
          "openai-compatible": {
            baseURL: "http://localhost:1234/v1",
            models: ["local-model", "tool-local-model"],
            toolModels: ["tool-local-model"],
          },
        },
      },
    }).filter((plugin) => plugin.id === "openai-compatible");

    expect(compatible.models).toEqual([
      { displayName: "local-model", id: "local-model", supportsTools: false },
      { displayName: "tool-local-model", id: "tool-local-model", supportsTools: true },
    ]);
  });

  it("creates OpenAI-compatible models through Chat Completions", () => {
    const calls: Array<{ apiKey?: string; baseURL?: string }> = [];
    const chatCalls: string[] = [];
    const responsesCalls: string[] = [];
    const provider = createOpenAICompatibleModelProvider({
      createOpenAIProvider: (settings) => {
        calls.push({
          apiKey: settings.apiKey,
          baseURL: settings.baseURL,
        });
        return Object.assign(
          (modelId: string) => {
            responsesCalls.push(modelId);
            return { modelId, provider: "test-openai-compatible-responses" };
          },
          {
            chat: (modelId: string) => {
              chatCalls.push(modelId);
              return { modelId, provider: "test-openai-compatible-chat" };
            },
          },
        ) as never;
      },
      config: {
        apiKey: "test-compatible-key",
        baseURL: "http://localhost:1234/v1",
      },
    });

    expect(provider.getLanguageModel("local-model")).toMatchObject({
      modelId: "local-model",
      provider: "test-openai-compatible-chat",
    });
    expect(calls).toEqual([
      { apiKey: "test-compatible-key", baseURL: "http://localhost:1234/v1" },
    ]);
    expect(chatCalls).toEqual(["local-model"]);
    expect(responsesCalls).toEqual([]);
  });

  it("uses deepseek/deepseek-v4-pro when no selection or default env is provided", () => {
    expect(
      resolveChatModelSelection({
        config: { providers: { anthropic: {}, deepseek: {}, gemini: {}, openai: {} } },
      }),
    ).toEqual({
      modelId: "deepseek-v4-pro",
      providerId: "deepseek",
    });
  });

  it("allows the default provider and model to be changed by server env", () => {
    expect(
      resolveChatModelSelection({
        config: {
          defaultModelId: "gpt-5.4-mini",
          defaultProviderId: "openai",
          providers: { anthropic: {}, deepseek: {}, gemini: {}, openai: {} },
        },
      }),
    ).toEqual({
      modelId: "gpt-5.4-mini",
      providerId: "openai",
    });
  });

  it("rejects unknown providers, unknown models, and non-tool models", () => {
    expect(() =>
      resolveChatModelSelection({
        requestedSelection: { modelId: "deepseek-v4-pro", providerId: "unknown" },
      }),
    ).toThrow(/Unknown LLM provider/);

    expect(() =>
      resolveChatModelSelection({
        requestedSelection: { modelId: "not-a-model", providerId: "deepseek" },
      }),
    ).toThrow(/Unknown model/);

    expect(() =>
      resolveChatModelSelection({
        plugins: [
          {
            createModel: vi.fn() as never,
            displayName: "Local",
            envKey: "LOCAL_API_KEY",
            id: "openai-compatible",
            kind: "llm-provider",
            connectionSettingsPolicy: "optional-base-url",
            models: [{ displayName: "Local Text", id: "local-text", supportsTools: false }],
          },
        ],
        requestedSelection: { modelId: "local-text", providerId: "openai-compatible" },
        requireTools: true,
      }),
    ).toThrow(/does not support tools/);
  });

  it("creates a selected ModelProvider without exposing secrets in the selected metadata", () => {
    const createModel = vi.fn((modelId: string) => ({ modelId })) as never;
    const selected = resolveChatModelSelection({
      plugins: [
        {
          createModel,
          displayName: "Test",
          envKey: "TEST_API_KEY",
          id: "openai",
          kind: "llm-provider",
          connectionSettingsPolicy: "optional-base-url",
          models: [{ displayName: "Test Model", id: "test-model", supportsTools: true }],
        },
      ],
      requestedSelection: { modelId: "test-model", providerId: "openai" },
    });
    const provider = createLlmModelProvider(selected);

    expect(provider.getLanguageModel("test-model")).toEqual({ modelId: "test-model" });
    expect(createModel).toHaveBeenCalledWith("test-model", undefined);
    expect(JSON.stringify(selected)).not.toContain("TEST_API_KEY");
  });

  it("lists provider models with API-key availability without exposing secrets", () => {
    const providers = listAvailableLlmProviders({
      config: {
        providers: {
          deepseek: { apiKey: "deepseek-secret" },
          anthropic: {},
          gemini: {},
          openai: { apiKey: "" },
          "openai-compatible": { baseURL: "http://localhost:1234/v1", models: ["local-model"] },
        },
      },
      requireTools: true,
    });

    expect(providers).toEqual([
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
    ]);
    expect(JSON.stringify(providers)).not.toContain("deepseek-secret");
    expect(JSON.stringify(providers)).not.toContain("DEEPSEEK_API_KEY");
  });

  it("marks cloud OpenAI-compatible user profile models as tool-capable by default", () => {
    const providers = listAvailableLlmProviders({
      config: {
        providers: {
          deepseek: {},
          anthropic: {},
          gemini: {},
          openai: {},
          "openai-compatible": {},
        },
      },
      plugins: createLlmProviderPlugins({
        config: {
          providers: {
            deepseek: {},
            anthropic: {},
            gemini: {},
            openai: {},
            "openai-compatible": {},
          },
        },
        userProfiles: [
          {
            baseURL: "https://openrouter.ai/api/v1",
            id: "user:openrouter",
            maxOutputTokens: 4096,
            modelId: "openai/gpt-oss-20b",
            name: "OpenRouter",
            providerId: "openai-compatible",
            source: "user",
            supportsToolsOverride: false,
            temperature: 0.3,
          },
          {
            baseURL: "http://localhost:1234/v1",
            id: "user:lm-studio",
            maxOutputTokens: 4096,
            modelId: "local-model",
            name: "LM Studio",
            providerId: "openai-compatible",
            source: "user",
            supportsToolsOverride: false,
            temperature: 0.3,
          },
        ],
      }),
      requireTools: true,
    });

    expect(providers.find((provider) => provider.id === "openai-compatible")?.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          available: true,
          id: "openai/gpt-oss-20b",
          supportsTools: true,
        }),
        expect.objectContaining({
          available: false,
          id: "local-model",
          supportsTools: false,
          unavailableReason: "このモデルはツール実行に対応していません。",
        }),
      ]),
    );
  });
});
