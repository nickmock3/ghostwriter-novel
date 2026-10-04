import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendConversationCompaction,
  appendConversationEditProposal,
  appendConversationMessage,
  appendConversationToolResultSummaries,
  createConversation,
  deleteConversation,
  listConversations,
  updateConversationCodexModel,
  workspaceIdForRoot,
} from "./conversationHistory";
import { conversationSchema } from "./conversationSchemas";
import { resolveWorkspaceRoot } from "../workspace/workspacePaths";

describe("conversation history", () => {
  it("persists and clears the selected Codex model without changing the thread id", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-history-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));

    try {
      const created = await createConversation({
        agentRuntime: "codex-app-server",
        dataRoot,
        workspaceRoot,
      });
      const selected = await updateConversationCodexModel({
        conversationId: created.id,
        dataRoot,
        selectedCodexModel: "gpt-sol",
        workspaceRoot,
      });
      expect(selected).toMatchObject({ selectedCodexModel: "gpt-sol" });

      const cleared = await updateConversationCodexModel({
        conversationId: created.id,
        dataRoot,
        selectedCodexModel: null,
        workspaceRoot,
      });
      expect(cleared.selectedCodexModel).toBeNull();
      expect(cleared.codexThreadId).toBe(created.codexThreadId);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("deletes the Ghostwriter conversation file independently of external thread cleanup", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-history-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));

    try {
      const created = await createConversation({
        agentRuntime: "codex-app-server",
        dataRoot,
        workspaceRoot,
      });
      const deleted = await deleteConversation({
        conversationId: created.id,
        dataRoot,
        workspaceRoot,
      });

      expect(deleted).toMatchObject({
        codexThreadId: undefined,
        conversationId: created.id,
      });
      await expect(
        listConversations({ dataRoot, workspaceRoot }),
      ).resolves.toMatchObject({ conversations: [] });
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("defaults compact tool result summaries for legacy conversations and accepts conflicted proposals", () => {
    const parsed = conversationSchema.parse({
      createdAt: "2026-06-18T00:00:00.000Z",
      editProposals: [],
      id: "conversation-1",
      lastOpenedAt: "2026-06-18T00:00:00.000Z",
      messages: [],
      title: "Legacy conversation",
      updatedAt: "2026-06-18T00:00:00.000Z",
      workspaceId: "workspace-1",
    });

    expect(parsed.toolResultSummaries).toEqual([]);
    expect(() =>
      conversationSchema.parse({
        ...parsed,
        editProposals: [
          {
            createdAt: parsed.createdAt,
            diff: "diff",
            id: "proposal-1",
            newText: "new",
            oldText: "old",
            path: "chapter.txt",
            status: "conflicted",
            title: "Edit chapter.txt",
            updatedAt: parsed.updatedAt,
          },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      conversationSchema.parse({
        ...parsed,
        editProposals: [
          {
            createdAt: parsed.createdAt,
            diff: "diff",
            id: "proposal-1",
            newText: "new",
            oldText: "old",
            path: "chapter.txt",
            status: "conflict",
            title: "Edit chapter.txt",
            updatedAt: parsed.updatedAt,
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      conversationSchema.parse({
        ...parsed,
        toolResultSummaries: [
          {
            assistantMessageId: "assistant-1",
            createdAt: parsed.createdAt,
            summary: "x".repeat(513),
            toolCallId: "read-1",
            toolName: "Read",
          },
        ],
      }),
    ).toThrow();
  });

  it("persists one compact tool result summary per tool call", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-history-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));

    try {
      const created = await createConversation({ dataRoot, workspaceRoot });
      const record = {
        assistantMessageId: "assistant-1",
        createdAt: "2026-06-18T00:00:00.000Z",
        summary: "Read chapter.txt: completed, 8 lines, truncated=false",
        toolCallId: "read-1",
        toolName: "Read",
      };
      await appendConversationToolResultSummaries({
        conversationId: created.id,
        dataRoot,
        toolResultSummaries: [record],
        workspaceRoot,
      });
      const updated = await appendConversationToolResultSummaries({
        conversationId: created.id,
        dataRoot,
        toolResultSummaries: [record],
        workspaceRoot,
      });

      expect(updated.toolResultSummaries).toEqual([record]);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("persists conversation compaction checkpoints without deleting source messages", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-history-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));

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
      const sourceMessageIds = withAssistant.messages.map((message) => message.id);
      const compactedThrough = withAssistant.messages.at(-1);

      const updated = await appendConversationCompaction({
        compactedThroughMessageId: compactedThrough?.id ?? "",
        conversationId: created.id,
        dataRoot,
        sourceMessageIds,
        summary: "作品状態: 第1章作成済み。現在のファイル内容は必要に応じてReadする。",
        tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        workspaceRoot,
      });

      expect(updated.messages).toEqual(withAssistant.messages);
      expect(updated.conversationCompactions).toHaveLength(1);
      expect(updated.conversationCompactions[0]).toMatchObject({
        compactedThroughCreatedAt: compactedThrough?.createdAt,
        compactedThroughMessageId: compactedThrough?.id,
        sourceMessageIds,
        tokenUsage: { totalTokens: 15 },
      });
      expect(withUser.messages).toHaveLength(1);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("stores conversations under the workspace id with timestamped messages", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-history-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));

    try {
      const created = await createConversation({ dataRoot, workspaceRoot });
      const updated = await appendConversationMessage({
        content: "調査してください",
        conversationId: created.id,
        dataRoot,
        role: "user",
        workspaceRoot,
      });

      const workspaceId = workspaceIdForRoot(await resolveWorkspaceRoot(workspaceRoot));
      const files = await readdir(path.join(dataRoot, "conversations", workspaceId));
      const saved = JSON.parse(
        await readFile(
          path.join(dataRoot, "conversations", workspaceId, `${created.id}.json`),
          "utf8",
        ),
      );

      expect(files).toEqual([`${created.id}.json`]);
      expect(updated.messages).toMatchObject([
        {
          content: "調査してください",
          role: "user",
        },
      ]);
      expect(saved.messages[0].createdAt).toEqual(expect.any(String));
      expect(saved.updatedAt).toEqual(updated.updatedAt);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("stores optional assistant usage metadata while old messages remain valid", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-history-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));

    try {
      const created = await createConversation({ dataRoot, workspaceRoot });
      const updated = await appendConversationMessage({
        content: "回答です",
        conversationId: created.id,
        dataRoot,
        mainContextSnapshot: {
          contextWindowTokens: 1_000_000,
          inputTokens: 1200,
          llmProfileRole: "main",
          modelId: "deepseek-v4-pro",
          providerId: "deepseek",
        },
        role: "assistant",
        tokenUsage: {
          inputTokens: 1200,
          llmProfileId: "builtin:deepseek:main",
          llmProfileRole: "main",
          modelId: "deepseek-v4-pro",
          outputTokens: 345,
          providerId: "deepseek",
          totalTokens: 1545,
        },
        workspaceRoot,
      });

      expect(updated.messages[0]?.tokenUsage).toEqual({
        inputTokens: 1200,
        llmProfileId: "builtin:deepseek:main",
        llmProfileRole: "main",
        modelId: "deepseek-v4-pro",
        outputTokens: 345,
        providerId: "deepseek",
        totalTokens: 1545,
      });
      expect(updated.messages[0]?.mainContextSnapshot).toEqual({
        contextWindowTokens: 1_000_000,
        inputTokens: 1200,
        llmProfileRole: "main",
        modelId: "deepseek-v4-pro",
        providerId: "deepseek",
      });
      const parsedMessage = conversationSchema.parse({
        ...updated,
        messages: updated.messages.map(
          ({ mainContextSnapshot: _snapshot, tokenUsage: _tokenUsage, ...message }) => message,
        ),
      }).messages[0];
      expect(parsedMessage).toMatchObject({ content: "回答です", role: "assistant" });
      expect(parsedMessage?.mainContextSnapshot).toBeUndefined();
      expect(parsedMessage?.tokenUsage).toBeUndefined();
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("stores optional assistant finish warnings while old messages remain valid", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-history-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));

    try {
      const created = await createConversation({ dataRoot, workspaceRoot });
      const updated = await appendConversationMessage({
        content: "途中までの回答です",
        conversationId: created.id,
        dataRoot,
        finishReason: "length",
        role: "assistant",
        warnings: [
          {
            message: "出力上限に達したため応答が途中で止まった可能性があります。",
            type: "output_limit",
          },
        ],
        workspaceRoot,
      });

      expect(updated.messages[0]).toMatchObject({
        content: "途中までの回答です",
        finishReason: "length",
        role: "assistant",
        warnings: [
          {
            message: "出力上限に達したため応答が途中で止まった可能性があります。",
            type: "output_limit",
          },
        ],
      });
      expect(
        conversationSchema.parse({
          ...updated,
          messages: updated.messages.map(({ finishReason: _finishReason, warnings: _warnings, ...message }) => message),
        }).messages[0],
      ).toMatchObject({
        content: "途中までの回答です",
        role: "assistant",
      });
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("stores edit proposals with timestamps", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-history-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));

    try {
      writeFileSync(path.join(workspaceRoot, "README.md"), "before old after", "utf8");
      const created = await createConversation({ dataRoot, workspaceRoot });
      const updated = await appendConversationEditProposal({
        conversationId: created.id,
        dataRoot,
        newText: "new",
        oldText: "old",
        path: "README.md",
        workspaceRoot,
      });

      expect(updated.editProposals).toMatchObject([
        {
          diff: "--- README.md\n+++ README.md\n@@\n-old\n+new",
          newText: "new",
          oldText: "old",
          path: "README.md",
          status: "pending",
          title: "Edit README.md",
        },
      ]);
      expect(updated.editProposals[0]?.createdAt).toEqual(expect.any(String));
      expect(updated.editProposals[0]?.updatedAt).toEqual(expect.any(String));
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("skips appending edit proposals when the proposal id already exists", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-history-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));

    try {
      writeFileSync(path.join(workspaceRoot, "README.md"), "before old after", "utf8");
      const created = await createConversation({ dataRoot, workspaceRoot });
      const first = await appendConversationEditProposal({
        conversationId: created.id,
        dataRoot,
        diff: "--- README.md\n+++ README.md\n@@\n-old\n+new",
        newText: "new",
        oldText: "old",
        path: "README.md",
        proposalId: "tool-edit-1",
        title: "Edit README.md",
        workspaceRoot,
      });
      const second = await appendConversationEditProposal({
        conversationId: created.id,
        dataRoot,
        diff: "--- README.md\n+++ README.md\n@@\n-old\n+changed",
        newText: "changed",
        oldText: "old",
        path: "README.md",
        proposalId: "tool-edit-1",
        title: "Edit README.md",
        workspaceRoot,
      });

      expect(first.editProposals).toHaveLength(1);
      expect(second.editProposals).toEqual(first.editProposals);
      expect(second.editProposals[0]).toMatchObject({ id: "tool-edit-1", newText: "new" });
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("returns valid conversations and reports corrupt history files as recoverable errors", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-history-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));

    try {
      const first = await createConversation({ dataRoot, workspaceRoot });
      await createConversation({ dataRoot, workspaceRoot });

      const workspaceId = workspaceIdForRoot(await resolveWorkspaceRoot(workspaceRoot));
      mkdirSync(path.join(dataRoot, "conversations", workspaceId), { recursive: true });
      writeFileSync(
        path.join(dataRoot, "conversations", workspaceId, "broken.json"),
        JSON.stringify({ id: "broken", messages: "invalid" }),
      );

      const result = await listConversations({ dataRoot, workspaceRoot });

      expect(result.conversations).toHaveLength(2);
      expect(result.conversations[0].updatedAt >= first.updatedAt).toBe(true);
      expect(result.errors).toEqual([
        {
          fileName: "broken.json",
          message: "Invalid conversation history file",
        },
      ]);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });
});
