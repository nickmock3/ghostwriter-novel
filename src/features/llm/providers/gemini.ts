import {
  createGoogleGenerativeAI,
  type GoogleGenerativeAIProvider,
  type GoogleGenerativeAIProviderSettings,
} from "@ai-sdk/google";
import { readLlmProviderConfig, type LlmProviderConfig } from "../runtimeEnv";
import type { LlmProviderPlugin, ModelProvider } from "./types";

const defaultGeminiBaseURL = "https://generativelanguage.googleapis.com/v1beta";

export type CreateGeminiModelProviderOptions = {
  createGoogleProvider?: (settings: GoogleGenerativeAIProviderSettings) => GoogleGenerativeAIProvider;
  config?: LlmProviderConfig["providers"]["gemini"];
};

export function createGeminiModelProviderPlugin(
  options: CreateGeminiModelProviderOptions = {},
): LlmProviderPlugin {
  const config = options.config ?? readLlmProviderConfig().providers.gemini;
  const createGoogleProvider = options.createGoogleProvider ?? createGoogleGenerativeAI;

  return {
    kind: "llm-provider",
    connectionSettingsPolicy: "optional-base-url",
    createModel(modelId) {
      const apiKey = config.apiKey;
      if (!apiKey) {
        throw new Error(
          "GOOGLE_GENERATIVE_AI_API_KEY is required to create a Gemini language model",
        );
      }

      return createGoogleProvider({
        apiKey,
        baseURL: config.baseURL ?? defaultGeminiBaseURL,
      })(modelId);
    },
    displayName: "Gemini",
    envKey: "GOOGLE_GENERATIVE_AI_API_KEY",
    id: "gemini",
    models: [
      {
        contextWindowTokens: 1_048_576,
        displayName: "Gemini 3.8 Flash",
        id: "gemini-3.8-flash",
        supportsTemperature: false,
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_048_576,
        displayName: "Gemini 3.7 Flash",
        id: "gemini-3.7-flash",
        supportsTemperature: false,
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_048_576,
        displayName: "Gemini 3.6 Flash",
        id: "gemini-3.6-flash",
        supportsTemperature: false,
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_048_576,
        displayName: "Gemini 3.5 Flash-Lite",
        id: "gemini-3.5-flash-lite",
        supportsTemperature: false,
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_048_576,
        displayName: "Gemini 3.5 Flash",
        id: "gemini-3.5-flash",
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_048_576,
        displayName: "Gemini 3.1 Flash Lite",
        id: "gemini-3.1-flash-lite",
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_048_576,
        displayName: "Gemini 3.1 Pro",
        id: "gemini-3.1-pro",
        supportsTools: true,
      },
      {
        contextWindowTokens: 1_048_576,
        displayName: "Gemini 3.1 Flash",
        id: "gemini-3.1-flash",
        supportsTools: true,
      },
    ],
  };
}

export function createGeminiModelProvider(
  options: CreateGeminiModelProviderOptions = {},
): ModelProvider {
  const plugin = createGeminiModelProviderPlugin(options);
  return {
    getLanguageModel(modelId) {
      return plugin.createModel(modelId);
    },
  };
}
