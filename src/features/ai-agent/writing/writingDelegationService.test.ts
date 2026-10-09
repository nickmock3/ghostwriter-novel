import { describe, expect, it, vi } from "vitest";
import { createWritingDelegationService } from "./writingDelegationService";

function createResolvedWritingProfile() {
  return {
    available: true,
    contextWindowTokens: 1_000_000,
    id: "test:writing",
    llmProfileRole: "writing" as const,
    maxOutputTokens: 6000,
    modelId: "writing-model",
    name: "Writing profile",
    providerId: "deepseek" as const,
    source: "built-in" as const,
    temperature: 0.7,
  };
}

describe("createWritingDelegationService", () => {
  it("forwards progress before the artifact is available", async () => {
    const onProgress = vi.fn();
    const execute = createWritingDelegationService({
      generateObject: async (options) => {
        expect(options.onProgress).toBeTypeOf("function");
        options.onProgress?.(100);
        expect(onProgress).toHaveBeenCalledWith(100);
        return {object: {content: "completed manuscript"}};
      },
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      readContentsByPath: new Map(),
      resolveLlmProfileForRole: createResolvedWritingProfile,
      resolveWritingDelegationTarget: async () => ({normalizedPath: "new.txt", state: {kind: "missing"}}),
      workspaceRoot: "/tmp/workspace",
    });
    const result = await execute({instruction: "write", targetPath: "new.txt"}, onProgress);
    expect(result.status).toBe("completed");
    expect(onProgress).toHaveBeenCalledWith(100);
  });
  it("rejects an existing target that was not Read before resolving the writing profile", async () => {
    const resolveLlmProfileForRole = vi.fn(() => createResolvedWritingProfile());
    const generateObject = vi.fn();
    const execute = createWritingDelegationService({
      generateObject,
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      onDelegateWritingDiagnostic: vi.fn(),
      readContentsByPath: new Map(),
      resolveLlmProfileForRole,
      resolveWritingDelegationTarget: vi.fn(async () => ({
        normalizedPath: "manuscript/chapter-01.txt",
        state: { kind: "readable" as const },
      })),
      workspaceRoot: "/tmp/workspace",
    });

    await expect(
      execute({ instruction: "Continue the chapter", targetPath: "manuscript/chapter-01.txt" }),
    ).resolves.toEqual({
      message: "DelegateWriting requires the target file to be read first",
      status: "error",
      targetPath: "manuscript/chapter-01.txt",
    });
    expect(resolveLlmProfileForRole).not.toHaveBeenCalled();
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("generates a create artifact for a missing target without requiring Read", async () => {
    const generateObject = vi.fn().mockResolvedValue({
      object: { content: "NEW_MANUSCRIPT_TEXT" },
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    });
    const execute = createWritingDelegationService({
      generateObject,
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({ modelId: "writing-model" }) },
      readContentsByPath: new Map(),
      resolveLlmProfileForRole: vi.fn(() => createResolvedWritingProfile()),
      resolveWritingDelegationTarget: vi.fn(async () => ({
        normalizedPath: "manuscript/chapter-02.txt",
        state: { kind: "missing" as const },
      })),
      workspaceRoot: "/tmp/workspace",
    });

    await expect(
      execute({ instruction: "Write the next chapter", targetPath: "manuscript/chapter-02.txt" }),
    ).resolves.toMatchObject({
      artifact: { newText: "NEW_MANUSCRIPT_TEXT", oldText: "" },
      operation: "create",
      status: "completed",
      targetPath: "manuscript/chapter-02.txt",
      tokenUsage: {
        llmProfileRole: "writing",
        modelId: "writing-model",
        providerId: "deepseek",
      },
    });
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 6000,
        prompt: expect.stringContaining("Write the next chapter"),
        temperature: 0.7,
      }),
    );
  });

  it("omits temperature for an Anthropic model that rejects sampling parameters", async () => {
    const generateObject = vi.fn().mockResolvedValue({
      object: { content: "NEW_MANUSCRIPT_TEXT" },
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    });
    const execute = createWritingDelegationService({
      generateObject,
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({ modelId: "claude-fable-5-1" }) },
      readContentsByPath: new Map(),
      resolveLlmProfileForRole: vi.fn(() => ({
        ...createResolvedWritingProfile(),
        id: "builtin:anthropic:writing",
        modelId: "claude-fable-5-1",
        providerId: "anthropic" as const,
        supportsTemperature: false,
      })),
      resolveWritingDelegationTarget: vi.fn(async () => ({
        normalizedPath: "manuscript/chapter-03.txt",
        state: { kind: "missing" as const },
      })),
      workspaceRoot: "/tmp/workspace",
    });

    await execute({ instruction: "Write the next chapter", targetPath: "manuscript/chapter-03.txt" });

    expect(generateObject.mock.calls[0]?.[0]).not.toHaveProperty("temperature");
  });
});
