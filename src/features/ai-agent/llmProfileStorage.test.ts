import { beforeEach, describe, expect, it } from "vitest";
import {
  LEGACY_LLM_PROFILE_SETTINGS_STORAGE_KEY,
  LLM_PROFILE_SETTINGS_STORAGE_KEY,
  readLlmProfileSettings,
  writeLlmProfileSettings,
} from "./llmProfileStorage";
import type { LlmProfileRoleAssignments } from "./llmProfiles";

const defaultAssignments: LlmProfileRoleAssignments = {
  main: { kind: "profile", profileId: "builtin:deepseek:main" },
  search: { kind: "profile", profileId: "builtin:deepseek:search" },
  simple: { kind: "profile", profileId: "builtin:deepseek:simple" },
  writing: { kind: "profile", profileId: "builtin:deepseek:writing" },
};

const openaiAssignments: LlmProfileRoleAssignments = {
  main: { kind: "profile", profileId: "builtin:openai:main" },
  search: { kind: "profile", profileId: "builtin:openai:search" },
  simple: { kind: "profile", profileId: "builtin:openai:simple" },
  writing: { kind: "profile", profileId: "builtin:openai:writing" },
};

const providers = [
  {
    displayName: "DeepSeek",
    id: "deepseek",
    models: [
      { available: true, displayName: "DeepSeek V4 Pro", id: "deepseek-v4-pro", supportsTools: true },
      { available: true, displayName: "DeepSeek V4 Flash", id: "deepseek-v4-flash", supportsTools: true },
      { available: true, displayName: "DeepSeek V4.1 Flash", id: "deepseek-flash", supportsTemperature: false, supportsTools: true },
    ],
  },
  {
    displayName: "OpenAI",
    id: "openai",
    models: [
      { available: true, displayName: "GPT 5.4 Mini", id: "gpt-5.4-mini", supportsTools: true },
      { available: true, displayName: "GPT 5.5", id: "gpt-5.5", supportsTools: true },
      { available: true, displayName: "GPT 5.6 Sol", id: "gpt-5.6-sol", supportsTools: true },
      { available: true, displayName: "GPT 5.6 Terra", id: "gpt-5.6-terra", supportsTools: true },
      { available: true, displayName: "GPT 5.6 Luna", id: "gpt-5.6-luna", supportsTools: true },
      { available: true, displayName: "GPT-6 Astra", id: "gpt-6-astra", supportsTools: true },
      { available: true, displayName: "GPT-6 Sol", id: "gpt-6-sol", supportsTools: true },
      { available: true, displayName: "GPT-6 Luna", id: "gpt-6-luna", supportsTools: true },
    ],
  },
  {
    displayName: "OpenAI互換",
    id: "openai-compatible",
    models: [
      {
        available: false,
        displayName: "local-model",
        id: "local-model",
        supportsTools: false,
        unavailableReason: "OpenAI互換 のbase URLが未設定です。",
      },
    ],
  },
];

describe("LLM profile storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("writes LLM profile settings to the Ghostwriter localStorage key", () => {
    writeLlmProfileSettings({ roleAssignments: defaultAssignments, userProfiles: [] });

    expect(localStorage.getItem(LLM_PROFILE_SETTINGS_STORAGE_KEY)).toContain("builtin:deepseek:main");
    expect(localStorage.getItem(LEGACY_LLM_PROFILE_SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it("reads legacy LLM profile settings when the Ghostwriter key is missing", () => {
    localStorage.setItem(
      LEGACY_LLM_PROFILE_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        roleAssignments: {
          main: "builtin:openai:main",
          search: "builtin:openai:search",
          simple: "builtin:openai:simple",
          writing: "builtin:openai:writing",
        },
        userProfiles: [],
      }),
    );

    expect(readLlmProfileSettings(providers, defaultAssignments).roleAssignments).toEqual(
      openaiAssignments,
    );
  });

  it("writes direct model assignments and reads them back without converting to internal presets", () => {
    const directAssignments: LlmProfileRoleAssignments = {
      main: { kind: "model", providerId: "openai", modelId: "gpt-5.4-mini", temperature: 0.5 },
      search: { kind: "model", providerId: "openai", modelId: "gpt-5.4-mini", maxOutputTokens: 2048 },
      simple: { kind: "profile", profileId: "builtin:deepseek:simple" },
      writing: { kind: "profile", profileId: "builtin:openai:writing" },
    };

    writeLlmProfileSettings({ roleAssignments: directAssignments, userProfiles: [] });

    expect(readLlmProfileSettings(providers, defaultAssignments).roleAssignments).toEqual(directAssignments);
  });

  it("prefers Ghostwriter LLM profile settings over legacy settings", () => {
    localStorage.setItem(
      LEGACY_LLM_PROFILE_SETTINGS_STORAGE_KEY,
      JSON.stringify({ roleAssignments: openaiAssignments, userProfiles: [] }),
    );
    localStorage.setItem(
      LLM_PROFILE_SETTINGS_STORAGE_KEY,
      JSON.stringify({ roleAssignments: defaultAssignments, userProfiles: [] }),
    );

    expect(readLlmProfileSettings(providers, openaiAssignments).roleAssignments).toEqual(
      defaultAssignments,
    );
  });

  it("persists OpenAI-compatible profile connection settings without API key text", () => {
    const userProfile = {
      baseURL: "https://openrouter.ai/api/v1",
      id: "user:openrouter",
      maxOutputTokens: 8192,
      modelId: "openai/gpt-oss-20b",
      name: "OpenRouter GPT OSS",
      providerId: "openai-compatible" as const,
      source: "user" as const,
      supportsToolsOverride: true,
      temperature: 0.4,
    };
    const roleAssignments: LlmProfileRoleAssignments = {
      main: { kind: "profile", profileId: "user:openrouter" },
      search: { kind: "profile", profileId: "user:openrouter" },
      simple: { kind: "profile", profileId: "builtin:deepseek:simple" },
      writing: { kind: "profile", profileId: "builtin:deepseek:writing" },
    };

    writeLlmProfileSettings({
      roleAssignments,
      userProfiles: [userProfile],
    });

    const rawStoredValue = localStorage.getItem(LLM_PROFILE_SETTINGS_STORAGE_KEY);
    expect(rawStoredValue).toContain("https://openrouter.ai/api/v1");
    expect(rawStoredValue).toContain("openai/gpt-oss-20b");
    expect(rawStoredValue).toContain("supportsToolsOverride");
    expect(rawStoredValue).not.toMatch(/apiKey|sk-/i);
    expect(readLlmProfileSettings(providers, defaultAssignments).userProfiles).toEqual([userProfile]);
  });
});
