import type { LanguageModel } from "ai";

export type ModelProvider = {
  siwc?: { accountId: string; modelId: string };
  getLanguageModel(modelId: string, providerId?: string, profileId?: string): LanguageModel;
};

export type LlmProviderId =
  | "anthropic"
  | "deepseek"
  | "openai-chatgpt"
  | "openai"
  | "gemini"
  | "openai-compatible";

export type LlmModelDefinition = {
  contextWindowTokens?: number;
  displayName: string;
  hasConnectionSettings?: boolean;
  id: string;
  supportsTemperature?: boolean;
  supportsTools: boolean;
};

export type LlmProviderPlugin = {
  kind: "llm-provider";
  connectionSettingsPolicy: "none" | "optional-base-url" | "required-base-url";
  createModel(modelId: string, profileId?: string): LanguageModel;
  displayName: string;
  envKey?: string;
  authentication?: { type: "oauth"; available: boolean; unavailableReason?: string };
  id: LlmProviderId;
  models: LlmModelDefinition[];
};

export type ChatModelSelection = {
  baseURL?: string;
  modelId: string;
  providerId: string;
};

export type ResolvedChatModelSelection = ChatModelSelection & {
  model: LlmModelDefinition;
  plugin: LlmProviderPlugin;
};

export type AvailableLlmModel = LlmModelDefinition & {
  available: boolean;
  unavailableReason?: string;
};

export type AvailableLlmProvider = {
  displayName: string;
  id: LlmProviderId;
  models: AvailableLlmModel[];
};
