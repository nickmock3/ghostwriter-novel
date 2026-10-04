import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  appendConversationEditProposal,
  appendConversationMessage,
  createConversation,
} from "./conversationHistory";
import {
  warningsForAssistantMessage,
  llmErrorLogMessage,
  persistAgentChatFailure,
  persistAgentChatRunResult,
} from "./agentChatRunPersistence";

describe("agentChatRunPersistence", () => {
  it("explains termination with pending tool work and offers continuation", () => {
    expect(warningsForAssistantMessage({chatMode: true, failedToolResultCount: 0, finishReason: "tool-calls"}))
      .toEqual([expect.objectContaining({ type: "step_limit", message: expect.stringContaining("続けて") })]);
  });
  it("unifies failure persistence as system message then rethrow with conversation", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-persist-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const withUser = await appendConversationMessage({
      content: "hello",
      conversationId: conversation.id,
      dataRoot,
      role: "user",
      workspaceRoot,
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const events: unknown[] = [];

    try {
      await expect(
        persistAgentChatFailure({
          content: llmErrorLogMessage(new Error("boom")),
          dataRoot,
          error: new Error("boom"),
          fallbackErrorMessage: "LLM execution failed",
          logEvent: "Agent chat LLM execution failed",
          onEvent: (event) => events.push(event),
          userConversation: withUser,
          workspaceRoot,
        }),
      ).rejects.toMatchObject({
        conversation: {
          messages: [
            expect.objectContaining({ role: "user" }),
            expect.objectContaining({
              content: "LLMエラー: boom",
              role: "system",
            }),
          ],
        },
        message: "boom",
      });
      expect(events).toEqual([
        {
          conversation: expect.objectContaining({
            messages: expect.arrayContaining([
              expect.objectContaining({ content: "LLMエラー: boom", role: "system" }),
            ]),
          }),
          type: "conversation",
        },
      ]);
    } finally {
      errorSpy.mockRestore();
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("auto-applies both existing and newly appended pending proposals through one helper path", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-persist-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    writeFileSync(path.join(workspaceRoot, "a.txt"), "before old after", "utf8");
    writeFileSync(path.join(workspaceRoot, "b.txt"), "keep x keep", "utf8");
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const withAssistant = await appendConversationMessage({
      content: "前回",
      conversationId: conversation.id,
      dataRoot,
      role: "assistant",
      workspaceRoot,
    });
    const assistantMessageId = withAssistant.messages.at(-1)!.id;
    const withExisting = await appendConversationEditProposal({
      assistantMessageId,
      conversationId: conversation.id,
      dataRoot,
      diff: "--- a.txt\n+++ a.txt\n@@\n-old\n+new",
      newText: "new",
      oldText: "old",
      path: "a.txt",
      proposalId: "existing-pending",
      status: "pending",
      title: "Edit a.txt",
      workspaceRoot,
    });

    try {
      const result = await persistAgentChatRunResult({
        autoApplyProposals: true,
        dataRoot,
        runResult: {
          assistantContent: "適用しました",
          currentPlanItems: null,
          editProposals: [
            {
              createdAt: "2024-01-01T00:00:00.000Z",
              diff: "--- a.txt\n+++ a.txt\n@@\n-old\n+new",
              id: "existing-pending",
              newText: "new",
              oldText: "old",
              operation: "edit",
              path: "a.txt",
              status: "pending",
              title: "Edit a.txt",
              updatedAt: "2024-01-01T00:00:00.000Z",
            },
            {
              createdAt: "2024-01-01T00:00:01.000Z",
              diff: "--- b.txt\n+++ b.txt\n@@\n-x\n+y",
              id: "new-pending",
              newText: "y",
              oldText: "x",
              operation: "edit",
              path: "b.txt",
              status: "pending",
              title: "Edit b.txt",
              updatedAt: "2024-01-01T00:00:01.000Z",
            },
          ],
          failedToolResultCount: 0,
          finishReason: "stop",
          mainContextSnapshot: null,
          tokenUsage: null,
          toolActivities: [],
          toolResultSummaries: [],
        },
        userConversation: withExisting,
        workspaceRoot,
      });

      expect(readFileSync(path.join(workspaceRoot, "a.txt"), "utf8")).toBe("before new after");
      expect(readFileSync(path.join(workspaceRoot, "b.txt"), "utf8")).toBe("keep y keep");
      expect(result.editProposals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "existing-pending", status: "applied" }),
          expect.objectContaining({ id: "new-pending", status: "applied" }),
        ]),
      );
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });
});
