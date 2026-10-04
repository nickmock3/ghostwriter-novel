import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteAiAssistDefinition,
  executeAiAssist,
  fetchAiAssistDefinitions,
  saveAiAssistDefinition,
} from "./aiAssistClient";
import { resetApiTransportForTests } from "../../shared/client/apiTransport";

const customAssist = {
  additionalInstructionPlaceholder: "今回の補足",
  description: "作品用の整文",
  fixedInstruction: "作品固有の語彙を保ったまま整えてください。",
  id: "custom-polish",
  isBuiltIn: false as const,
  name: "作品用推敲",
  resultType: "edit-proposal" as const,
  targetType: "text" as const,
};

afterEach(() => {
  resetApiTransportForTests();
  vi.unstubAllGlobals();
});

describe("AI assist definition client", () => {
  it("reads and validates the definition list", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ assists: [customAssist] }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAiAssistDefinitions()).resolves.toEqual([customAssist]);
    expect(fetchMock).toHaveBeenCalledWith("/api/ai-assists", undefined);
  });

  it("does not expose an arbitrary server error when loading definitions fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { message: "Add-Type : Cannot add type. powershell.exe stack" },
          { status: 500 },
        ),
      ),
    );

    await expect(fetchAiAssistDefinitions()).rejects.toThrow(
      "AIアシスト一覧の読み込みに失敗しました。",
    );
    await expect(fetchAiAssistDefinitions()).rejects.not.toThrow(/powershell|Add-Type/);
  });

  it("saves and deletes definitions through the CRUD endpoints", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ assist: customAssist }, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ ok: true }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const saved = await saveAiAssistDefinition({
      assistId: customAssist.id,
      input: {
        additionalInstructionPlaceholder: customAssist.additionalInstructionPlaceholder,
        description: customAssist.description,
        fixedInstruction: customAssist.fixedInstruction,
        name: customAssist.name,
        resultType: customAssist.resultType,
        targetType: customAssist.targetType,
      },
    });
    await deleteAiAssistDefinition(customAssist.id);

    expect(saved).toEqual(customAssist);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/ai-assists/custom-polish",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/ai-assists/custom-polish",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("executeAiAssist", () => {
  const executionOptions = [
    { id: "standard", label: "標準モデル", runtime: "vercel-ai" as const },
  ];
  const target = {
    content: "本文",
    isDirty: false,
    path: "draft.txt",
    selection: null,
  };
  it("sends standard model selection overrides", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          proposal: {
            createdAt: "2026-07-14T00:00:00.000Z",
            diff: "diff",
            id: "proposal-1",
            newText: "after",
            oldText: "本文",
            operation: "edit",
            path: "draft.txt",
            status: "pending",
            title: "Edit draft.txt",
            updatedAt: "2026-07-14T00:00:00.000Z",
          },
          status: "completed",
        },
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await executeAiAssist({
      assistId: "polish",
      executionOptionId: "standard",
      executionOptions,
      standardModelSelection: {
        kind: "model",
        modelId: "gpt-5.5",
        providerId: "openai",
      },
      target,
      workspaceRoot: "/workspace",
    });

    const requestInit = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const body = JSON.parse(String(requestInit.body));
    expect(body).toMatchObject({
      runtime: "vercel-ai",
      standardModelSelection: {
        kind: "model",
        modelId: "gpt-5.5",
        providerId: "openai",
      },
    });
    expect(body).not.toHaveProperty("selectedModel");
  });
});
