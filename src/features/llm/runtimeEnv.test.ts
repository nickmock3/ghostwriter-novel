import { describe, expect, it } from "vitest";
import {
  parseMaxAgentsMdBytes,
  readLlmProviderConfig,
  readWorkspaceInstructionsConfig,
} from "./runtimeEnv";

describe("runtime env config", () => {
  it("reads LLM provider config without exposing unrelated env values", () => {
    expect(
      readLlmProviderConfig({
        ANTHROPIC_API_KEY: "anthropic-secret",
        DEEPSEEK_API_KEY: "deepseek-secret",
        GOOGLE_GENERATIVE_AI_API_KEY: "google-secret",
        OPENAI_API_KEY: "openai-secret",
        GHOSTWRITER_ANTHROPIC_BASE_URL: "https://example.test/anthropic",
        GHOSTWRITER_DEEPSEEK_BASE_URL: "https://example.test/deepseek",
        GHOSTWRITER_DEFAULT_MODEL: "gpt-5.4-mini",
        GHOSTWRITER_DEFAULT_PROVIDER: "openai",
        GHOSTWRITER_GEMINI_BASE_URL: "https://example.test/gemini",
        GHOSTWRITER_OPENAI_BASE_URL: "https://example.test/openai",
        GHOSTWRITER_OPENAI_COMPATIBLE_API_KEY: "compatible-secret",
        GHOSTWRITER_OPENAI_COMPATIBLE_BASE_URL: "http://localhost:1234/v1",
        GHOSTWRITER_OPENAI_COMPATIBLE_MODELS: "local-model, tool-local-model ",
        GHOSTWRITER_OPENAI_COMPATIBLE_TOOL_MODELS: "tool-local-model",
        SHOULD_NOT_LEAK: "ignored",
      }),
    ).toEqual({
      defaultModelId: "gpt-5.4-mini",
      defaultProviderId: "openai",
      providers: {
        anthropic: {
          apiKey: "anthropic-secret",
          baseURL: "https://example.test/anthropic",
        },
        deepseek: {
          apiKey: "deepseek-secret",
          baseURL: "https://example.test/deepseek",
        },
        gemini: {
          apiKey: "google-secret",
          baseURL: "https://example.test/gemini",
        },
        openai: {
          apiKey: "openai-secret",
          baseURL: "https://example.test/openai",
        },
        "openai-compatible": {
          apiKey: "compatible-secret",
          baseURL: "http://localhost:1234/v1",
          models: ["local-model", "tool-local-model"],
          toolModels: ["tool-local-model"],
        },
      },
    });
  });

  it("keeps default provider and model undefined when env does not specify them", () => {
    expect(readLlmProviderConfig({}).defaultProviderId).toBeUndefined();
    expect(readLlmProviderConfig({}).defaultModelId).toBeUndefined();
  });

  it("ignores only LLM API key env values in packaged desktop mode", () => {
    const config = readLlmProviderConfig({
      ANTHROPIC_API_KEY: "anthropic-secret",
      DEEPSEEK_API_KEY: "deepseek-secret",
      GOOGLE_GENERATIVE_AI_API_KEY: "google-secret",
      OPENAI_API_KEY: "openai-secret",
      GHOSTWRITER_ANTHROPIC_BASE_URL: "https://example.test/anthropic",
      GHOSTWRITER_DEEPSEEK_BASE_URL: "https://example.test/deepseek",
      GHOSTWRITER_DEFAULT_MODEL: "gpt-5.5",
      GHOSTWRITER_DEFAULT_PROVIDER: "openai",
      GHOSTWRITER_GEMINI_BASE_URL: "https://example.test/gemini",
      GHOSTWRITER_OPENAI_BASE_URL: "https://example.test/openai",
      GHOSTWRITER_OPENAI_COMPATIBLE_API_KEY: "compatible-secret",
      GHOSTWRITER_OPENAI_COMPATIBLE_BASE_URL: "http://localhost:1234/v1",
      GHOSTWRITER_RUNTIME_MODE: "desktop-packaged",
    });

    expect(config).toMatchObject({
      defaultModelId: "gpt-5.5",
      defaultProviderId: "openai",
      providers: {
        anthropic: {
          apiKey: undefined,
          baseURL: "https://example.test/anthropic",
        },
        deepseek: {
          apiKey: undefined,
          baseURL: "https://example.test/deepseek",
        },
        gemini: {
          apiKey: undefined,
          baseURL: "https://example.test/gemini",
        },
        openai: {
          apiKey: undefined,
          baseURL: "https://example.test/openai",
        },
        "openai-compatible": {
          apiKey: undefined,
          baseURL: "http://localhost:1234/v1",
        },
      },
    });
  });

  it("keeps legacy SIMPLE_AI_AGENT env fallback but prefers GHOSTWRITER values", () => {
    expect(
      readLlmProviderConfig({
        GHOSTWRITER_DEFAULT_MODEL: "gpt-5.5",
        GHOSTWRITER_DEFAULT_PROVIDER: "openai",
        GHOSTWRITER_OPENAI_BASE_URL: "https://new.example.test/openai",
        SIMPLE_AI_AGENT_DEFAULT_MODEL: "deepseek-v4-pro",
        SIMPLE_AI_AGENT_DEFAULT_PROVIDER: "deepseek",
        SIMPLE_AI_AGENT_OPENAI_BASE_URL: "https://legacy.example.test/openai",
      }),
    ).toMatchObject({
      defaultModelId: "gpt-5.5",
      defaultProviderId: "openai",
      providers: {
        openai: { baseURL: "https://new.example.test/openai" },
      },
    });

    expect(
      readLlmProviderConfig({
        SIMPLE_AI_AGENT_DEFAULT_MODEL: "deepseek-v4-pro",
        SIMPLE_AI_AGENT_DEFAULT_PROVIDER: "deepseek",
        SIMPLE_AI_AGENT_DEEPSEEK_BASE_URL: "https://legacy.example.test/deepseek",
      }),
    ).toMatchObject({
      defaultModelId: "deepseek-v4-pro",
      defaultProviderId: "deepseek",
      providers: {
        deepseek: { baseURL: "https://legacy.example.test/deepseek" },
      },
    });
  });

  it("parses AGENTS.md byte limit with default, invalid fallback, and positive overrides", () => {
    expect(parseMaxAgentsMdBytes(undefined)).toBe(64 * 1024);
    expect(parseMaxAgentsMdBytes("nope")).toBe(64 * 1024);
    expect(parseMaxAgentsMdBytes("0")).toBe(64 * 1024);
    expect(parseMaxAgentsMdBytes("-1")).toBe(64 * 1024);
    expect(parseMaxAgentsMdBytes("128")).toBe(128);
  });

  it("reads workspace instruction config from runtime env", () => {
    expect(
      readWorkspaceInstructionsConfig({
        GHOSTWRITER_MAX_AGENTS_MD_BYTES: "2048",
      }),
    ).toEqual({ maxAgentsMdBytes: 2048 });
  });

  it("keeps legacy AGENTS.md byte limit fallback but prefers GHOSTWRITER", () => {
    expect(
      readWorkspaceInstructionsConfig({
        GHOSTWRITER_MAX_AGENTS_MD_BYTES: "4096",
        SIMPLE_AI_AGENT_MAX_AGENTS_MD_BYTES: "2048",
      }),
    ).toEqual({ maxAgentsMdBytes: 4096 });

    expect(
      readWorkspaceInstructionsConfig({
        SIMPLE_AI_AGENT_MAX_AGENTS_MD_BYTES: "2048",
      }),
    ).toEqual({ maxAgentsMdBytes: 2048 });
  });
});
