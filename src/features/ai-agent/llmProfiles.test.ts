import { describe, expect, it } from "vitest";
import {
  builtInLlmProfiles,
  createDefaultRoleAssignments,
  getLlmProfileTemperature,
  listLlmProfiles,
  llmProfileSchema,
  normalizeRoleAssignments,
  resolveLlmProfileForRole,
  writingProfileResolutionError,
  type LlmRoleAssignment,
  type LlmProfileRoleAssignments,
  type ResolvedLlmProfile,
} from "./llmProfiles";
import type { AvailableLlmProvider } from "./modelProvider";

const configuredProviders: AvailableLlmProvider[] = [
  {
    displayName: "DeepSeek",
    id: "deepseek",
    models: [
      { available: true, displayName: "DeepSeek V4.1 Flash", id: "deepseek-flash", supportsTemperature: false, supportsTools: true },
      { available: true, displayName: "DeepSeek V4 Pro", id: "deepseek-v4-pro", supportsTools: true },
      { available: true, displayName: "DeepSeek V4 Flash", id: "deepseek-v4-flash", supportsTools: true },
    ],
  },
  {
    displayName: "OpenAI",
    id: "openai",
    models: [
      { available: true, displayName: "GPT 5.4 Mini", id: "gpt-5.4-mini", supportsTools: true },
      { available: true, displayName: "GPT 5.5", id: "gpt-5.5", supportsTools: true },
      { available: true, contextWindowTokens: 1_050_000, displayName: "GPT 5.6 Sol", id: "gpt-5.6-sol", supportsTools: true },
      { available: true, contextWindowTokens: 1_050_000, displayName: "GPT 5.6 Terra", id: "gpt-5.6-terra", supportsTools: true },
      { available: true, contextWindowTokens: 1_050_000, displayName: "GPT 5.6 Luna", id: "gpt-5.6-luna", supportsTools: true },
      { available: true, contextWindowTokens: 1_050_000, displayName: "GPT-6 Astra", id: "gpt-6-astra", supportsTemperature: false, supportsTools: true },
      { available: true, contextWindowTokens: 1_050_000, displayName: "GPT-6 Sol", id: "gpt-6-sol", supportsTemperature: false, supportsTools: true },
      { available: true, contextWindowTokens: 1_050_000, displayName: "GPT-6 Luna", id: "gpt-6-luna", supportsTemperature: false, supportsTools: true },
    ],
  },
  {
    displayName: "Gemini",
    id: "gemini",
    models: [
      { available: true, contextWindowTokens: 1_048_576, displayName: "Gemini 3.8 Flash", id: "gemini-3.8-flash", supportsTemperature: false, supportsTools: true },
      { available: true, contextWindowTokens: 1_048_576, displayName: "Gemini 3.7 Flash", id: "gemini-3.7-flash", supportsTemperature: false, supportsTools: true },
      { available: true, contextWindowTokens: 1_048_576, displayName: "Gemini 3.6 Flash", id: "gemini-3.6-flash", supportsTemperature: false, supportsTools: true },
      { available: true, contextWindowTokens: 1_048_576, displayName: "Gemini 3.5 Flash-Lite", id: "gemini-3.5-flash-lite", supportsTemperature: false, supportsTools: true },
      { available: true, displayName: "Gemini 3.5 Flash", id: "gemini-3.5-flash", supportsTools: true },
      { available: true, displayName: "Gemini 3.1 Flash Lite", id: "gemini-3.1-flash-lite", supportsTools: true },
      { available: true, displayName: "Gemini 3.1 Pro", id: "gemini-3.1-pro", supportsTools: true },
      { available: true, displayName: "Gemini 3.1 Flash", id: "gemini-3.1-flash", supportsTools: true },
    ],
  },
  {
    displayName: "Anthropic",
    id: "anthropic",
    models: [
      { available: true, displayName: "Claude Sonnet 4.6", id: "claude-sonnet-4-6", supportsTools: true },
      { available: true, displayName: "Claude Opus 4.7", id: "claude-opus-4-7", supportsTemperature: false, supportsTools: true },
      { available: true, displayName: "Claude Haiku 4.5", id: "claude-haiku-4-5", supportsTools: true },
      { available: true, contextWindowTokens: 1_000_000, displayName: "Claude Fable 5", id: "claude-fable-5", supportsTemperature: false, supportsTools: true },
      { available: true, contextWindowTokens: 1_000_000, displayName: "Claude Opus 4.8", id: "claude-opus-4-8", supportsTemperature: false, supportsTools: true },
      { available: true, contextWindowTokens: 1_000_000, displayName: "Claude Sonnet 5", id: "claude-sonnet-5", supportsTemperature: false, supportsTools: true },
      { available: true, contextWindowTokens: 200_000, displayName: "Claude Haiku 4.5 (2025-10-01)", id: "claude-haiku-4-5-20251001", supportsTools: true },
      { available: true, contextWindowTokens: 1_000_000, displayName: "Claude Opus 5", id: "claude-opus-5", supportsTemperature: false, supportsTools: true },
      { available: true, contextWindowTokens: 1_000_000, displayName: "Claude Fable 5.1", id: "claude-fable-5-1", supportsTemperature: false, supportsTools: true },
      { available: true, contextWindowTokens: 1_000_000, displayName: "Claude Opus 5.5", id: "claude-opus-5-5", supportsTemperature: false, supportsTools: true },
    ],
  },
  {
    displayName: "OpenAI互換",
    id: "openai-compatible",
    models: [
      { available: true, displayName: "local-model", id: "local-model", supportsTools: false },
      { available: true, displayName: "tool-local-model", id: "tool-local-model", supportsTools: true },
    ],
  },
];

