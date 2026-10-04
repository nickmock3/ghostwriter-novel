import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { LlmProviderPlugin } from "../ai-agent/modelProvider";
import type { LlmSecretStore } from "../ai-agent/llmSecretStore";
import type { EditProposal } from "../edit-proposals/editProposalSchemas";
import {
  createAiAssistExecutionService,
  createStandardAiAssistExecutionService,
  resolveAiAssistWritingProfile,
  type CreateAiAssistExecutionServiceDeps,
} from "./aiAssistExecutionService";

const savedContent = "冒頭です。\n重複。\n結びです。";

function pendingProposal(input: {
  newText: string;
  oldText: string;
  path: string;
}): EditProposal {
  return {
    createdAt: "2026-07-14T00:00:00.000Z",
    diff: "diff",
    id: "proposal-1",
    newText: input.newText,
    oldText: input.oldText,
    operation: "edit",
    path: input.path,
    status: "pending",
    title: `Edit ${input.path}`,
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}

function createHarness(options: {
  generatedText?: string;
  resolveAiAssist?: CreateAiAssistExecutionServiceDeps["resolveAiAssist"];
  savedFileContent?: string;
  supportsTemperature?: boolean;
} = {}) {
  type GenerateObjectOptions = Parameters<
    CreateAiAssistExecutionServiceDeps["generateObject"]
  >[0];
  const generateObject = vi.fn(async (_options: GenerateObjectOptions) => ({
    object: { newText: options.generatedText ?? "改善した文です。" },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  }));
  const getLanguageModel = vi.fn(() => ({ model: "writing-model" }));
  const resolveLlmProfileForRole = vi.fn(() => ({
    available: true as const,
    contextWindowTokens: 200_000,
    id: "writing-profile",
    llmProfileRole: "writing" as const,
    maxOutputTokens: 65_536,
    modelId: "writing-model",
    name: "執筆用",
    providerId: "openai" as const,
    source: "built-in" as const,
    ...(options.supportsTemperature === false ? { supportsTemperature: false } : {}),
    temperature: 0.7,
  }));
  const readSavedFile = vi.fn(async () => ({
    content: options.savedFileContent ?? savedContent,
    path: "小説/第001章/本文.txt",
  }));
  const createEditProposal = vi.fn(async (input) => pendingProposal(input));
  const service = createAiAssistExecutionService({
    createEditProposal,
    generateObject,
    modelProvider: { getLanguageModel },
    readSavedFile,
    ...(options.resolveAiAssist ? { resolveAiAssist: options.resolveAiAssist } : {}),
    resolveLlmProfileForRole,
  });

  return {
    createEditProposal,
    generateObject,
    getLanguageModel,
    readSavedFile,
    resolveLlmProfileForRole,
    service,
  };
}

const baseInput = {
  assistId: "polish",
  editorContent: savedContent,
  targetRange: { end: 5, start: 0 },
  workspaceRelativePath: "小説/第001章/本文.txt",
  workspaceRoot: "/tmp/novel",
};

describe("AI assist execution service", () => {
  it.each(["polish", "proofread", "ruby-suggestions"])(
    "runs the built-in %s assist once with the writing profile and creates a pending proposal",
    async (assistId) => {
      const harness = createHarness();

      const result = await harness.service.run({ ...baseInput, assistId });

      expect(result).toMatchObject({
        llmProfile: {
          id: "writing-profile",
          llmProfileRole: "writing",
          modelId: "writing-model",
          providerId: "openai",
        },
        proposal: { id: "proposal-1", status: "pending" },
        status: "completed",
      });
      expect(harness.resolveLlmProfileForRole).toHaveBeenCalledOnce();
      expect(harness.resolveLlmProfileForRole).toHaveBeenCalledWith("writing");
      expect(harness.getLanguageModel).toHaveBeenCalledWith(
        "writing-model",
        "openai",
        "writing-profile",
      );
      expect(harness.generateObject).toHaveBeenCalledOnce();
      expect(harness.createEditProposal).toHaveBeenCalledWith({
        newText: `改善した文です。${savedContent.slice(5)}`,
        oldText: savedContent,
        path: "小説/第001章/本文.txt",
        workspaceRoot: "/tmp/novel",
      });
    },
  );

  it("omits temperature for a writing model that rejects sampling parameters", async () => {
    const harness = createHarness({ supportsTemperature: false });

    await harness.service.run({ ...baseInput, assistId: "polish" });

    expect(harness.generateObject.mock.calls[0]?.[0]).not.toHaveProperty("temperature");
  });

  it("prioritizes a non-empty selection and sends only that target to the model", async () => {
    const harness = createHarness({ generatedText: "磨いた冒頭です。" });

    await harness.service.run(baseInput);

    expect(harness.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("冒頭です。"),
      }),
    );
    const prompt = harness.generateObject.mock.calls[0]?.[0].prompt as string;
    expect(prompt).not.toContain("重複。");
    expect(harness.createEditProposal).toHaveBeenCalledWith({
      newText: `磨いた冒頭です。${savedContent.slice(5)}`,
      oldText: savedContent,
      path: "小説/第001章/本文.txt",
      workspaceRoot: "/tmp/novel",
    });
  });

  it("falls back to the complete file when the selection is empty", async () => {
    const harness = createHarness({ generatedText: "全文を改善しました。" });

    await harness.service.run({
      ...baseInput,
      targetRange: { end: 3, start: 3 },
    });

    expect(harness.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining(savedContent),
      }),
    );
    expect(harness.createEditProposal).toHaveBeenCalledWith({
      newText: "全文を改善しました。",
      oldText: savedContent,
      path: "小説/第001章/本文.txt",
      workspaceRoot: "/tmp/novel",
    });
  });

  it("keeps optional instructions scoped to the current prompt", async () => {
    const withInstruction = createHarness();
    const withoutInstruction = createHarness();

    await withInstruction.service.run({
      ...baseInput,
      additionalInstruction: "硬質な文体を維持してください。",
    });
    await withoutInstruction.service.run(baseInput);

    const promptWith = withInstruction.generateObject.mock.calls[0]?.[0].prompt as string;
    const promptWithout = withoutInstruction.generateObject.mock.calls[0]?.[0].prompt as string;
    expect(promptWith).toContain("硬質な文体を維持してください。");
    expect(promptWithout).not.toContain("追加指示");
  });

  it("rejects unsaved editor content before resolving or calling the model", async () => {
    const harness = createHarness();

    await expect(
      harness.service.run({ ...baseInput, editorContent: `${savedContent}\n未保存` }),
    ).rejects.toThrow("unsaved editor changes");
    expect(harness.resolveLlmProfileForRole).not.toHaveBeenCalled();
    expect(harness.generateObject).not.toHaveBeenCalled();
    expect(harness.createEditProposal).not.toHaveBeenCalled();
  });

  it("rejects out-of-bounds ranges and empty files before model execution", async () => {
    const outOfBounds = createHarness();
    const emptyFile = createHarness({ savedFileContent: "" });

    await expect(
      outOfBounds.service.run({
        ...baseInput,
        targetRange: { end: savedContent.length + 1, start: 0 },
      }),
    ).rejects.toThrow("target range");
    await expect(
      emptyFile.service.run({
        ...baseInput,
        editorContent: "",
        targetRange: { end: 0, start: 0 },
      }),
    ).rejects.toThrow("target text is empty");
    expect(outOfBounds.generateObject).not.toHaveBeenCalled();
    expect(emptyFile.generateObject).not.toHaveBeenCalled();
  });

  it("validates the complete server-side input contract before reading the file", async () => {
    const invalidRange = createHarness();
    const overlongInstruction = createHarness();

    await expect(
      invalidRange.service.run({
        ...baseInput,
        targetRange: { end: 2, start: 3 },
      }),
    ).rejects.toThrow("targetRange");
    await expect(
      overlongInstruction.service.run({
        ...baseInput,
        additionalInstruction: "a".repeat(501),
      }),
    ).rejects.toThrow();
    expect(invalidRange.readSavedFile).not.toHaveBeenCalled();
    expect(overlongInstruction.readSavedFile).not.toHaveBeenCalled();
  });

  it("returns a safe failure response when the model call fails", async () => {
    const harness = createHarness();
    harness.generateObject.mockRejectedValueOnce(new Error("provider unavailable"));

    const result = await harness.service.run(baseInput);

    expect(result).toEqual({
      message: "provider unavailable",
      status: "error",
    });
    expect(harness.createEditProposal).not.toHaveBeenCalled();
  });

  it("returns a safe failure response when proposal creation detects a conflict", async () => {
    const harness = createHarness();
    harness.createEditProposal.mockRejectedValueOnce(
      new Error("Edit proposals require oldText to match exactly once"),
    );

    const result = await harness.service.run(baseInput);

    expect(result).toEqual({
      message: "Edit proposals require oldText to match exactly once",
      status: "error",
    });
  });

  it("rejects unknown assists before model execution", async () => {
    const harness = createHarness();

    await expect(
      harness.service.run({ ...baseInput, assistId: "unknown" }),
    ).rejects.toThrow("Unknown AI assist");
    expect(harness.generateObject).not.toHaveBeenCalled();
  });

  it("resolves a persisted custom assist on the server and keeps its instruction in user task content", async () => {
    const customAssist = {
      additionalInstructionPlaceholder: "今回の補足",
      description: "作品用の整文",
      fixedInstruction: "作品固有の語彙を保ったまま、段落の流れを整えてください。",
      id: "custom-polish",
      isBuiltIn: false as const,
      name: "作品用推敲",
      resultType: "edit-proposal" as const,
      targetType: "text" as const,
    };
    const resolveAiAssist = vi.fn(async () => customAssist);
    const harness = createHarness({ resolveAiAssist });

    await harness.service.run({ ...baseInput, assistId: customAssist.id });

    expect(resolveAiAssist).toHaveBeenCalledWith(customAssist.id);
    expect(harness.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining(customAssist.fixedInstruction),
      }),
    );
  });
});

