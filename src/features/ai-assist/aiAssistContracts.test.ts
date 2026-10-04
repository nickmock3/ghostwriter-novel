import { describe, expect, it } from "vitest";

import {
  aiAssistDefinitionSchema,
  aiAssistDefinitionInputSchema,
  aiAssistExecuteBodySchema,
  aiAssistExecutionInputSchema,
  aiAssistExecutionOptionSchema,
  aiAssistExecutionRunInputSchema,
  aiAssistResultTypeOptions,
  aiAssistRuntimeSchema,
  aiAssistStandardExecuteBodySchema,
  builtInAiAssists,
  customAiAssistDefinitionSchema,
  composeAiAssistTaskInstructions,
  getBuiltInAiAssist,
  type AiAssistExecutionOption,
} from "./aiAssistContracts";

describe("AI assist contracts", () => {
  const baseDefinition = {
    description: "文章を整えます。",
    fixedInstruction: "文章表現を改善してください。",
    id: "custom-polish",
    isBuiltIn: false,
    name: "カスタム推敲",
    resultType: "edit-proposal",
    targetType: "text",
  };

  it("validates a shared assist definition", () => {
    expect(aiAssistDefinitionSchema.parse(baseDefinition)).toEqual(baseDefinition);
    expect(() => aiAssistDefinitionSchema.parse({ ...baseDefinition, name: "" })).toThrow();
    expect(() => aiAssistDefinitionSchema.parse({ ...baseDefinition, resultType: "text" })).toThrow();
  });

  it("exposes user-facing metadata for every supported result type", () => {
    expect(aiAssistResultTypeOptions).toEqual([
      {
        description: "変更内容を確認してから反映できる編集案を作成します。",
        label: "編集案（確認して反映）",
        value: "edit-proposal",
      },
    ]);
  });

  it("requires the custom fields and enforces bounded metadata", () => {
    const input = {
      additionalInstructionPlaceholder: "例: 文体はそのままにしてください",
      description: "作品固有の表現を整えます。",
      fixedInstruction: "作品固有の表現を尊重しながら本文を整えてください。",
      name: "作品用推敲",
      resultType: "edit-proposal",
      targetType: "text",
    } as const;

    expect(aiAssistDefinitionInputSchema.parse(input)).toEqual(input);
    expect(
      aiAssistDefinitionInputSchema.parse({ ...input, description: "   " }),
    ).toMatchObject({ description: "" });
    expect(
      customAiAssistDefinitionSchema.parse({
        ...input,
        id: "custom-polish",
        isBuiltIn: false,
      }),
    ).toMatchObject({ id: "custom-polish", isBuiltIn: false });
    expect(() => aiAssistDefinitionInputSchema.parse({ ...input, name: "" })).toThrow();
    expect(() =>
      aiAssistDefinitionInputSchema.parse({ ...input, fixedInstruction: "x".repeat(4001) }),
    ).toThrow();
    expect(() =>
      aiAssistDefinitionInputSchema.parse({
        ...input,
        additionalInstructionPlaceholder: "x".repeat(121),
      }),
    ).toThrow();
  });

  it("accepts an execution input without an additional instruction", () => {
    expect(
      aiAssistExecutionInputSchema.parse({
        assistId: "polish",
        targetRange: { end: 12, start: 0 },
        workspaceRelativePath: "小説/第001章/本文.txt",
      }),
    ).toEqual({
      assistId: "polish",
      targetRange: { end: 12, start: 0 },
      workspaceRelativePath: "小説/第001章/本文.txt",
    });
  });

  it("normalizes blank additional instructions to undefined", () => {
    expect(
      aiAssistExecutionInputSchema.parse({
        additionalInstruction: "  \n\t ",
        assistId: "polish",
        targetRange: { end: 12, start: 0 },
        workspaceRelativePath: "小説/第001章/本文.txt",
      }).additionalInstruction,
    ).toBeUndefined();
  });

  it("rejects an additional instruction longer than 500 characters and invalid ranges", () => {
    expect(() =>
      aiAssistExecutionInputSchema.parse({
        additionalInstruction: "a".repeat(501),
        assistId: "polish",
        targetRange: { end: 12, start: 0 },
        workspaceRelativePath: "小説/第001章/本文.txt",
      }),
    ).toThrow();
    expect(() =>
      aiAssistExecutionInputSchema.parse({
        assistId: "polish",
        targetRange: { end: 0, start: 1 },
        workspaceRelativePath: "小説/第001章/本文.txt",
      }),
    ).toThrow();
  });

  it("exposes the three built-in assists as data and rejects unknown ids", () => {
    expect(builtInAiAssists.map((assist) => assist.id)).toEqual([
      "polish",
      "proofread",
      "ruby-suggestions",
    ]);
    expect(getBuiltInAiAssist("proofread")?.name).toBe("校正");
    expect(getBuiltInAiAssist("unknown")).toBeNull();
    expect(builtInAiAssists.every((assist) => assist.isBuiltIn)).toBe(true);
  });

  it("keeps fixed and optional instructions in task input, not system or tool configuration", () => {
    const assist = getBuiltInAiAssist("ruby-suggestions");
    expect(assist).not.toBeNull();

    const instructions = composeAiAssistTaskInstructions(
      assist!,
      "固有名詞を優先してください。",
    );

    expect(instructions).toEqual({
      additionalInstruction: "固有名詞を優先してください。",
      fixedInstruction: assist!.fixedInstruction,
    });
    expect(instructions).not.toHaveProperty("systemPrompt");
    expect(instructions).not.toHaveProperty("tools");
    expect(composeAiAssistTaskInstructions(assist!, undefined)).toEqual({
      fixedInstruction: assist!.fixedInstruction,
    });
  });

  it("shares execute request schemas across API, client, and runtimes", () => {
    expect(aiAssistRuntimeSchema.parse("vercel-ai")).toBe("vercel-ai");
    expect(aiAssistRuntimeSchema.safeParse("codex-app-server").success).toBe(false);

    const baseBody = {
      assistId: "polish",
      editorContent: "本文",
      targetRange: { end: 2, start: 0 },
      workspaceRelativePath: "小説/第001章/本文.txt",
      workspaceRoot: "/tmp/novel",
    };

    expect(
      aiAssistExecuteBodySchema.parse({
        ...baseBody,
        runtime: "vercel-ai",
      }),
    ).toMatchObject({ runtime: "vercel-ai" });

    expect(
      aiAssistStandardExecuteBodySchema.parse({
        ...baseBody,
        runtime: "vercel-ai",
        standardModelSelection: { kind: "default-writing" },
      }),
    ).toMatchObject({
      runtime: "vercel-ai",
      standardModelSelection: { kind: "default-writing" },
    });

    expect(() =>
      aiAssistStandardExecuteBodySchema.parse({
        ...baseBody,
        runtime: "codex-app-server",
      }),
    ).toThrow();

    expect(
      aiAssistExecutionRunInputSchema.parse(baseBody),
    ).toMatchObject({
      editorContent: "本文",
      workspaceRoot: "/tmp/novel",
    });
  });

  it("exposes a single AiAssistExecutionOption contract", () => {
    const option: AiAssistExecutionOption = {
      id: "writing-default",
      label: "執筆用",
      runtime: "vercel-ai",
    };

    expect(aiAssistExecutionOptionSchema.parse(option)).toEqual(option);
    expect(() =>
      aiAssistExecutionOptionSchema.parse({
        ...option,
        runtime: "other",
      }),
    ).toThrow();
  });
});