describe("LLM profiles", () => {
  it("defines provider-specific built-in presets for every role", () => {
    expect(builtInLlmProfiles.map((profile) => [profile.id, profile.providerId, profile.modelId])).toEqual([
      ["builtin:deepseek:main", "deepseek", "deepseek-v4-pro"],
      ["builtin:deepseek:writing", "deepseek", "deepseek-v4-pro"],
      ["builtin:deepseek:simple", "deepseek", "deepseek-flash"],
      ["builtin:deepseek:search", "deepseek", "deepseek-flash"],
      ["builtin:openai:main", "openai", "gpt-6-sol"],
      ["builtin:openai:writing", "openai", "gpt-6-astra"],
      ["builtin:openai:simple", "openai", "gpt-6-luna"],
      ["builtin:openai:search", "openai", "gpt-6-luna"],
      ["builtin:gemini:main", "gemini", "gemini-3.8-flash"],
      ["builtin:gemini:writing", "gemini", "gemini-3.8-flash"],
      ["builtin:gemini:simple", "gemini", "gemini-3.5-flash-lite"],
      ["builtin:gemini:search", "gemini", "gemini-3.5-flash-lite"],
      ["builtin:anthropic:main", "anthropic", "claude-opus-5-5"],
      ["builtin:anthropic:writing", "anthropic", "claude-fable-5-1"],
      ["builtin:anthropic:simple", "anthropic", "claude-haiku-4-5-20251001"],
      ["builtin:anthropic:search", "anthropic", "claude-haiku-4-5-20251001"],
    ]);
    expect(builtInLlmProfiles.every((profile) => profile.source === "built-in")).toBe(true);
  });

  it("uses role-specific output token defaults for every built-in profile", () => {
    const expectedByRole = {
      main: 4096,
      search: 2048,
      simple: 2048,
      writing: 65536,
    } as const;

    for (const profile of builtInLlmProfiles) {
      const role = profile.id.split(":").at(-1) as keyof typeof expectedByRole;
      expect(profile.maxOutputTokens, profile.id).toBe(expectedByRole[role]);
    }
  });

  it("omits ineffective temperature for the DeepSeek V4.1 Flash preset", () => {
    const assignments = createDefaultRoleAssignments({ providers: configuredProviders });
    const resolved = resolveLlmProfileForRole({
      assignments,
      providers: configuredProviders,
      role: "simple",
    });

    expect(resolved.modelId).toBe("deepseek-flash");
    expect(getLlmProfileTemperature(resolved)).toBeUndefined();
  });

  it("omits sampling temperature for Anthropic models that reject it", () => {
    const resolved = resolveLlmProfileForRole({
      assignments: {
        main: { kind: "profile", profileId: "builtin:anthropic:main" },
        search: { kind: "profile", profileId: "builtin:anthropic:search" },
        simple: { kind: "profile", profileId: "builtin:anthropic:simple" },
        writing: { kind: "profile", profileId: "builtin:anthropic:writing" },
      },
      providers: configuredProviders,
      role: "main",
    });

    expect(resolved.modelId).toBe("claude-opus-5-5");
    expect(getLlmProfileTemperature(resolved)).toBeUndefined();

    const writing = resolveLlmProfileForRole({
      assignments: {
        main: { kind: "profile", profileId: "builtin:anthropic:main" },
        search: { kind: "profile", profileId: "builtin:anthropic:search" },
        simple: { kind: "profile", profileId: "builtin:anthropic:simple" },
        writing: { kind: "profile", profileId: "builtin:anthropic:writing" },
      },
      providers: configuredProviders,
      role: "writing",
    });

    expect(writing.modelId).toBe("claude-fable-5-1");
    expect(getLlmProfileTemperature(writing)).toBeUndefined();
  });

  it("omits sampling temperature for Claude Opus 4.7 and later models selected directly", () => {
    const resolved = resolveLlmProfileForRole({
      assignments: {
        main: { kind: "model", modelId: "claude-opus-4-7", providerId: "anthropic", temperature: 0.3 },
        search: { kind: "profile", profileId: "builtin:anthropic:search" },
        simple: { kind: "profile", profileId: "builtin:anthropic:simple" },
        writing: { kind: "profile", profileId: "builtin:anthropic:writing" },
      },
      providers: configuredProviders,
      role: "main",
    });

    expect(resolved.modelId).toBe("claude-opus-4-7");
    expect(getLlmProfileTemperature(resolved)).toBeUndefined();
  });

  it("omits sampling temperature for the new Gemini models", () => {
    const resolved = resolveLlmProfileForRole({
      assignments: {
        main: {
          kind: "model",
          modelId: "gemini-3.8-flash",
          providerId: "gemini",
          temperature: 0.3,
        },
        search: {
          kind: "model",
          modelId: "gemini-3.5-flash-lite",
          providerId: "gemini",
          temperature: 0.3,
        },
        simple: {
          kind: "model",
          modelId: "gemini-3.5-flash-lite",
          providerId: "gemini",
          temperature: 0.3,
        },
        writing: {
          kind: "model",
          modelId: "gemini-3.7-flash",
          providerId: "gemini",
          temperature: 0.7,
        },
      },
      providers: configuredProviders,
      role: "main",
    });

    expect(resolved.modelId).toBe("gemini-3.8-flash");
    expect(getLlmProfileTemperature(resolved)).toBeUndefined();
  });

  it("marks profiles unavailable when their provider or model is unavailable", () => {
    const profiles = listLlmProfiles({
      providers: [
        configuredProviders[0],
        {
          ...configuredProviders[1],
          models: configuredProviders[1].models.map((model) => ({
            ...model,
            available: false,
            unavailableReason: "OpenAI のAPIキーが未設定です。",
          })),
        },
      ],
    });

    expect(profiles.find((profile) => profile.id === "builtin:deepseek:main")).toMatchObject({
      available: true,
    });
    expect(profiles.find((profile) => profile.id === "builtin:openai:main")).toMatchObject({
      available: false,
      unavailableReason: "OpenAI のAPIキーが未設定です。",
    });
  });

  it("treats cloud OpenAI-compatible user profiles as tool-capable by default", () => {
    const profiles = listLlmProfiles({
      providers: configuredProviders,
      userProfiles: [
        {
          baseURL: "https://openrouter.ai/api/v1",
          id: "user:openrouter",
          maxOutputTokens: 4096,
          modelId: "openai/gpt-oss-20b",
          name: "OpenRouter",
          providerId: "openai-compatible",
          source: "user",
          supportsToolsOverride: false,
          temperature: 0.3,
        },
        {
          baseURL: "http://localhost:1234/v1",
          id: "user:lm-studio",
          maxOutputTokens: 4096,
          modelId: "local-model",
          name: "LM Studio",
          providerId: "openai-compatible",
          source: "user",
          supportsToolsOverride: false,
          temperature: 0.3,
        },
      ],
    });

    expect(profiles.find((profile) => profile.id === "user:openrouter")).toMatchObject({
      available: true,
      unavailableReason: undefined,
    });
    expect(profiles.find((profile) => profile.id === "user:lm-studio")).toMatchObject({
      available: false,
      unavailableReason: "このプロフィールはツール実行に対応していません。",
    });
  });

  it("initializes role assignments from the default provider when available", () => {
    expect(
      createDefaultRoleAssignments({
        defaultProviderId: "openai",
        providers: configuredProviders,
      }),
    ).toEqual({
      main: { kind: "profile", profileId: "builtin:openai:main" },
      search: { kind: "profile", profileId: "builtin:openai:search" },
      simple: { kind: "profile", profileId: "builtin:openai:simple" },
      writing: { kind: "profile", profileId: "builtin:openai:writing" },
    });
  });

  it("falls back through deepseek, openai, gemini, anthropic when the default provider is unavailable", () => {
    const providers = configuredProviders.filter((provider) => provider.id !== "deepseek");

    expect(
      createDefaultRoleAssignments({
        defaultProviderId: "deepseek",
        providers,
      }),
    ).toEqual({
      main: { kind: "profile", profileId: "builtin:openai:main" },
      search: { kind: "profile", profileId: "builtin:openai:search" },
      simple: { kind: "profile", profileId: "builtin:openai:simple" },
      writing: { kind: "profile", profileId: "builtin:openai:writing" },
    });
  });

  it("normalizes deleted, unknown, and unavailable assignments by role", () => {
    const stored = {
      main: "missing",
      search: "builtin:openai:search",
      simple: "builtin:deepseek:simple",
      writing: "builtin:openai:writing",
    };
    const providers = [configuredProviders[0]];

    expect(normalizeRoleAssignments({ assignments: stored, providers })).toEqual({
      main: { kind: "profile", profileId: "builtin:deepseek:main" },
      search: { kind: "profile", profileId: "builtin:deepseek:search" },
      simple: { kind: "profile", profileId: "builtin:deepseek:simple" },
      writing: { kind: "profile", profileId: "builtin:deepseek:writing" },
    });
  });

  it("normalizes legacy string assignments to profile assignment objects", () => {
    const stored = {
      main: "builtin:openai:main",
      search: "builtin:openai:search",
      simple: "builtin:openai:simple",
      writing: "builtin:openai:writing",
    };

    expect(normalizeRoleAssignments({ assignments: stored, providers: configuredProviders })).toEqual({
      main: { kind: "profile", profileId: "builtin:openai:main" },
      search: { kind: "profile", profileId: "builtin:openai:search" },
      simple: { kind: "profile", profileId: "builtin:openai:simple" },
      writing: { kind: "profile", profileId: "builtin:openai:writing" },
    });
  });

  it("resolves a direct provider/model assignment to a virtual profile", () => {
    const assignments: LlmProfileRoleAssignments = {
      main: { kind: "model", providerId: "openai", modelId: "gpt-5.4-mini", temperature: 0.4, maxOutputTokens: 8192 },
      search: { kind: "profile", profileId: "builtin:deepseek:search" },
      simple: { kind: "profile", profileId: "builtin:deepseek:simple" },
      writing: { kind: "profile", profileId: "builtin:deepseek:writing" },
    };

    const resolved = resolveLlmProfileForRole({
      assignments,
      providers: configuredProviders,
      role: "main",
    });

    expect(resolved).toMatchObject({
      id: "model:openai:gpt-5.4-mini",
      llmProfileRole: "main",
      maxOutputTokens: 8192,
      modelId: "gpt-5.4-mini",
      name: "OpenAI / GPT 5.4 Mini",
      providerId: "openai",
      source: "user",
      temperature: 0.4,
    });
  });

  it("uses the writing default for a direct model assignment unless explicitly overridden", () => {
    const createAssignments = (maxOutputTokens?: number): LlmProfileRoleAssignments => ({
      main: { kind: "profile", profileId: "builtin:deepseek:main" },
      search: { kind: "profile", profileId: "builtin:deepseek:search" },
      simple: { kind: "profile", profileId: "builtin:deepseek:simple" },
      writing: {
        kind: "model",
        modelId: "gpt-5.5",
        providerId: "openai",
        ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      },
    });

    expect(
      resolveLlmProfileForRole({
        assignments: createAssignments(),
        providers: configuredProviders,
        role: "writing",
      }).maxOutputTokens,
    ).toBe(65536);
    expect(
      resolveLlmProfileForRole({
        assignments: createAssignments(8192),
        providers: configuredProviders,
        role: "writing",
      }).maxOutputTokens,
    ).toBe(8192);
  });

  it("validates OpenAI-compatible user profile connection settings", () => {
    expect(
      llmProfileSchema.safeParse({
        baseURL: "http://localhost:1234/v1",
        id: "user:local",
        maxOutputTokens: 4096,
        modelId: "local-model",
        name: "LM Studio",
        providerId: "openai-compatible",
        source: "user",
        supportsToolsOverride: false,
        temperature: 0.3,
      }).success,
    ).toBe(true);

    expect(
      llmProfileSchema.safeParse({
        id: "user:local",
        maxOutputTokens: 4096,
        modelId: "local-model",
        name: "LM Studio",
        providerId: "openai-compatible",
        source: "user",
        temperature: 0.3,
      }).success,
    ).toBe(false);

    for (const baseURL of [
      "http://user:pass@localhost:1234/v1",
      "http://localhost:1234/v1?api_key=secret",
      "http://localhost:1234/v1#secret",
    ]) {
      expect(
        llmProfileSchema.safeParse({
          baseURL,
          id: "user:local",
          maxOutputTokens: 4096,
          modelId: "local-model",
          name: "LM Studio",
          providerId: "openai-compatible",
          source: "user",
          temperature: 0.3,
        }).success,
      ).toBe(false);
    }
  });

  it("accepts only positive, bounded integer context window overrides", () => {
    const profile = {
      baseURL: "http://localhost:1234/v1",
      id: "user:local-context",
      maxOutputTokens: 4096,
      modelId: "local-model",
      name: "Local context override",
      providerId: "openai-compatible",
      source: "user",
      supportsToolsOverride: true,
      temperature: 0.3,
    } as const;

    expect(
      llmProfileSchema.safeParse({ ...profile, contextWindowTokensOverride: 131_072 }).success,
    ).toBe(true);
    for (const contextWindowTokensOverride of [0, -1, 1.5, 100_000_001]) {
      expect(
        llmProfileSchema.safeParse({ ...profile, contextWindowTokensOverride }).success,
      ).toBe(false);
    }
  });

  it("resolves a user profile context override ahead of model metadata", () => {
    const providers = configuredProviders.map((provider) =>
      provider.id === "openai-compatible"
        ? {
            ...provider,
            models: provider.models.map((model) =>
              model.id === "tool-local-model"
                ? { ...model, contextWindowTokens: 1_000_000 }
                : model,
            ),
          }
        : provider,
    );
    const userProfile = {
      baseURL: "http://localhost:1234/v1",
      contextWindowTokensOverride: 131_072,
      id: "user:local-context",
      maxOutputTokens: 4096,
      modelId: "tool-local-model",
      name: "Local context override",
      providerId: "openai-compatible" as const,
      source: "user" as const,
      supportsToolsOverride: true,
      temperature: 0.3,
    };
    const assignments = createDefaultRoleAssignments({ providers });

    expect(
      resolveLlmProfileForRole({
        assignments: {
          ...assignments,
          main: { kind: "profile", profileId: userProfile.id },
        },
        providers,
        role: "main",
        userProfiles: [userProfile],
      }).contextWindowTokens,
    ).toBe(131_072);
  });

  it("allows optional base URL on first-party provider user profiles", () => {
    expect(
      llmProfileSchema.safeParse({
        id: "user:openai",
        maxOutputTokens: 4096,
        modelId: "gpt-5.4-mini",
        name: "OpenAI detail",
        providerId: "openai",
        source: "user",
        temperature: 0.3,
      }).success,
    ).toBe(true);

    expect(
      llmProfileSchema.safeParse({
        baseURL: "https://api.openai.com/v1",
        id: "user:openai",
        maxOutputTokens: 4096,
        modelId: "gpt-5.4-mini",
        name: "OpenAI detail",
        providerId: "openai",
        source: "user",
        temperature: 0.3,
      }).success,
    ).toBe(true);
  });

  it("falls back from unknown or unavailable direct model assignments to internal provider defaults", () => {
    const unavailableOpenAiProviders = configuredProviders.map((provider) =>
      provider.id === "openai"
        ? {
            ...provider,
            models: provider.models.map((model) => ({
              ...model,
              available: false,
              unavailableReason: "OpenAI のAPIキーが未設定です。",
            })),
          }
        : provider,
    );

    const assignments: Record<string, LlmRoleAssignment> = {
      main: { kind: "model", providerId: "openai", modelId: "gpt-5.4-mini" },
      search: { kind: "model", providerId: "openai", modelId: "missing" },
      simple: { kind: "model", providerId: "deepseek", modelId: "deepseek-v4-flash" },
      writing: { kind: "model", providerId: "openai", modelId: "gpt-5.5" },
    };

    expect(
      normalizeRoleAssignments({
        assignments,
        defaultProviderId: "openai",
        providers: unavailableOpenAiProviders,
      }),
    ).toEqual({
      main: { kind: "profile", profileId: "builtin:deepseek:main" },
      search: { kind: "profile", profileId: "builtin:deepseek:search" },
      simple: { kind: "model", providerId: "deepseek", modelId: "deepseek-v4-flash" },
      writing: { kind: "profile", profileId: "builtin:deepseek:writing" },
    });
  });

  it("resolves a role to a concrete available provider and model", () => {
    const resolved = resolveLlmProfileForRole({
      assignments: {
        main: "builtin:deepseek:main",
        search: "builtin:deepseek:search",
        simple: "builtin:deepseek:simple",
        writing: "builtin:deepseek:writing",
      },
      providers: configuredProviders,
      role: "search",
    });

    expect(resolved).toMatchObject({
      id: "builtin:deepseek:search",
      llmProfileRole: "search",
      modelId: "deepseek-flash",
      providerId: "deepseek",
    });
  });

  it("reports writing profile resolution errors from a shared helper", () => {
    const availableWriting: ResolvedLlmProfile = {
      available: true,
      contextWindowTokens: 200_000,
      id: "writing-profile",
      llmProfileRole: "writing",
      maxOutputTokens: 65_536,
      modelId: "writing-model",
      name: "執筆用",
      providerId: "openai",
      source: "built-in",
      temperature: 0.7,
    };

    expect(writingProfileResolutionError(availableWriting)).toBeNull();
    expect(
      writingProfileResolutionError({
        ...availableWriting,
        available: false,
        unavailableReason: "APIキーが未設定です",
      }),
    ).toBe("APIキーが未設定です");
    expect(
      writingProfileResolutionError({
        ...availableWriting,
        available: false,
      }),
    ).toBe('No available LLM profile for role "writing"');
    expect(
      writingProfileResolutionError({
        ...availableWriting,
        llmProfileRole: "main",
      }),
    ).toBe('Expected writing LLM profile role but received "main"');
  });
});

it("SIWCが利用不可でも明示した割当を課金APIへ置き換えない", () => {
  const assignments = { ...createDefaultRoleAssignments({ providers: configuredProviders }), main: { kind: "model" as const, providerId: "openai-chatgpt" as const, modelId: "test-model" } };
  expect(normalizeRoleAssignments({ assignments, providers: configuredProviders }).main).toEqual(assignments.main);
  expect(() => resolveLlmProfileForRole({ assignments, providers: configuredProviders, role: "main" })).toThrow();
});
