import { createDeepSeek, type DeepSeekProvider, type DeepSeekProviderSettings } from "@ai-sdk/deepseek";
import { readLlmProviderConfig, type LlmProviderConfig } from "../runtimeEnv";
import type { LlmProviderPlugin, ModelProvider } from "./types";

const defaultDeepSeekBaseURL = "https://api.deepseek.com";

export type CreateDeepSeekModelProviderOptions = {
  createDeepSeekProvider?: (settings: DeepSeekProviderSettings) => DeepSeekProvider;
  config?: LlmProviderConfig["providers"]["deepseek"];
};

export function createDeepSeekModelProviderPlugin(
  options: CreateDeepSeekModelProviderOptions = {},
): LlmProviderPlugin {
  const config = options.config ?? readLlmProviderConfig().providers.deepseek;
  const createDeepSeekProvider = options.createDeepSeekProvider ?? createDeepSeek;

  return {
    kind: "llm-provider",
    connectionSettingsPolicy: "optional-base-url",
    createModel(modelId) {
      const apiKey = config.apiKey;
      if (!apiKey) {
        throw new Error("DEEPSEEK_API_KEY is required to create a DeepSeek language model");
      }

      return createDeepSeekProvider({
        apiKey,
        baseURL: config.baseURL ?? defaultDeepSeekBaseURL,
      }).chat(modelId);
    },
    displayName: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    id: "deepseek",
    models: [
      {
        contextWindowTokens: 1_000_000,
        displayName: "DeepSeek V4 Pro",
        id: "deepseek-v4-pro",
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_000_000,
        displayName: "DeepSeek V4 Flash",
        id: "deepseek-v4-flash",
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_000_000,
        displayName: "DeepSeek V4.1 Flash",
        id: "deepseek-flash",
        supportsTemperature: false,
        supportsTools: true,
      },
    ],
  };
}

export function createDeepSeekModelProvider(
  options: CreateDeepSeekModelProviderOptions = {},
): ModelProvider {
  const plugin = createDeepSeekModelProviderPlugin(options);
  return {
    getLanguageModel(modelId) {
      return plugin.createModel(modelId);
    },
  };
}
