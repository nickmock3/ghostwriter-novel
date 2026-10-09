import { readLlmProviderConfig, type LlmProviderConfig } from "../runtimeEnv";
import {
  defaultLlmProviderPluginFactories,
  type CreateLlmProviderPluginsOptions,
} from "./providerFactories";
import type {
  AvailableLlmProvider,
  ChatModelSelection,
  LlmModelDefinition,
  LlmProviderId,
  LlmProviderPlugin,
  ModelProvider,
  ResolvedChatModelSelection,
} from "./types";

type ListAvailableLlmProvidersOptions = {
  config?: LlmProviderConfig;
  plugins?: LlmProviderPlugin[];
  requireTools?: boolean;
};

type ResolveChatModelSelectionOptions = {
  config?: LlmProviderConfig;
  plugins?: LlmProviderPlugin[];
  requireTools?: boolean;
  requestedSelection?: ChatModelSelection;
};

export function createLlmProviderPlugins(
  options: CreateLlmProviderPluginsOptions = {},
): LlmProviderPlugin[] {
  const config = options.config ?? readLlmProviderConfig();

  return defaultLlmProviderPluginFactories.map((factory) =>
    factory.createPlugin({
      ...options,
      config,
    }),
  );
}

export const defaultLlmProviderPlugins = createLlmProviderPlugins();

function findProviderPlugin(
  providerId: string,
  plugins: LlmProviderPlugin[],
): LlmProviderPlugin | undefined {
  return plugins.find((plugin) => plugin.id === providerId);
}

function findModelDefinition(
  plugin: LlmProviderPlugin,
  modelId: string,
): LlmModelDefinition | undefined {
  return plugin.models.find((model) => model.id === modelId);
}

function defaultSelectionFromConfig(
  config: LlmProviderConfig = readLlmProviderConfig(),
): ChatModelSelection {
  const providerId = config.defaultProviderId;
  const modelId = config.defaultModelId;

  if (providerId && modelId) {
    return {
      modelId,
      providerId: providerId as LlmProviderId,
    };
  }

  return {
    modelId: "deepseek-v4-pro",
    providerId: "deepseek",
  };
}

export function resolveChatModelSelection(
  options: ResolveChatModelSelectionOptions = {},
): ResolvedChatModelSelection {
  const plugins = options.plugins ?? defaultLlmProviderPlugins;
  const requestedSelection = options.requestedSelection ?? defaultSelectionFromConfig(options.config);
  const plugin = findProviderPlugin(requestedSelection.providerId, plugins);

  if (!plugin) {
    throw new Error(`Unknown LLM provider "${requestedSelection.providerId}"`);
  }

  const model = findModelDefinition(plugin, requestedSelection.modelId);
  if (!model) {
    throw new Error(
      `Unknown model "${requestedSelection.modelId}" for LLM provider "${requestedSelection.providerId}"`,
    );
  }

  if (options.requireTools && !model.supportsTools) {
    throw new Error(
      `Model "${requestedSelection.providerId}/${requestedSelection.modelId}" does not support tools`,
    );
  }

  const selection = {
    ...(requestedSelection.baseURL !== undefined ? { baseURL: requestedSelection.baseURL } : {}),
    modelId: requestedSelection.modelId,
    providerId: requestedSelection.providerId,
  } as ResolvedChatModelSelection;

  Object.defineProperty(selection, "model", {
    configurable: false,
    enumerable: false,
    value: model,
    writable: false,
  });

  Object.defineProperty(selection, "plugin", {
    configurable: false,
    enumerable: false,
    value: plugin,
    writable: false,
  });

  return selection;
}

export function listAvailableLlmProviders(
  options: ListAvailableLlmProvidersOptions = {},
): AvailableLlmProvider[] {
  const config = options.config ?? readLlmProviderConfig();
  const plugins = options.plugins ?? defaultLlmProviderPlugins;
  const requireTools = options.requireTools ?? false;

  return plugins.map((plugin) => {
    const providerConfig = plugin.id === "openai-chatgpt" ? undefined : config.providers[plugin.id];
    const hasApiKey = Boolean(providerConfig?.apiKey);
    const requiresApiKey = plugin.id !== "openai-compatible" && plugin.authentication?.type !== "oauth";
    return {
      displayName: plugin.displayName,
      id: plugin.id,
      models: plugin.models.map((model) => {
        if (plugin.authentication?.type === "oauth" && !plugin.authentication.available) {
          return { ...model, available: false, unavailableReason: plugin.authentication.unavailableReason ?? "ChatGPTへのサインインが必要です。" };
        }
        if (requireTools && !model.supportsTools) {
          return {
            ...model,
            available: false,
            unavailableReason: "このモデルはツール実行に対応していません。",
          };
        }

        const hasRequiredConnection =
          plugin.connectionSettingsPolicy !== "required-base-url" ||
          model.hasConnectionSettings === true ||
          Boolean(providerConfig?.baseURL);

        if (!hasRequiredConnection) {
          return {
            ...model,
            available: false,
            unavailableReason: `${plugin.displayName} のbase URLが未設定です。`,
          };
        }

        if (requiresApiKey && !hasApiKey) {
          return {
            ...model,
            available: false,
            unavailableReason: `${plugin.displayName} のAPIキーが未設定です。`,
          };
        }

        return {
          ...model,
          available: true,
        };
      }),
    };
  });
}

export function createLlmModelProvider(
  selection: ResolvedChatModelSelection,
): ModelProvider {
  return {
    getLanguageModel(modelId, providerId, profileId) {
      if (providerId && providerId !== selection.providerId) {
        throw new Error(
          `Selected model provider was resolved for "${selection.providerId}/${selection.modelId}" but "${providerId}/${modelId}" was requested`,
        );
      }

      if (modelId !== selection.modelId) {
        throw new Error(
          `Selected model provider was resolved for "${selection.providerId}/${selection.modelId}" but "${modelId}" was requested`,
        );
      }

      return selection.plugin.createModel(selection.modelId, profileId);
    },
  };
}

export function createLlmPluginModelProvider(plugins: LlmProviderPlugin[]): ModelProvider {
  return {
    getLanguageModel(modelId, providerId, profileId) {
      if (!providerId) {
        throw new Error(`Provider id is required to create LLM model "${modelId}"`);
      }

      const plugin = findProviderPlugin(providerId, plugins);
      if (!plugin) {
        throw new Error(`Unknown LLM provider "${providerId}"`);
      }

      const model = findModelDefinition(plugin, modelId);
      if (!model) {
        throw new Error(`Unknown model "${modelId}" for LLM provider "${providerId}"`);
      }

      return plugin.createModel(modelId, profileId);
    },
  };
}
