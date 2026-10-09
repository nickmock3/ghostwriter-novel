export const DEFAULT_MAX_AGENTS_MD_BYTES = 64 * 1024;

export type RuntimeEnv = Record<string, string | undefined>;

export type LlmProviderRuntimeConfig = {
  apiKey?: string;
  baseURL?: string;
  models?: string[];
  toolModels?: string[];
};

export type LlmProviderConfig = {
  defaultModelId?: string;
  defaultProviderId?: string;
  providers: {
    anthropic: LlmProviderRuntimeConfig;
    deepseek: LlmProviderRuntimeConfig;
    gemini: LlmProviderRuntimeConfig;
    openai: LlmProviderRuntimeConfig;
    "openai-compatible"?: LlmProviderRuntimeConfig;
  };
};

export type WorkspaceInstructionsConfig = {
  maxAgentsMdBytes: number;
};

export const PACKAGED_DESKTOP_RUNTIME_MODE = "desktop-packaged";

const LLM_API_KEY_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_API_KEY",
  "GHOSTWRITER_OPENAI_COMPATIBLE_API_KEY",
] as const;

export function isPackagedDesktopRuntime(env: RuntimeEnv = process.env): boolean {
  return env.GHOSTWRITER_RUNTIME_MODE === PACKAGED_DESKTOP_RUNTIME_MODE;
}

export function parseMaxAgentsMdBytes(rawValue: string | undefined): number {
  if (!rawValue) {
    return DEFAULT_MAX_AGENTS_MD_BYTES;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    return DEFAULT_MAX_AGENTS_MD_BYTES;
  }

  return parsedValue;
}

function readOptionalEnvApiKey(
  env: RuntimeEnv,
  envKey: (typeof LLM_API_KEY_ENV_KEYS)[number],
): string | undefined {
  if (isPackagedDesktopRuntime(env)) {
    return undefined;
  }

  return env[envKey];
}

export function readLlmProviderConfig(env: RuntimeEnv = process.env): LlmProviderConfig {
  return {
    defaultModelId: env.GHOSTWRITER_DEFAULT_MODEL ?? env.SIMPLE_AI_AGENT_DEFAULT_MODEL,
    defaultProviderId: env.GHOSTWRITER_DEFAULT_PROVIDER ?? env.SIMPLE_AI_AGENT_DEFAULT_PROVIDER,
    providers: {
      anthropic: {
        apiKey: readOptionalEnvApiKey(env, "ANTHROPIC_API_KEY"),
        baseURL: env.GHOSTWRITER_ANTHROPIC_BASE_URL ?? env.SIMPLE_AI_AGENT_ANTHROPIC_BASE_URL,
      },
      deepseek: {
        apiKey: readOptionalEnvApiKey(env, "DEEPSEEK_API_KEY"),
        baseURL: env.GHOSTWRITER_DEEPSEEK_BASE_URL ?? env.SIMPLE_AI_AGENT_DEEPSEEK_BASE_URL,
      },
      gemini: {
        apiKey: readOptionalEnvApiKey(env, "GOOGLE_GENERATIVE_AI_API_KEY"),
        baseURL: env.GHOSTWRITER_GEMINI_BASE_URL ?? env.SIMPLE_AI_AGENT_GEMINI_BASE_URL,
      },
      openai: {
        apiKey: readOptionalEnvApiKey(env, "OPENAI_API_KEY"),
        baseURL: env.GHOSTWRITER_OPENAI_BASE_URL ?? env.SIMPLE_AI_AGENT_OPENAI_BASE_URL,
      },
      "openai-compatible": {
        apiKey: readOptionalEnvApiKey(env, "GHOSTWRITER_OPENAI_COMPATIBLE_API_KEY"),
        baseURL: env.GHOSTWRITER_OPENAI_COMPATIBLE_BASE_URL,
        models: parseModelList(env.GHOSTWRITER_OPENAI_COMPATIBLE_MODELS),
        toolModels: parseModelList(env.GHOSTWRITER_OPENAI_COMPATIBLE_TOOL_MODELS),
      },
    },
  };
}

function parseModelList(rawValue: string | undefined): string[] | undefined {
  if (!rawValue) {
    return undefined;
  }

  const models = rawValue
    .split(",")
    .map((model) => model.trim())
    .filter((model) => model.length > 0);

  return models.length > 0 ? models : undefined;
}

export function readWorkspaceInstructionsConfig(
  env: RuntimeEnv = process.env,
): WorkspaceInstructionsConfig {
  return {
    maxAgentsMdBytes: parseMaxAgentsMdBytes(
      env.GHOSTWRITER_MAX_AGENTS_MD_BYTES ?? env.SIMPLE_AI_AGENT_MAX_AGENTS_MD_BYTES,
    ),
  };
}
