import {
  createAnthropic,
  type AnthropicProvider,
  type AnthropicProviderSettings,
} from "@ai-sdk/anthropic";
import { readLlmProviderConfig, type LlmProviderConfig } from "../runtimeEnv";
import type { LlmProviderPlugin, ModelProvider } from "./types";

const defaultAnthropicBaseURL = "https://api.anthropic.com/v1";

export type CreateAnthropicModelProviderOptions = {
  createAnthropicProvider?: (settings: AnthropicProviderSettings) => AnthropicProvider;
  config?: LlmProviderConfig["providers"]["anthropic"];
};

export function createAnthropicModelProviderPlugin(
  options: CreateAnthropicModelProviderOptions = {},
): LlmProviderPlugin {
  const config = options.config ?? readLlmProviderConfig().providers.anthropic;
  const createAnthropicProvider = options.createAnthropicProvider ?? createAnthropic;

  return {
    kind: "llm-provider",
    connectionSettingsPolicy: "optional-base-url",
    createModel(modelId) {
      const apiKey = config.apiKey;
      if (!apiKey) {
        throw new Error("ANTHROPIC_API_KEY is required to create an Anthropic language model");
      }

      return createAnthropicProvider({
        apiKey,
        baseURL: config.baseURL ?? defaultAnthropicBaseURL,
      })(modelId);
    },
    displayName: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    id: "anthropic",
    models: [
      {
        contextWindowTokens: 1_000_000,
        displayName: "Claude Sonnet 4.6",
        id: "claude-sonnet-4-6",
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_000_000,
        displayName: "Claude Opus 4.7",
        id: "claude-opus-4-7",
        supportsTemperature: false,
        supportsTools: true,
      },
      {
        contextWindowTokens: 200_000,
        displayName: "Claude Haiku 4.5",
        id: "claude-haiku-4-5",
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_000_000,
        displayName: "Claude Fable 5",
        id: "claude-fable-5",
        supportsTemperature: false,
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_000_000,
        displayName: "Claude Opus 4.8",
        id: "claude-opus-4-8",
        supportsTemperature: false,
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_000_000,
        displayName: "Claude Sonnet 5",
        id: "claude-sonnet-5",
        supportsTemperature: false,
        supportsTools: true,
      },
      {
        contextWindowTokens: 200_000,
        displayName: "Claude Haiku 4.5 (2025-10-01)",
        id: "claude-haiku-4-5-20251001",
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_000_000,
        displayName: "Claude Opus 5",
        id: "claude-opus-5",
        supportsTemperature: false,
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_000_000,
        displayName: "Claude Opus 5.5",
        id: "claude-opus-5-5",
        supportsTemperature: false,
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_000_000,
        displayName: "Claude Fable 5.1",
        id: "claude-fable-5-1",
        supportsTemperature: false,
        supportsTools: true,
      },
    ],
  };
}

export function createAnthropicModelProvider(
  options: CreateAnthropicModelProviderOptions = {},
): ModelProvider {
  const plugin = createAnthropicModelProviderPlugin(options);
  return {
    getLanguageModel(modelId) {
      return plugin.createModel(modelId);
    },
  };
}
