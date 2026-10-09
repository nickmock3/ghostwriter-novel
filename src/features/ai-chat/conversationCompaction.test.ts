import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ModelProvider } from "../llm/modelProvider";
import { createConversation, appendConversationMessage } from "./conversationHistory";
import { compactConversation } from "./conversationCompaction";

describe("conversation compaction", () => {
  it("generates and saves a checkpoint from the latest checkpoint through the requested message", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-compaction-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const generateObject = vi.fn(async () => ({
      object: {
        summary: "作品状態: 第1章作成済み。ユーザーの希望: 続きを軽快に。決定事項: 一人称。未解決の作業: 第2章。最近の編集・作成: 小説/第001章/本文.txt。現在のファイル内容は必要に応じてReadする。",
      },
      usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
    }));
    const modelProvider = {
      getLanguageModel: vi.fn(() => ({ modelId: "test-model" })),
    } as unknown as ModelProvider;

    try {
      const created = await createConversation({ dataRoot, workspaceRoot });
      const withUser = await appendConversationMessage({
        content: "第1章を書いて",
        conversationId: created.id,
        dataRoot,
        role: "user",
        workspaceRoot,
      });
      const withAssistant = await appendConversationMessage({
        content: "第1章を作成しました。",
        conversationId: created.id,
        dataRoot,
        role: "assistant",
        workspaceRoot,
      });
      const compactedThroughMessageId = withAssistant.messages.at(-1)?.id ?? "";

      const result = await compactConversation({
        compactedThroughMessageId,
        conversationId: created.id,
        dataRoot,
        generateObject,
        modelProvider,
        modelSelection: {
          modelId: "test-model",
          providerId: "deepseek",
          profileId: "builtin:deepseek:main",
        },
        workspaceRoot,
      });

      expect(result.status).toBe("compacted");
      expect(result.conversation.messages).toEqual(withAssistant.messages);
      expect(result.conversation.conversationCompactions).toHaveLength(1);
      expect(result.conversation.conversationCompactions[0]).toMatchObject({
        compactedThroughMessageId,
        sourceMessageIds: withAssistant.messages.map((message) => message.id),
        summary: expect.stringContaining("現在のファイル内容は必要に応じてReadする"),
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 40,
          totalTokens: 140,
        },
      });
      expect(generateObject).toHaveBeenCalledWith(expect.objectContaining({
        model: { modelId: "test-model" },
        schema: expect.anything(),
      }));
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("returns a skipped result when there are not enough new messages to compact", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-compaction-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const generateObject = vi.fn();

    try {
      const created = await createConversation({ dataRoot, workspaceRoot });
      const result = await compactConversation({
        compactedThroughMessageId: "missing-message",
        conversationId: created.id,
        dataRoot,
        generateObject,
        modelProvider: { getLanguageModel: vi.fn(() => ({})) } as unknown as ModelProvider,
        modelSelection: { modelId: "test-model", providerId: "deepseek" },
        workspaceRoot,
      });

      expect(result.status).toBe("skipped");
      if (result.status !== "skipped") {
        throw new Error("Expected skipped compaction");
      }
      expect(result.reason).toMatch(/not enough/i);
      expect(result.conversation.messages).toEqual([]);
      expect(result.conversation.conversationCompactions).toEqual([]);
      expect(generateObject).not.toHaveBeenCalled();
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });
});
