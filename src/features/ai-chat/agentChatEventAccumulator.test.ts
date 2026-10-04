import { describe, expect, it } from "vitest";
import {
  createAgentChatEventAccumulator,
  type AgentChatEventAccumulatorProfile,
} from "./agentChatEventAccumulator";

const mainProfile: AgentChatEventAccumulatorProfile = {
  contextWindowTokens: 128_000,
  id: "builtin:deepseek:main",
  llmProfileRole: "main",
  modelId: "deepseek-chat",
  providerId: "deepseek",
};

describe("agent chat event accumulator", () => {
  it("streams reasoning without adding it to the persistable answer or tool history", () => {
    const accumulator = createAgentChatEventAccumulator({ mainProfile });
    const event = { type: "reasoning-delta", text: "途中の検討" } as const;
    expect(accumulator.consume(event)).toEqual([event]);
    accumulator.consume({ type: "text-delta", text: "回答です" });
    expect(accumulator.result().assistantContent).toBe("回答です");
    expect(JSON.stringify(accumulator.result())).not.toContain("途中の検討");
  });
  it("reduces a mixed agent event sequence into stream effects and a persistable run result", () => {
    const accumulator = createAgentChatEventAccumulator({
      createId: (() => {
        let index = 0;
        return () => `generated-${++index}`;
      })(),
      mainProfile,
      now: () => "2026-07-11T00:00:00.000Z",
    });

    const effects = [
      ...accumulator.consume({
        input: { path: "chapter.txt" },
        toolCallId: "read-1",
        toolName: "Read",
        type: "tool-call",
      }),
      ...accumulator.consume({
        output: { content: "raw manuscript must not be persisted", path: "chapter.txt", totalLines: 3 },
        toolCallId: "read-1",
        toolName: "Read",
        type: "tool-result",
      }),
      ...accumulator.consume({
        output: { message: "tool failed", status: "error" },
        toolCallId: "grep-1",
        toolName: "Grep",
        type: "tool-result",
      }),
      ...accumulator.consume({
        input: { items: [{ id: "ignored", status: "in_progress", title: "ignored" }] },
        toolCallId: "plan-1",
        toolName: "UpdatePlan",
        type: "tool-call",
      }),
      ...accumulator.consume({
        output: { items: [{ id: "inspect", status: "completed", title: "Inspect" }] },
        toolCallId: "plan-1",
        toolName: "UpdatePlan",
        type: "tool-result",
      }),
      ...accumulator.consume({
        output: {
          diff: "--- chapter.txt\n+++ chapter.txt\n@@\n-old\n+new",
          newText: "new",
          oldText: "old",
          path: "chapter.txt",
          title: "Edit chapter.txt",
        },
        toolCallId: "edit-1",
        toolName: "Edit",
        type: "tool-result",
      }),
      ...accumulator.consume({
        output: {
          diff: "--- /dev/null\n+++ notes.md\n@@\n+new",
          newText: "new",
          oldText: "",
          operation: "create",
          path: "notes.md",
          title: "Create notes.md",
        },
        toolCallId: "create-1",
        toolName: "Create",
        type: "tool-result",
      }),
      ...accumulator.consume({
        output: {
          diff: "--- /dev/null\n+++ notes/\n@@\n+directory: notes",
          newText: "",
          oldText: "",
          operation: "createDirectory",
          path: "notes",
          title: "Create directory notes",
        },
        toolCallId: "directory-1",
        toolName: "CreateDirectory",
        type: "tool-result",
      }),
      ...accumulator.consume({
        output: {
          diff: "--- chapter.txt\n+++ chapter.txt\n@@\n-old\n+newer",
          newText: "newer",
          oldText: "old",
          operation: "edit",
          path: "chapter.txt",
          sourceRole: "writing",
          title: "Write chapter.txt",
        },
        toolCallId: "writing-1",
        toolName: "CreateWritingEditProposal",
        type: "tool-result",
      }),
      ...accumulator.consume({
        output: {
          diff: "--- /dev/null\n+++ imported.txt\n@@\n+imported",
          newText: "imported",
          oldText: "",
          operation: "create",
          path: "imported.txt",
          status: "applied",
          title: "Create imported.txt",
          undoSnapshot: {
            afterContent: "imported",
            beforeContent: "",
          },
        },
        toolCallId: "place-1",
        toolName: "PlaceDroppedTextFile",
        type: "tool-result",
      }),
      ...accumulator.consume({ text: "回答", type: "text-delta" }),
      ...accumulator.consume({ text: "です。", type: "text-delta" }),
      ...accumulator.consume({
        finishReason: "tool-calls",
        type: "finish-step",
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      }),
      ...accumulator.consume({
        finishReason: "stop",
        type: "finish-step",
        usage: { inputTokens: 20, outputTokens: 3, totalTokens: 23 },
      }),
      ...accumulator.consume({
        finishReason: "length",
        totalUsage: { inputTokens: 30, outputTokens: 4, totalTokens: 34 },
        type: "finish",
      }),
    ];

    expect(effects).toEqual([
      expect.objectContaining({ activity: expect.objectContaining({ status: "running", toolCallId: "read-1" }), type: "tool-activity" }),
      expect.objectContaining({ activity: expect.objectContaining({ status: "completed", toolCallId: "read-1" }), type: "tool-activity" }),
      expect.objectContaining({ activity: expect.objectContaining({ status: "failed", toolCallId: "grep-1" }), type: "tool-activity" }),
      { plan: { items: [{ id: "inspect", status: "completed", title: "Inspect" }] }, type: "plan-update" },
      expect.objectContaining({ activity: expect.objectContaining({ toolCallId: "edit-1" }), type: "tool-activity" }),
      expect.objectContaining({ activity: expect.objectContaining({ toolCallId: "create-1" }), type: "tool-activity" }),
      expect.objectContaining({ activity: expect.objectContaining({ toolCallId: "directory-1" }), type: "tool-activity" }),
      expect.objectContaining({ activity: expect.objectContaining({ toolCallId: "writing-1" }), type: "tool-activity" }),
      expect.objectContaining({ activity: expect.objectContaining({ toolCallId: "place-1" }), type: "tool-activity" }),
      { text: "回答", type: "text-delta" },
      { text: "です。", type: "text-delta" },
    ]);

    expect(accumulator.result()).toMatchObject({
      assistantContent: "回答です。",
      currentPlanItems: [{ id: "inspect", status: "completed", title: "Inspect" }],
      failedToolResultCount: 1,
      finishReason: "length",
      mainContextSnapshot: {
        contextWindowTokens: 128_000,
        inputTokens: 20,
        llmProfileRole: "main",
        modelId: "deepseek-chat",
        providerId: "deepseek",
      },
      tokenUsage: {
        inputTokens: 30,
        llmProfileId: "builtin:deepseek:main",
        llmProfileRole: "main",
        modelId: "deepseek-chat",
        outputTokens: 4,
        providerId: "deepseek",
        totalTokens: 34,
      },
    });
    expect(accumulator.result().editProposals).toEqual([
      expect.objectContaining({ id: "edit-1", operation: "edit", path: "chapter.txt", status: "pending" }),
      expect.objectContaining({ id: "create-1", operation: "create", path: "notes.md", status: "pending" }),
      expect.objectContaining({ id: "directory-1", operation: "createDirectory", path: "notes", status: "pending" }),
      expect.objectContaining({ id: "writing-1", operation: "edit", path: "chapter.txt", sourceRole: "writing", status: "pending" }),
      expect.objectContaining({ id: "place-1", operation: "create", path: "imported.txt", status: "applied" }),
    ]);
    expect(accumulator.result().toolActivities).toEqual([
      expect.objectContaining({ status: "completed", toolCallId: "read-1" }),
      expect.objectContaining({ status: "failed", toolCallId: "grep-1" }),
      expect.objectContaining({ toolCallId: "edit-1" }),
      expect.objectContaining({ toolCallId: "create-1" }),
      expect.objectContaining({ toolCallId: "directory-1" }),
      expect.objectContaining({ toolCallId: "writing-1" }),
      expect.objectContaining({ toolCallId: "place-1" }),
    ]);
    expect(accumulator.result().toolResultSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ summary: "Read chapter.txt: completed, 3 lines, truncated=false", toolCallId: "read-1" }),
      expect.objectContaining({ summary: "Grep: failed, tool failed", toolCallId: "grep-1" }),
    ]));
    expect(accumulator.result().toolResultSummaries).toHaveLength(7);
    expect(JSON.stringify(accumulator.result())).not.toContain("raw manuscript must not be persisted");
  });
});
