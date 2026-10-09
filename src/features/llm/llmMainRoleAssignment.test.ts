import { describe, expect, it } from "vitest";
import {
  chatModelSelection,
  updateMainLlmModelSelection,
  updateMainLlmProfileId,
} from "./llmMainRoleAssignment";
import type { LlmProfileSettings } from "./profiles/llmProfileStorage";
import type { LlmProfile } from "./profiles/llmProfiles";

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

describe("LLM main role assignment helpers", () => {
  it("updates only the main role when selecting a profile", () => {
    expect(updateMainLlmProfileId(settings(), "next-profile")).toEqual({
      roleAssignments: {
        main: { kind: "profile", profileId: "next-profile" },
        search: { kind: "profile", profileId: "search-profile" },
        simple: { kind: "profile", profileId: "simple-profile" },
        writing: { kind: "profile", profileId: "writing-profile" },
      },
      userProfiles: [],
    });
  });

  it("updates only the main role when selecting a direct model", () => {
    expect(
      updateMainLlmModelSelection(settings(), {
        modelId: "gpt-5.4-mini",
        providerId: "openai",
      }),
    ).toMatchObject({
      roleAssignments: {
        main: { kind: "model", modelId: "gpt-5.4-mini", providerId: "openai" },
        search: { kind: "profile", profileId: "search-profile" },
        simple: { kind: "profile", profileId: "simple-profile" },
        writing: { kind: "profile", profileId: "writing-profile" },
      },
    });
  });

  it("keeps chat model selection empty when the main role is assigned to a profile", () => {
    expect(
      chatModelSelection(
        { modelId: "deepseek-v4-pro", providerId: "deepseek" },
        { kind: "profile", profileId: "main-profile" },
        [],
      ),
    ).toBeNull();
  });

  it("falls back to a selected profile model when no settings model selection exists", () => {
    const profiles: Array<LlmProfile & { available: boolean; unavailableReason?: string }> = [
      {
        available: true,
        id: "main-profile",
        maxOutputTokens: 4096,
        modelId: "claude-sonnet-4-6",
        name: "Anthropic 通常",
        providerId: "anthropic",
        source: "built-in",
        temperature: 0.3,
      },
    ];

    expect(chatModelSelection(null, { kind: "profile", profileId: "main-profile" }, profiles)).toBeNull();
    expect(chatModelSelection(null, { kind: "model", modelId: "gpt-5.4-mini", providerId: "openai" }, profiles))
      .toEqual({ modelId: "gpt-5.4-mini", providerId: "openai" });
  });

});
