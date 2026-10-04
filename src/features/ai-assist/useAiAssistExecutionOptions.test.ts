import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../shared/client/apiTransport";
import { useAiAssistExecutionOptions } from "./useAiAssistExecutionOptions";

vi.mock("../../shared/client/apiTransport", () => ({
  apiFetch: vi.fn(),
}));

const llmProfileSettings = {
  roleAssignments: {
    main: { kind: "profile" as const, profileId: "builtin:openai:writing" },
    search: { kind: "profile" as const, profileId: "builtin:openai:writing" },
    simple: { kind: "profile" as const, profileId: "builtin:openai:writing" },
    writing: { kind: "profile" as const, profileId: "builtin:openai:writing" },
  },
  userProfiles: [],
};

const llmProfiles = [
  {
    available: true,
    id: "builtin:openai:writing",
    llmProfileRole: "writing" as const,
    maxOutputTokens: 4096,
    modelId: "gpt-5.5",
    name: "OpenAI 執筆",
    providerId: "openai" as const,
    source: "built-in" as const,
    temperature: 0.7,
  },
];

const llmProviders = [
  {
    displayName: "OpenAI",
    id: "openai" as const,
    models: [
      {
        available: true,
        displayName: "GPT 5.5",
        id: "gpt-5.5",
        supportsTools: true,
      },
      {
        available: true,
        displayName: "GPT-6 Astra",
        id: "gpt-6-astra",
        supportsTools: true,
      },
    ],
  },
];

afterEach(() => {
  vi.clearAllMocks();
});

describe("useAiAssistExecutionOptions", () => {
  it("offers API key execution without probing a CLI", async () => {
    const { result } = renderHook(() =>
      useAiAssistExecutionOptions({
        llmProfileSettings,
        llmProfiles,
        llmProviders,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(apiFetch).not.toHaveBeenCalled();
    expect(result.current.executionOptions).toEqual([
      { id: "standard", label: "APIキー接続", runtime: "vercel-ai" },
    ]);
  });
});
