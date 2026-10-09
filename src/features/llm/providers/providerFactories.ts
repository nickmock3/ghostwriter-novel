import type { AnthropicProvider, AnthropicProviderSettings } from "@ai-sdk/anthropic";
import type { DeepSeekProvider, DeepSeekProviderSettings } from "@ai-sdk/deepseek";
import type { GoogleGenerativeAIProvider, GoogleGenerativeAIProviderSettings } from "@ai-sdk/google";
import type { OpenAIProvider, OpenAIProviderSettings } from "@ai-sdk/openai";
import type { LlmProfile } from "../profiles/llmProfiles";
import type { LlmProviderConfig } from "../runtimeEnv";
import { createAnthropicModelProviderPlugin } from "./anthropic";
import { createDeepSeekModelProviderPlugin } from "./deepseek";
import { createGeminiModelProviderPlugin } from "./gemini";
import { createOpenAIModelProviderPlugin } from "./openai";
import { createOpenAICompatibleModelProviderPlugin } from "./openaiCompatible";
import type { LlmProviderId, LlmProviderPlugin } from "./types";

export type CreateLlmProviderPluginsOptions = {
  config?: LlmProviderConfig;
  createAnthropicProvider?: (settings: AnthropicProviderSettings) => AnthropicProvider;
  createDeepSeekProvider?: (settings: DeepSeekProviderSettings) => DeepSeekProvider;
  createGoogleProvider?: (settings: GoogleGenerativeAIProviderSettings) => GoogleGenerativeAIProvider;
  createOpenAIProvider?: (settings: OpenAIProviderSettings) => OpenAIProvider;
  userProfiles?: LlmProfile[];
};

export type LlmProviderPluginFactory = {
  createPlugin: (options: CreateLlmProviderPluginsOptions) => LlmProviderPlugin;
  id: LlmProviderId;
};

export const deepseekProviderPluginFactory: LlmProviderPluginFactory = {
  id: "deepseek",
  createPlugin(options) {
    const config = options.config!;
    return createDeepSeekModelProviderPlugin({
      config: config.providers.deepseek,
      createDeepSeekProvider: options.createDeepSeekProvider,
    });
  },
};

export const openaiProviderPluginFactory: LlmProviderPluginFactory = {
  id: "openai",
  createPlugin(options) {
    const config = options.config!;
    return createOpenAIModelProviderPlugin({
      config: config.providers.openai,
      createOpenAIProvider: options.createOpenAIProvider,
    });
  },
};

export const geminiProviderPluginFactory: LlmProviderPluginFactory = {
  id: "gemini",
  createPlugin(options) {
    const config = options.config!;
    return createGeminiModelProviderPlugin({
      config: config.providers.gemini,
      createGoogleProvider: options.createGoogleProvider,
    });
  },
};

export const anthropicProviderPluginFactory: LlmProviderPluginFactory = {
  id: "anthropic",
  createPlugin(options) {
    const config = options.config!;
    return createAnthropicModelProviderPlugin({
      config: config.providers.anthropic,
      createAnthropicProvider: options.createAnthropicProvider,
    });
  },
};

export const openaiCompatibleProviderPluginFactory: LlmProviderPluginFactory = {
  id: "openai-compatible",
  createPlugin(options) {
    const config = options.config!;
    return createOpenAICompatibleModelProviderPlugin({
      config: config.providers["openai-compatible"] ?? {},
      createOpenAIProvider: options.createOpenAIProvider,
      userProfiles: options.userProfiles,
    });
  },
};

export const defaultLlmProviderPluginFactories: LlmProviderPluginFactory[] = [
  deepseekProviderPluginFactory,
  openaiProviderPluginFactory,
  geminiProviderPluginFactory,
  anthropicProviderPluginFactory,
  openaiCompatibleProviderPluginFactory,
];
