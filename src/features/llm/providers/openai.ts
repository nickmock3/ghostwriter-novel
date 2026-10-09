import { createOpenAI, type OpenAIProvider, type OpenAIProviderSettings } from "@ai-sdk/openai";
import { defaultSettingsMiddleware, wrapLanguageModel } from "ai";
import { readLlmProviderConfig, type LlmProviderConfig } from "../runtimeEnv";
import type { LlmProviderPlugin, ModelProvider } from "./types";

const defaultOpenAIBaseURL = "https://api.openai.com/v1";

export type CreateOpenAIModelProviderOptions = {
  createOpenAIProvider?: (settings: OpenAIProviderSettings) => OpenAIProvider;
  config?: LlmProviderConfig["providers"]["openai"];
};

export function createOpenAIModelProviderPlugin(
  options: CreateOpenAIModelProviderOptions = {},
): LlmProviderPlugin {
  const config = options.config ?? readLlmProviderConfig().providers.openai;
  const createOpenAIProvider = options.createOpenAIProvider ?? createOpenAI;

  return {
    kind: "llm-provider",
    connectionSettingsPolicy: "optional-base-url",
    createModel(modelId) {
      const apiKey = config.apiKey;
      if (!apiKey) {
        throw new Error("OPENAI_API_KEY is required to create an OpenAI language model");
      }

      const provider = createOpenAIProvider({
        apiKey,
        baseURL: config.baseURL ?? defaultOpenAIBaseURL,
      });

      return wrapLanguageModel({
        model: modelId.startsWith("gpt-6-") ? provider.responses(modelId) : provider(modelId),
        middleware: defaultSettingsMiddleware({
          settings: { providerOptions: { openai: { reasoningSummary: "auto" } } },
        }),
      });
    },
    displayName: "OpenAI",
    envKey: "OPENAI_API_KEY",
    id: "openai",
    models: [
      {
        contextWindowTokens: 400_000,
        displayName: "GPT 5.4 Mini",
        id: "gpt-5.4-mini",
        supportsTools: true,
      },
      { displayName: "GPT 5.5", id: "gpt-5.5", supportsTools: true },
      {
        contextWindowTokens: 1_050_000,
        displayName: "GPT 5.6 Sol",
        id: "gpt-5.6-sol",
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_050_000,
        displayName: "GPT 5.6 Terra",
        id: "gpt-5.6-terra",
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_050_000,
        displayName: "GPT 5.6 Luna",
        id: "gpt-5.6-luna",
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_050_000,
        displayName: "GPT-6 Astra",
        id: "gpt-6-astra",
        supportsTemperature: false,
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_050_000,
        displayName: "GPT-6 Sol",
        id: "gpt-6-sol",
        supportsTemperature: false,
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_050_000,
        displayName: "GPT-6 Luna",
        id: "gpt-6-luna",
        supportsTemperature: false,
        supportsTools: true,
      },
    ],
  };
}

export function createOpenAIModelProvider(
  options: CreateOpenAIModelProviderOptions = {},
): ModelProvider {
  const plugin = createOpenAIModelProviderPlugin(options);
  return {
    getLanguageModel(modelId) {
      return plugin.createModel(modelId);
    },
  };
}
