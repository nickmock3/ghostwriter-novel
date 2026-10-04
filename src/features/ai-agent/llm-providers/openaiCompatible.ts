import { createOpenAI, type OpenAIProvider, type OpenAIProviderSettings } from "@ai-sdk/openai";
import type { LlmProfile } from "../llmProfiles";
import { readLlmProviderConfig, type LlmProviderConfig } from "../runtimeEnv";
import { supportsOpenAICompatibleProfileTools } from "./openaiCompatibleTools";
import type { LlmProviderPlugin, ModelProvider } from "./types";

export type CreateOpenAICompatibleModelProviderOptions = {
  createOpenAIProvider?: (settings: OpenAIProviderSettings) => OpenAIProvider;
  config?: LlmProviderConfig["providers"]["openai-compatible"];
  userProfiles?: LlmProfile[];
};

export function createOpenAICompatibleModelProviderPlugin(
  options: CreateOpenAICompatibleModelProviderOptions = {},
): LlmProviderPlugin {
  const config = options.config ?? readLlmProviderConfig().providers["openai-compatible"] ?? {};
  const createOpenAIProvider = options.createOpenAIProvider ?? createOpenAI;
  const userProfileModels = (options.userProfiles ?? []).filter(
    (profile) => profile.providerId === "openai-compatible",
  );
  const models = config.models?.length ? config.models : ["local-model"];
  const toolModels = new Set(config.toolModels ?? []);
  const userProfileByModelId = new Map(
    userProfileModels.map((profile) => [profile.modelId, profile]),
  );
  const userProfileByProfileId = new Map(
    userProfileModels.map((profile) => [profile.id, profile]),
  );

  return {
    kind: "llm-provider",
    connectionSettingsPolicy: "required-base-url",
    displayName: "OpenAI互換",
    envKey: "GHOSTWRITER_OPENAI_COMPATIBLE_API_KEY",
    id: "openai-compatible",
    models: models.map((modelId) => ({
      displayName: modelId,
      id: modelId,
      supportsTools: toolModels.has(modelId),
    })).concat(userProfileModels.map((profile) => ({
      displayName: profile.modelId,
      hasConnectionSettings: Boolean(profile.baseURL),
      id: profile.modelId,
      supportsTools: supportsOpenAICompatibleProfileTools(profile),
    }))),
    createModel(modelId, profileId) {
      const userProfile =
        (profileId ? userProfileByProfileId.get(profileId) : undefined) ??
        userProfileByModelId.get(modelId);
      const baseURL = userProfile?.baseURL ?? config.baseURL;
      if (!baseURL) {
        throw new Error(
          "GHOSTWRITER_OPENAI_COMPATIBLE_BASE_URL is required to create an OpenAI-compatible language model",
        );
      }

      return createOpenAIProvider({
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
        baseURL,
      }).chat(modelId);
    },
  };
}

export function createOpenAICompatibleModelProvider(
  options: CreateOpenAICompatibleModelProviderOptions = {},
): ModelProvider {
  const plugin = createOpenAICompatibleModelProviderPlugin(options);
  return {
    getLanguageModel(modelId, _providerId, profileId) {
      return plugin.createModel(modelId, profileId);
    },
  };
}
