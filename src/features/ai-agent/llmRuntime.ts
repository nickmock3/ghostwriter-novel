import {
  createLlmProviderPlugins,
  type LlmProviderPlugin,
} from "./modelProvider";
import {
  createLlmSecretStore,
  type LlmSecretStore,
} from "./llmSecretStore";
import { readLlmProviderConfig, type LlmProviderConfig } from "./runtimeEnv";
import type { LlmProfile } from "./llmProfiles";

export type LlmRuntimeOptions = {
  config?: LlmProviderConfig;
  llmProviderPlugins?: LlmProviderPlugin[];
  secretStore?: LlmSecretStore;
};

export type ResolvedLlmRuntime = {
  config: LlmProviderConfig;
  plugins: LlmProviderPlugin[];
};

export type LlmRuntime = {
  resolve(options?: {
    userProfiles?: LlmProfile[];
  }): Promise<ResolvedLlmRuntime>;
};

async function resolveConfigWithSecrets(
  config: LlmProviderConfig,
  secretStore: LlmSecretStore,
): Promise<LlmProviderConfig> {
  return {
    ...config,
    providers: {
      anthropic: {
        ...config.providers.anthropic,
        apiKey:
          config.providers.anthropic.apiKey ??
          (await secretStore.getApiKey("anthropic")) ??
          undefined,
      },
      deepseek: {
        ...config.providers.deepseek,
        apiKey:
          config.providers.deepseek.apiKey ??
          (await secretStore.getApiKey("deepseek")) ??
          undefined,
      },
      gemini: {
        ...config.providers.gemini,
        apiKey:
          config.providers.gemini.apiKey ??
          (await secretStore.getApiKey("gemini")) ??
          undefined,
      },
      openai: {
        ...config.providers.openai,
        apiKey:
          config.providers.openai.apiKey ??
          (await secretStore.getApiKey("openai")) ??
          undefined,
      },
      "openai-compatible": {
        ...(config.providers["openai-compatible"] ?? {}),
        apiKey:
          config.providers["openai-compatible"]?.apiKey ??
          (await secretStore.getApiKey("openai-compatible")) ??
          undefined,
      },
    },
  };
}

export function createLlmRuntime(options: LlmRuntimeOptions = {}): LlmRuntime {
  const config = options.config ?? readLlmProviderConfig();
  const secretStore =
    options.secretStore ??
    createLlmSecretStore({ env: options.config ? {} : process.env });

  return {
    async resolve({ userProfiles } = {}) {
      const oauthOnly = options.llmProviderPlugins?.length && options.llmProviderPlugins.every(plugin => plugin.authentication?.type === "oauth");
      const resolvedConfig = oauthOnly ? config : await resolveConfigWithSecrets(config, secretStore);

      return {
        config: resolvedConfig,
        plugins:
          options.llmProviderPlugins ??
          createLlmProviderPlugins({ config: resolvedConfig, userProfiles }),
      };
    },
  };
}