describe("resolveAiAssistWritingProfile", () => {
  const providers = [
    {
      displayName: "OpenAI",
      id: "openai" as const,
      models: [
        {
          available: true,
          displayName: "Writing model",
          id: "writing-model",
          supportsTools: false,
        },
        {
          available: false,
          displayName: "Unavailable model",
          id: "blocked-model",
          supportsTools: false,
          unavailableReason: "APIキーが未設定です",
        },
      ],
    },
  ];
  const roleAssignments = {
    main: { kind: "model" as const, modelId: "writing-model", providerId: "openai" as const },
    search: { kind: "model" as const, modelId: "writing-model", providerId: "openai" as const },
    simple: { kind: "model" as const, modelId: "writing-model", providerId: "openai" as const },
    writing: { kind: "model" as const, modelId: "writing-model", providerId: "openai" as const },
  };

  it("inherits writing temperature and maxOutputTokens for model overrides", () => {
    const profile = resolveAiAssistWritingProfile({
      providers,
      roleAssignments,
      standardModelSelection: {
        kind: "model",
        modelId: "writing-model",
        providerId: "openai",
      },
      userProfiles: [],
    });

    expect(profile.temperature).toBe(0.7);
    expect(profile.maxOutputTokens).toBe(65_536);
    expect(profile.modelId).toBe("writing-model");
  });

  it("rejects unknown profiles before model provider generation", () => {
    expect(() =>
      resolveAiAssistWritingProfile({
        providers,
        roleAssignments,
        standardModelSelection: { kind: "profile", profileId: "missing-profile" },
        userProfiles: [],
      }),
    ).toThrow('Unknown LLM profile: missing-profile');
  });

  it("rejects unavailable model overrides before model provider generation", () => {
    expect(() =>
      resolveAiAssistWritingProfile({
        providers,
        roleAssignments,
        standardModelSelection: {
          kind: "model",
          modelId: "blocked-model",
          providerId: "openai",
        },
        userProfiles: [],
      }),
    ).toThrow("APIキーが未設定です");
  });
});

