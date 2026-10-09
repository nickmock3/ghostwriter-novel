import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { LlmProviderConfig } from "../llm/runtimeEnv";
import type { RunAgentLoopOptions } from "../ai-agent/runAgentLoop";
import {
  appendConversationEditProposal,
  appendConversationMessage,
  createConversation,
  getConversation,
  undoConversationEditProposal,
  updateConversationCodexModel,
  updateConversationCodexTurnState,
} from "./conversationHistory";
import { createAgentChatApplicationService } from "./agentChatApplicationService";

const llmProviderConfig: LlmProviderConfig = {
  defaultProviderId: "deepseek",
  providers: {
    anthropic: {},
    deepseek: { apiKey: "test-deepseek-key" },
    gemini: {},
    openai: {},
    "openai-compatible": {},
  },
};

describe("agent chat application service", () => {
  it.each(["error", "limit"] as const)("preserves applied files and undo after %s termination", async (outcome) => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-interrupted-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-interrupted-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = createAgentChatApplicationService({
      dataRoot, llmProviderConfig,
      runAgentLoop: async function* (options) {
        const proposal = await options.toolServices!.createFileProposal!({content: "saved manuscript", path: "chapter.txt", workspaceRoot});
        yield {type: "tool-result", toolName: "Create", toolCallId: "created", output: proposal};
        if (outcome === "error") {
          yield {type: "tool-call", toolName: "DelegateWriting", toolCallId: "pending", input: {targetPath: "next.txt", instruction: "write"}};
          throw new Error("connection failed");
        }
        yield {type: "finish", finishReason: "tool-calls", totalUsage: {}};
      },
    });
    try {
      const pending = service.runAgentChat({autoCompactEnabled: false, autoCompactThresholdRatio: 0.7, content: "write chapters", conversationId: conversation.id, mode: "chat", workspaceRoot});
      if (outcome === "error") await expect(pending).rejects.toThrow("connection failed");
      else await pending;
      const saved = await getConversation({dataRoot, workspaceRoot, conversationId: conversation.id});
      expect(readFileSync(path.join(workspaceRoot, "chapter.txt"), "utf8")).toBe("saved manuscript");
      expect(saved.editProposals).toHaveLength(1);
      expect(saved.editProposals[0].status).toBe("applied");
      expect(saved.toolActivities.some((activity) => activity.status === "running")).toBe(false);
      if (outcome === "limit") expect(saved.messages.at(-1)?.warnings).toEqual([expect.objectContaining({type: "step_limit"})]);
      else expect(saved.toolActivities).toContainEqual(expect.objectContaining({toolCallId: "pending", status: "failed"}));
      await undoConversationEditProposal({dataRoot, workspaceRoot, conversationId: conversation.id, proposalId: saved.editProposals[0].id});
      expect(existsSync(path.join(workspaceRoot, "chapter.txt"))).toBe(false);
    } finally {
      errorSpy.mockRestore();
      rmSync(dataRoot, {recursive: true, force: true});
      rmSync(workspaceRoot, {recursive: true, force: true});
    }
  });

  it("continues with the uncompressed conversation when automatic compaction fails", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-service-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    await appendConversationMessage({
      content: "古い依頼",
      conversationId: conversation.id,
      dataRoot,
      role: "user",
      workspaceRoot,
    });
    await appendConversationMessage({
      content: "古い回答",
      conversationId: conversation.id,
      dataRoot,
      mainContextSnapshot: {
        contextWindowTokens: 1_000,
        inputTokens: 700,
        llmProfileRole: "main",
        modelId: "deepseek-v4-pro",
        providerId: "deepseek",
      },
      role: "assistant",
      workspaceRoot,
    });
    const compactConversation = vi.fn(async () => {
      throw new Error("compaction unavailable");
    });
    const runAgentLoop = vi.fn(async function* () {
      yield { text: "続けます。", type: "text-delta" as const };
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = createAgentChatApplicationService({
      compactConversation,
      dataRoot,
      llmProviderConfig,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const result = await service.runAgentChat({
        autoCompactEnabled: true,
        autoCompactThresholdRatio: 0.7,
        content: "今回の依頼",
        conversationId: conversation.id,
        workspaceRoot,
      });

      expect(compactConversation).toHaveBeenCalledOnce();
      expect(runAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { content: "古い依頼", role: "user" },
            { content: "古い回答", role: "assistant" },
            { content: "今回の依頼", role: "user" },
          ],
        }),
      );
      expect(result.conversation.messages.at(-1)).toMatchObject({
        content: "続けます。",
        role: "assistant",
      });
      expect(errorSpy).toHaveBeenCalledWith(
        "Auto conversation compaction failed",
        expect.objectContaining({ conversationId: conversation.id, workspaceRoot }),
      );
    } finally {
      errorSpy.mockRestore();
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("persists an LLM failure system message without an HTTP request", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-service-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* (_options: RunAgentLoopOptions) {
      throw new Error("LLM request failed: rate limit");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = createAgentChatApplicationService({
      dataRoot,
      llmProviderConfig,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      await expect(
        service.runAgentChat({
          autoCompactEnabled: true,
          autoCompactThresholdRatio: 0.7,
          content: "続きを書いて",
          conversationId: conversation.id,
          workspaceRoot,
        }),
      ).rejects.toMatchObject({
        conversation: {
          messages: [
            expect.objectContaining({ content: "続きを書いて", role: "user" }),
            expect.objectContaining({
              content: "LLMエラー: LLM request failed: rate limit",
              role: "system",
            }),
          ],
        },
        message: "LLM request failed: rate limit",
      });
    } finally {
      errorSpy.mockRestore();
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("leaves editor-mode edit proposals pending without applying them", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-service-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const filePath = path.join(workspaceRoot, "note.txt");
    writeFileSync(filePath, "before old after", "utf8");
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield {
        output: {
          diff: "--- note.txt\n+++ note.txt\n@@\n-old\n+new",
          newText: "new",
          oldText: "old",
          path: "note.txt",
          title: "Edit note.txt",
        },
        toolCallId: "call-editor-1",
        toolName: "Edit",
        type: "tool-result" as const,
      };
      yield { text: "編集案を作成しました。", type: "text-delta" as const };
    });
    const service = createAgentChatApplicationService({
      dataRoot,
      llmProviderConfig,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const result = await service.runAgentChat({
        autoCompactEnabled: true,
        autoCompactThresholdRatio: 0.7,
        content: "note.txtを直して",
        conversationId: conversation.id,
        mode: "editor",
        workspaceRoot,
      });

      expect(readFileSync(filePath, "utf8")).toBe("before old after");
      expect(result.conversation.editProposals).toEqual([
        expect.objectContaining({ id: "call-editor-1", path: "note.txt", status: "pending" }),
      ]);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("auto-applies an existing pending proposal when chat persistence sees the same id", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-service-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const filePath = path.join(workspaceRoot, "note.txt");
    writeFileSync(filePath, "before old after", "utf8");
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const withAssistant = await appendConversationMessage({
      content: "前回の応答",
      conversationId: conversation.id,
      dataRoot,
      role: "assistant",
      workspaceRoot,
    });
    const assistantMessageId = withAssistant.messages.at(-1)!.id;
    await appendConversationEditProposal({
      assistantMessageId,
      conversationId: conversation.id,
      dataRoot,
      diff: "--- note.txt\n+++ note.txt\n@@\n-old\n+new",
      newText: "new",
      oldText: "old",
      path: "note.txt",
      proposalId: "call-existing-pending",
      status: "pending",
      title: "Edit note.txt",
      workspaceRoot,
    });
    const runAgentLoop = vi.fn(async function* () {
      yield {
        output: {
          diff: "--- note.txt\n+++ note.txt\n@@\n-old\n+new",
          newText: "new",
          oldText: "old",
          path: "note.txt",
          status: "pending",
          title: "Edit note.txt",
        },
        toolCallId: "call-existing-pending",
        toolName: "Edit",
        type: "tool-result" as const,
      };
      yield { text: "既存の編集案を適用します。", type: "text-delta" as const };
    });
    const service = createAgentChatApplicationService({
      dataRoot,
      llmProviderConfig,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const result = await service.runAgentChat({
        autoCompactEnabled: true,
        autoCompactThresholdRatio: 0.7,
        content: "前回の案を適用して",
        conversationId: conversation.id,
        mode: "chat",
        workspaceRoot,
      });

      expect(readFileSync(filePath, "utf8")).toBe("before new after");
      expect(result.conversation.editProposals.filter((proposal) => proposal.id === "call-existing-pending")).toEqual(
        [
          expect.objectContaining({
            id: "call-existing-pending",
            status: "applied",
          }),
        ],
      );
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("auto-applies chat-mode edit proposals and returns the application result", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-service-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const filePath = path.join(workspaceRoot, "note.txt");
    writeFileSync(filePath, "before old after", "utf8");
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield {
        output: {
          diff: "--- note.txt\n+++ note.txt\n@@\n-old\n+new",
          newText: "new",
          oldText: "old",
          path: "note.txt",
          title: "Edit note.txt",
        },
        toolCallId: "call-1",
        toolName: "Edit",
        type: "tool-result" as const,
      };
      yield { text: "編集を適用しました。", type: "text-delta" as const };
    });
    const events: unknown[] = [];
    const service = createAgentChatApplicationService({
      dataRoot,
      llmProviderConfig,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const result = await service.runAgentChat(
        {
          autoCompactEnabled: true,
          autoCompactThresholdRatio: 0.7,
          content: "note.txtを直して",
          conversationId: conversation.id,
          mode: "chat",
          workspaceRoot,
        },
        (event) => events.push(event),
      );

      expect(readFileSync(filePath, "utf8")).toBe("before new after");
      expect(result.conversation.editProposals).toEqual([
        expect.objectContaining({ id: "call-1", path: "note.txt", status: "applied" }),
      ]);
      expect(events.at(-1)).toEqual({
        conversation: result.conversation,
        type: "conversation",
      });
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("applies dependent directory and file proposals during one chat-mode agent turn", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-service-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const novelRoot = path.join(workspaceRoot, "小説");
    const chapterPath = path.join(novelRoot, "第006章");
    const manuscriptPath = path.join(chapterPath, "本文.txt");
    const existingPath = path.join(novelRoot, "既存.txt");
    mkdirSync(novelRoot);
    writeFileSync(existingPath, "変更しない", "utf8");
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* (options: RunAgentLoopOptions) {
      const directoryProposal = await options.toolServices!.createDirectoryProposal!({
        path: "小説/第006章",
        workspaceRoot,
      });
      yield {
        output: directoryProposal,
        toolCallId: "call-dir",
        toolName: "CreateDirectory",
        type: "tool-result" as const,
      };
      const fileProposal = await options.toolServices!.createFileProposal!({
        content: "第六章の本文\n",
        path: "小説/第006章/本文.txt",
        workspaceRoot,
      });
      yield {
        output: fileProposal,
        toolCallId: "call-file",
        toolName: "Create",
        type: "tool-result" as const,
      };
      yield { text: "第六章を作成しました。", type: "text-delta" as const };
    });
    const service = createAgentChatApplicationService({
      dataRoot,
      llmProviderConfig,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const result = await service.runAgentChat({
        autoCompactEnabled: true,
        autoCompactThresholdRatio: 0.7,
        content: "第006章を書いて",
        conversationId: conversation.id,
        mode: "chat",
        workspaceRoot,
      });

      expect(readFileSync(manuscriptPath, "utf8")).toBe("第六章の本文\n");
      expect(readFileSync(existingPath, "utf8")).toBe("変更しない");
      expect(result.conversation.editProposals).toEqual([
        expect.objectContaining({
          id: expect.any(String),
          operation: "createDirectory",
          path: "小説/第006章",
          status: "applied",
        }),
        expect.objectContaining({
          id: expect.any(String),
          operation: "create",
          path: "小説/第006章/本文.txt",
          status: "applied",
          undoSnapshot: {
            afterContent: "第六章の本文\n",
            beforeContent: "",
          },
        }),
      ]);

      const withoutFile = await undoConversationEditProposal({
        conversationId: conversation.id,
        dataRoot,
        proposalId: result.conversation.editProposals[1].id,
        workspaceRoot,
      });
      expect(withoutFile.editProposals[1]?.status).toBe("undone");
      expect(existsSync(manuscriptPath)).toBe(false);

      const withoutDirectory = await undoConversationEditProposal({
        conversationId: conversation.id,
        dataRoot,
        proposalId: result.conversation.editProposals[0].id,
        workspaceRoot,
      });
      expect(withoutDirectory.editProposals[0]?.status).toBe("undone");
      expect(existsSync(chapterPath)).toBe(false);
      expect(readFileSync(existingPath, "utf8")).toBe("変更しない");
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("reads and places a dropped text file through request-scoped chat tools", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-service-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const targetPath = path.join(workspaceRoot, "取り込み.txt");
    const originalBytes = Buffer.from("\uFEFF第一行\r\n第二行\r\n", "utf8");
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    let droppedFileId = "";
    let requestTools: RunAgentLoopOptions["toolServices"];
    const runAgentLoop = vi.fn(async function* (options: RunAgentLoopOptions) {
      requestTools = options.toolServices;
      const contextMessage = String(options.messages[0]?.content);
      droppedFileId = contextMessage.match(/droppedFileId=([0-9a-f-]+)/)?.[1] ?? "";
      expect(droppedFileId).not.toBe("");
      expect(contextMessage).toContain('name="windows.txt"');
      expect(contextMessage).not.toContain("第一行");

      const readResult = await options.toolServices!.readDroppedTextFile!({
        droppedFileId,
      });
      yield {
        output: readResult,
        toolCallId: "drop-read",
        toolName: "ReadDroppedTextFile",
        type: "tool-result" as const,
      };
      const proposal = await options.toolServices!.placeDroppedTextFile!({
        droppedFileId,
        targetPath: "取り込み.txt",
      });
      yield {
        output: proposal,
        toolCallId: "drop-place",
        toolName: "PlaceDroppedTextFile",
        type: "tool-result" as const,
      };
      yield { text: "取り込みました。", type: "text-delta" as const };
    });
    const service = createAgentChatApplicationService({
      dataRoot,
      llmProviderConfig,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const result = await service.runAgentChat({
        autoCompactEnabled: true,
        autoCompactThresholdRatio: 0.7,
        content: "このファイルを配置して",
        conversationId: conversation.id,
        droppedTextFiles: [
          {
            contentBase64: originalBytes.toString("base64"),
            name: "windows.txt",
          },
        ],
        mode: "chat",
        workspaceRoot,
      });

      expect(readFileSync(targetPath)).toEqual(originalBytes);
      expect(result.conversation.editProposals).toEqual([
        expect.objectContaining({
          id: expect.any(String),
          operation: "create",
          path: "取り込み.txt",
          status: "applied",
          undoSnapshot: {
            afterContent: "\uFEFF第一行\r\n第二行\r\n",
            beforeContent: "",
          },
        }),
      ]);
      expect(result.conversation.toolActivities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: "ReadDroppedTextFile windows.txt",
            status: "completed",
            toolCallId: "drop-read",
          }),
          expect.objectContaining({
            label: "PlaceDroppedTextFile 取り込み.txt",
            status: "completed",
            toolCallId: "drop-place",
          }),
        ]),
      );
      await expect(
        requestTools!.readDroppedTextFile!({ droppedFileId }),
      ).rejects.toThrow(/not found|利用できません/i);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("reports placed and unplaced outcomes for every dropped text file without exposing opaque IDs", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-service-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* (options: RunAgentLoopOptions) {
      const contextMessage = String(options.messages[0]?.content);
      const droppedFileIds = [...contextMessage.matchAll(/droppedFileId=([0-9a-f-]+)/g)].map(
        (match) => match[1] ?? "",
      );
      expect(droppedFileIds).toHaveLength(2);

      const proposal = await options.toolServices!.placeDroppedTextFile!({
        droppedFileId: droppedFileIds[0]!,
        targetPath: "配置済み.txt",
      });
      yield {
        output: proposal,
        toolCallId: "drop-place",
        toolName: "PlaceDroppedTextFile",
        type: "tool-result" as const,
      };
    });
    const service = createAgentChatApplicationService({
      dataRoot,
      llmProviderConfig,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });
    const events: unknown[] = [];

    try {
      await service.runAgentChat(
        {
          autoCompactEnabled: true,
          autoCompactThresholdRatio: 0.7,
          content: "配置先を判断して",
          conversationId: conversation.id,
          droppedTextFiles: [
            {
              contentBase64: Buffer.from("配置する", "utf8").toString("base64"),
              name: "placed.txt",
            },
            {
              contentBase64: Buffer.from("今回は置かない", "utf8").toString("base64"),
              name: "unplaced.txt",
            },
          ],
          mode: "chat",
          workspaceRoot,
        },
        (event) => events.push(event),
      );

      expect(events).toEqual(
        expect.arrayContaining([
          {
            file: expect.objectContaining({
              index: 0,
              name: "placed.txt",
              status: "pending",
            }),
            type: "dropped-text-file-status",
          },
          {
            file: expect.objectContaining({
              index: 1,
              name: "unplaced.txt",
              status: "pending",
            }),
            type: "dropped-text-file-status",
          },
          {
            file: expect.objectContaining({
              index: 0,
              name: "placed.txt",
              status: "placed",
              targetPath: "配置済み.txt",
            }),
            type: "dropped-text-file-status",
          },
          {
            file: expect.objectContaining({
              index: 1,
              name: "unplaced.txt",
              status: "unplaced",
            }),
            type: "dropped-text-file-status",
          },
        ]),
      );
      expect(JSON.stringify(events)).not.toContain("droppedFileId");
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("persists an applied directory consistently when a dependent chat-mode Create fails", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-service-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const novelRoot = path.join(workspaceRoot, "小説");
    const chapterPath = path.join(novelRoot, "第006章");
    const existingPath = path.join(novelRoot, "既存.txt");
    mkdirSync(novelRoot);
    writeFileSync(existingPath, "既存本文", "utf8");
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* (options: RunAgentLoopOptions) {
      const directoryProposal = await options.toolServices!.createDirectoryProposal!({
        path: "小説/第006章",
        workspaceRoot,
      });
      yield {
        output: directoryProposal,
        toolCallId: "call-dir",
        toolName: "CreateDirectory",
        type: "tool-result" as const,
      };

      writeFileSync(path.join(chapterPath, "競合.txt"), "外部作成", "utf8");
      try {
        await options.toolServices!.createFileProposal!({
          content: "作成されない本文",
          path: "小説/第006章/競合.txt",
          workspaceRoot,
        });
      } catch (error) {
        yield {
          output: {
            message: error instanceof Error ? error.message : "Create failed",
            status: "error",
          },
          toolCallId: "call-file",
          toolName: "Create",
          type: "tool-result" as const,
        };
      }
      yield { text: "ディレクトリ作成後に競合を検出しました。", type: "text-delta" as const };
    });
    const service = createAgentChatApplicationService({
      dataRoot,
      llmProviderConfig,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const result = await service.runAgentChat({
        autoCompactEnabled: true,
        autoCompactThresholdRatio: 0.7,
        content: "第006章を書いて",
        conversationId: conversation.id,
        mode: "chat",
        workspaceRoot,
      });

      expect(result.conversation.editProposals).toEqual([
        expect.objectContaining({
          id: expect.any(String),
          operation: "createDirectory",
          path: "小説/第006章",
          status: "applied",
        }),
      ]);
      expect(readFileSync(path.join(chapterPath, "競合.txt"), "utf8")).toBe("外部作成");
      expect(readFileSync(existingPath, "utf8")).toBe("既存本文");
      expect(result.conversation.toolActivities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: "failed", toolCallId: "call-file" }),
        ]),
      );
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not double-apply chat proposals when persistence retries the same toolCallId", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-service-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const filePath = path.join(workspaceRoot, "note.txt");
    writeFileSync(filePath, "before old after", "utf8");
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield {
        output: {
          diff: "--- note.txt\n+++ note.txt\n@@\n-old\n+new",
          newText: "new",
          oldText: "old",
          path: "note.txt",
          title: "Edit note.txt",
        },
        toolCallId: "call-1",
        toolName: "Edit",
        type: "tool-result" as const,
      };
      yield { text: "編集を適用しました。", type: "text-delta" as const };
    });
    const service = createAgentChatApplicationService({
      dataRoot,
      llmProviderConfig,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const first = await service.runAgentChat(
        {
          autoCompactEnabled: true,
          autoCompactThresholdRatio: 0.7,
          content: "note.txtを直して",
          conversationId: conversation.id,
          mode: "chat",
          workspaceRoot,
        },
        () => undefined,
      );
      const second = await service.runAgentChat(
        {
          autoCompactEnabled: true,
          autoCompactThresholdRatio: 0.7,
          content: "もう一度同じ結果を保存",
          conversationId: conversation.id,
          mode: "chat",
          workspaceRoot,
        },
        () => undefined,
      );

      expect(readFileSync(filePath, "utf8")).toBe("before new after");
      expect(second.conversation.editProposals.filter((proposal) => proposal.id === "call-1")).toHaveLength(1);
      expect(second.conversation.editProposals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "call-1", status: "applied" }),
        ]),
      );
      expect(first.conversation.editProposals).toEqual(second.conversation.editProposals);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });
});
