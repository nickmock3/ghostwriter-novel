import { describe, expect, it } from "vitest";
import type { Conversation } from "./conversationSchemas";
import { toModelMessages } from "./modelMessages";
import {
  COMPACT_TOOL_HISTORY_CONVERSATION_MAX_CHARS,
  COMPACT_TOOL_HISTORY_TURN_MAX_CHARS,
} from "./compactToolResult";

const timestamp = "2026-06-18T00:00:00.000Z";

function conversationWith(
  overrides: Partial<Conversation>,
): Conversation {
  return {
    agentRuntime: "vercel-ai",
    codexTurnState: { phase: "idle" },
    createdAt: timestamp,
    editProposals: [],
    id: "conversation-1",
    lastOpenedAt: timestamp,
    messages: [],
    conversationCompactions: [],
    plans: [],
    title: "Test conversation",
    toolActivities: [],
    toolResultSummaries: [],
    updatedAt: timestamp,
    workspaceId: "workspace-1",
    ...overrides,
  };
}

describe("toModelMessages", () => {
  it("converts user, assistant, and system messages to model messages", () => {
    const conversation = conversationWith({
      messages: [
        { content: "System instruction", createdAt: timestamp, id: "message-1", role: "system" },
        { content: "Hello", createdAt: timestamp, id: "message-2", role: "user" },
        { content: "Hi", createdAt: timestamp, id: "message-3", role: "assistant" },
      ],
    });

    expect(toModelMessages(conversation)).toEqual([
      { content: "System instruction", role: "system" },
      { content: "Hello", role: "user" },
      { content: "Hi", role: "assistant" },
    ]);
  });

  it("excludes tool messages for the current strategy", () => {
    const conversation = conversationWith({
      messages: [
        { content: "Before", createdAt: timestamp, id: "message-1", role: "user" },
        { content: "Tool output", createdAt: timestamp, id: "message-2", role: "tool" },
        { content: "After", createdAt: timestamp, id: "message-3", role: "assistant" },
      ],
    });

    expect(toModelMessages(conversation, { strategy: "current" })).toEqual([
      { content: "Before", role: "user" },
      { content: "After", role: "assistant" },
    ]);
  });

  it("ignores tool activities, edit proposals, and plans for the current strategy", () => {
    const baseMessages = [
      { content: "Please inspect files", createdAt: timestamp, id: "message-1", role: "user" as const },
      { content: "I will inspect them", createdAt: timestamp, id: "message-2", role: "assistant" as const },
    ];
    const withoutHistory = conversationWith({ messages: baseMessages });
    const withHistory = conversationWith({
      editProposals: [
        {
          createdAt: timestamp,
          diff: "--- file.txt\n+++ file.txt",
          id: "proposal-1",
          newText: "new",
          oldText: "old",
          operation: "edit",
          path: "file.txt",
          status: "pending",
          title: "Edit file.txt",
          updatedAt: timestamp,
        },
      ],
      messages: baseMessages,
      plans: [
        {
          createdAt: timestamp,
          id: "plan-1",
          items: [{ id: "item-1", status: "completed", title: "Inspect files" }],
          updatedAt: timestamp,
        },
      ],
      toolActivities: [
        {
          createdAt: timestamp,
          id: "activity-1",
          label: "Read file.txt",
          status: "completed",
          toolCallId: "tool-call-1",
          toolName: "Read",
        },
      ],
    });

    expect(toModelMessages(withHistory)).toEqual(toModelMessages(withoutHistory));
  });

  it("preserves the original message order after filtering unsupported roles", () => {
    const conversation = conversationWith({
      messages: [
        { content: "First", createdAt: timestamp, id: "message-1", role: "assistant" },
        { content: "Second", createdAt: timestamp, id: "message-2", role: "tool" },
        { content: "Third", createdAt: timestamp, id: "message-3", role: "system" },
        { content: "Fourth", createdAt: timestamp, id: "message-4", role: "user" },
      ],
    });

    expect(toModelMessages(conversation).map((message) => message.content)).toEqual([
      "First",
      "Third",
      "Fourth",
    ]);
  });

  it("appends related compact history to the same assistant message using current proposal status", () => {
    const conversation = conversationWith({
      editProposals: [
        {
          assistantMessageId: "assistant-1",
          createdAt: timestamp,
          diff: "secret diff",
          id: "proposal-1",
          newText: "secret new manuscript",
          oldText: "secret old manuscript",
          operation: "edit",
          path: "manuscript/chapter-01.txt",
          status: "applied",
          title: "Edit chapter",
          updatedAt: timestamp,
        },
      ],
      messages: [
        { content: "Inspect it", createdAt: timestamp, id: "user-1", role: "user" },
        { content: "Inspected.", createdAt: timestamp, id: "assistant-1", role: "assistant" },
      ],
      toolActivities: [
        {
          assistantMessageId: "assistant-1",
          createdAt: timestamp,
          id: "activity-1",
          label: "Read manuscript/chapter-01.txt",
          status: "completed",
          toolCallId: "read-1",
          toolName: "Read",
        },
      ],
      toolResultSummaries: [
        {
          assistantMessageId: "assistant-1",
          createdAt: timestamp,
          summary: "Read manuscript/chapter-01.txt: completed, 8 lines, truncated=false",
          toolCallId: "read-1",
          toolName: "Read",
        },
      ],
    });

    const converted = toModelMessages(conversation, { strategy: "compact-tool-results" });

    expect(converted).toHaveLength(2);
    expect(converted[1]).toEqual({
      content: expect.stringContaining("Inspected.\n\n[圧縮された過去のツール履歴]"),
      role: "assistant",
    });
    const content = String(converted[1]?.content);
    expect(content).toContain("現在のファイル内容を保証しません");
    expect(content).toContain("workspaceを再度Readしてください");
    expect(content).toContain("ツール実行:\n- Read manuscript/chapter-01.txt (completed)");
    expect(content).toContain("ツール結果:\n- Read manuscript/chapter-01.txt: completed, 8 lines, truncated=false");
    expect(content).toContain("編集提案:\n- edit manuscript/chapter-01.txt (applied)");
    expect(content).not.toContain("secret");
    expect(toModelMessages(conversation, { strategy: "compact-tool-results" })).toEqual(converted);
  });

  it("creates one assistant message for an empty assistant turn with history and enforces history budgets", () => {
    const assistantIds = Array.from({ length: 6 }, (_, index) => `assistant-${index}`);
    const conversation = conversationWith({
      messages: assistantIds.map((id) => ({ content: "", createdAt: timestamp, id, role: "assistant" })),
      toolResultSummaries: assistantIds.flatMap((assistantMessageId, turnIndex) =>
        Array.from({ length: 10 }, (_, resultIndex) => ({
          assistantMessageId,
          createdAt: timestamp,
          summary: `PluginTool ${turnIndex}-${resultIndex} ${"x".repeat(500)}`,
          toolCallId: `call-${turnIndex}-${resultIndex}`,
          toolName: "PluginTool",
        })),
      ),
    });

    const converted = toModelMessages(conversation, { strategy: "compact-tool-results" });
    const historyLengths = converted.map((message) => {
      const content = String(message.content);
      const historyStart = content.indexOf("[圧縮された過去のツール履歴]");
      return historyStart === -1 ? 0 : content.length - historyStart;
    });

    expect(converted).toHaveLength(assistantIds.length);
    expect(converted.every((message) => message.role === "assistant" && String(message.content).length > 0)).toBe(true);
    expect(Math.max(...historyLengths)).toBeLessThanOrEqual(COMPACT_TOOL_HISTORY_TURN_MAX_CHARS);
    expect(historyLengths.reduce((sum, length) => sum + length, 0)).toBeLessThanOrEqual(
      COMPACT_TOOL_HISTORY_CONVERSATION_MAX_CHARS,
    );
    expect(converted.map((message) => message.content).join("\n")).toContain("[truncated]");
  });

  it("does not inject legacy summaries without assistantMessageId into the wrong turn", () => {
    const conversation = conversationWith({
      messages: [
        { content: "First turn", createdAt: timestamp, id: "assistant-1", role: "assistant" },
        { content: "Second turn", createdAt: timestamp, id: "assistant-2", role: "assistant" },
      ],
      toolResultSummaries: [
        {
          assistantMessageId: "assistant-1",
          createdAt: timestamp,
          summary: "Read chapter-01.txt: completed, 3 lines, truncated=false",
          toolCallId: "read-1",
          toolName: "Read",
        },
        {
          assistantMessageId: "assistant-orphan",
          createdAt: timestamp,
          summary: "Read orphan.txt: completed, 1 lines, truncated=false",
          toolCallId: "read-orphan",
          toolName: "Read",
        },
      ],
    });

    const converted = toModelMessages(conversation, { strategy: "compact-tool-results" });

    expect(String(converted[0]?.content)).toContain("Read chapter-01.txt");
    expect(String(converted[0]?.content)).not.toContain("orphan.txt");
    expect(String(converted[1]?.content)).toBe("Second turn");
  });

  it("reflects rejected and conflicted proposal status in compact history", () => {
    const conversation = conversationWith({
      editProposals: [
        {
          assistantMessageId: "assistant-1",
          createdAt: timestamp,
          diff: "diff",
          id: "proposal-1",
          newText: "new",
          oldText: "old",
          operation: "edit",
          path: "chapter-a.txt",
          status: "rejected",
          title: "Edit chapter-a.txt",
          updatedAt: timestamp,
        },
        {
          assistantMessageId: "assistant-1",
          createdAt: timestamp,
          diff: "diff",
          id: "proposal-2",
          newText: "new",
          oldText: "old",
          operation: "create",
          path: "chapter-b.txt",
          status: "conflicted",
          title: "Create chapter-b.txt",
          updatedAt: timestamp,
        },
      ],
      messages: [{ content: "Done", createdAt: timestamp, id: "assistant-1", role: "assistant" }],
    });

    const content = String(
      toModelMessages(conversation, { strategy: "compact-tool-results" })[0]?.content,
    );

    expect(content).toContain("edit chapter-a.txt (rejected)");
    expect(content).toContain("create chapter-b.txt (conflicted)");
  });

  it("uses the latest conversation checkpoint plus raw messages after it", () => {
    const conversation = conversationWith({
      conversationCompactions: [
        {
          compactedThroughCreatedAt: "2026-06-18T00:01:00.000Z",
          compactedThroughMessageId: "assistant-1",
          createdAt: "2026-06-18T00:02:00.000Z",
          id: "checkpoint-old",
          sourceMessageIds: ["user-1", "assistant-1"],
          summary: "古い要約。現在のファイル内容は必要に応じてReadする。",
        },
        {
          compactedThroughCreatedAt: "2026-06-18T00:03:00.000Z",
          compactedThroughMessageId: "assistant-2",
          createdAt: "2026-06-18T00:04:00.000Z",
          id: "checkpoint-latest",
          sourceMessageIds: ["user-1", "assistant-1", "user-2", "assistant-2"],
          summary: "最新要約。現在のファイル内容は必要に応じてReadする。",
        },
      ],
      messages: [
        { content: "古い依頼1", createdAt: "2026-06-18T00:00:00.000Z", id: "user-1", role: "user" },
        { content: "古い回答1", createdAt: "2026-06-18T00:01:00.000Z", id: "assistant-1", role: "assistant" },
        { content: "古い依頼2", createdAt: "2026-06-18T00:02:00.000Z", id: "user-2", role: "user" },
        { content: "古い回答2", createdAt: "2026-06-18T00:03:00.000Z", id: "assistant-2", role: "assistant" },
        { content: "新しい依頼", createdAt: "2026-06-18T00:05:00.000Z", id: "user-3", role: "user" },
        { content: "新しい回答", createdAt: "2026-06-18T00:06:00.000Z", id: "assistant-3", role: "assistant" },
      ],
    });

    expect(toModelMessages(conversation, { strategy: "conversation-compaction" })).toEqual([
      {
        content: expect.stringContaining("最新要約。現在のファイル内容は必要に応じてReadする。"),
        role: "system",
      },
      { content: "新しい依頼", role: "user" },
      { content: "新しい回答", role: "assistant" },
    ]);
    expect(JSON.stringify(toModelMessages(conversation, { strategy: "conversation-compaction" }))).not.toContain("古い依頼");
    expect(JSON.stringify(toModelMessages(conversation, { strategy: "conversation-compaction" }))).not.toContain("古い要約");
  });

  it("preserves compact tool history after a conversation checkpoint", () => {
    const conversation = conversationWith({
      conversationCompactions: [
        {
          compactedThroughCreatedAt: timestamp,
          compactedThroughMessageId: "assistant-1",
          createdAt: timestamp,
          id: "checkpoint-1",
          sourceMessageIds: ["user-1", "assistant-1"],
          summary: "これまでの要約。現在のファイル内容は必要に応じてReadする。",
        },
      ],
      messages: [
        { content: "古い依頼", createdAt: timestamp, id: "user-1", role: "user" },
        { content: "古い回答", createdAt: timestamp, id: "assistant-1", role: "assistant" },
        { content: "確認して", createdAt: timestamp, id: "user-2", role: "user" },
        { content: "確認しました。", createdAt: timestamp, id: "assistant-2", role: "assistant" },
      ],
      toolResultSummaries: [
        {
          assistantMessageId: "assistant-2",
          createdAt: timestamp,
          summary: "Read chapter.txt: completed, 8 lines, truncated=false",
          toolCallId: "read-1",
          toolName: "Read",
        },
      ],
    });

    const converted = toModelMessages(conversation, { strategy: "conversation-compaction" });

    expect(String(converted.at(-1)?.content)).toContain("[圧縮された過去のツール履歴]");
    expect(String(converted.at(-1)?.content)).toContain("Read chapter.txt");
  });
});