describe("standard AI assist production service", () => {
  it("wires the Vercel AI SDK call, writing role, workspace read, and proposal service", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "ghostwriter-ai-assist-"));
    const workspaceRelativePath = "本文.txt";
    const editorContent = "元の本文です。";
    await writeFile(path.join(workspaceRoot, workspaceRelativePath), editorContent, "utf8");
    const languageModel = { model: "writing-model" };
    const plugin: LlmProviderPlugin = {
      connectionSettingsPolicy: "none",
      createModel: vi.fn(() => languageModel as never),
      displayName: "OpenAI",
      envKey: "OPENAI_API_KEY",
      id: "openai",
      kind: "llm-provider",
      models: [
        {
          displayName: "Writing model",
          id: "writing-model",
          supportsTools: false,
        },
      ],
    };
    const secretStore: LlmSecretStore = {
      deleteApiKey: vi.fn(),
      getApiKey: vi.fn(async () => null),
      getStatus: vi.fn(),
      setApiKey: vi.fn(),
    };
    const generateObject = vi.fn(async () => ({
      object: { newText: "改善した本文です。" },
    }));
    const modelAssignment = {
      kind: "model" as const,
      modelId: "writing-model",
      providerId: "openai" as const,
    };
    const service = createStandardAiAssistExecutionService({
      generateObject,
      llmProviderConfig: {
        defaultModelId: "writing-model",
        defaultProviderId: "openai",
        providers: {
          anthropic: {},
          deepseek: {},
          gemini: {},
          openai: { apiKey: "test-key" },
        },
      },
      llmProviderPlugins: [plugin],
      secretStore,
    });

    try {
      const result = await service.run({
        assistId: "proofread",
        editorContent,
        roleAssignments: {
          main: modelAssignment,
          search: modelAssignment,
          simple: modelAssignment,
          writing: modelAssignment,
        },
        targetRange: { end: 0, start: 0 },
        workspaceRelativePath,
        workspaceRoot,
      });

      expect(result).toMatchObject({
        llmProfile: {
          llmProfileRole: "writing",
          modelId: "writing-model",
          providerId: "openai",
        },
        proposal: {
          newText: "改善した本文です。",
          oldText: editorContent,
          path: workspaceRelativePath,
          status: "pending",
        },
        status: "completed",
      });
      expect(generateObject).toHaveBeenCalledOnce();
      expect(plugin.createModel).toHaveBeenCalledWith(
        "writing-model",
        "model:openai:writing-model",
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});
