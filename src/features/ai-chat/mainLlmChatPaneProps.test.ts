import { describe, expect, it } from "vitest";
import { buildMainLlmChatPaneProps } from "./mainLlmChatPaneProps";
import type { LlmProfileSettings } from "../llm/profiles/llmProfileStorage";
import type { LlmProfile } from "../llm/profiles/llmProfiles";

function settings(): LlmProfileSettings {
  return {
    roleAssignments: {
      main: { kind: "profile", profileId: "main-profile" },
      search: { kind: "profile", profileId: "search-profile" },
      simple: { kind: "profile", profileId: "simple-profile" },
      writing: { kind: "profile", profileId: "writing-profile" },
    },
    userProfiles: [],
  };
}

describe("main LLM chat connector", () => {
  it("builds the main LLM ChatPane connector from shared route state", () => {
    const providers = [
      {
        displayName: "OpenAI",
        id: "openai",
        models: [{ available: true, displayName: "GPT 5.4 Mini", id: "gpt-5.4-mini", supportsTools: true }],
      },
    ];
    const profiles: Array<LlmProfile & { available: boolean; unavailableReason?: string }> = [
      {
        available: true,
        id: "main-profile",
        maxOutputTokens: 4096,
        modelId: "gpt-5.4-mini",
        name: "メイン",
        providerId: "openai",
        source: "built-in",
        temperature: 0.3,
      },
    ];
    let profileSettings = settings();
    let userSettingsModelSelection: { modelId: string; providerId: string } | null = {
      modelId: "deepseek-v4-pro",
      providerId: "deepseek",
    };

    const connector = buildMainLlmChatPaneProps({
      llmProfileSettings: profileSettings,
      llmProfiles: profiles,
      llmProviders: providers,
      setLlmProfileSettings: (value) => {
        const next = typeof value === "function" ? value(profileSettings) : value;
        if (next) {
          profileSettings = next;
        }
      },
      setSettingsModelSelection: (modelSelection) => {
        userSettingsModelSelection = modelSelection;
      },
      settingsModelSelection: userSettingsModelSelection,
    });

    expect(connector.modelSelection).toBeNull();
    expect(connector.roleAssignments).toEqual(profileSettings.roleAssignments);
    expect(connector.providers).toBe(providers);
    expect(connector.profiles).toBe(profiles);

    connector.onMainLlmModelSelectionChange({ modelId: "gpt-5.4-mini", providerId: "openai" });
    expect(profileSettings.roleAssignments.main).toEqual({
      kind: "model",
      modelId: "gpt-5.4-mini",
      providerId: "openai",
    });
    expect(userSettingsModelSelection).toEqual({ modelId: "gpt-5.4-mini", providerId: "openai" });

    connector.onMainLlmProfileIdChange("main-profile");
    expect(profileSettings.roleAssignments.main).toEqual({ kind: "profile", profileId: "main-profile" });
  });
});
