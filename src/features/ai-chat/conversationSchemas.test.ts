import { describe, expect, it } from "vitest";
import {
  conversationCompactionSchema,
  conversationSchema,
  editProposalSchema,
} from "./conversationSchemas";

const baseProposal = {
  createdAt: "2026-06-20T00:00:00.000Z",
  diff: "diff",
  id: "proposal-1",
  newText: "new",
  oldText: "old",
  operation: "edit" as const,
  path: "chapter.txt",
  status: "pending" as const,
  title: "Edit chapter.txt",
  updatedAt: "2026-06-20T00:00:00.000Z",
};

describe("editProposalSchema", () => {
  it("records writing provenance on a new proposal", () => {
    expect(editProposalSchema.parse({ ...baseProposal, sourceRole: "writing" })).toMatchObject({
      sourceRole: "writing",
    });
  });

  it("keeps existing conversation proposals without sourceRole compatible", () => {
    expect(editProposalSchema.parse(baseProposal)).not.toHaveProperty("sourceRole");
  });
});

describe("conversationCompactionSchema", () => {
  it("keeps legacy conversations compatible by defaulting compactions to an empty list", () => {
    const parsed = conversationSchema.parse({
      createdAt: "2026-06-20T00:00:00.000Z",
      editProposals: [],
      id: "conversation-1",
      lastOpenedAt: "2026-06-20T00:00:00.000Z",
      messages: [],
      title: "Legacy conversation",
      updatedAt: "2026-06-20T00:00:00.000Z",
      workspaceId: "workspace-1",
    });

    expect(parsed.conversationCompactions).toEqual([]);
  });

  it("stores checkpoint metadata and optional token usage", () => {
    expect(
      conversationCompactionSchema.parse({
        compactedThroughCreatedAt: "2026-06-20T00:02:00.000Z",
        compactedThroughMessageId: "message-2",
        createdAt: "2026-06-20T00:03:00.000Z",
        id: "compaction-1",
        sourceMessageIds: ["message-1", "message-2"],
        summary: "作品状態、ユーザーの希望、決定事項、未解決の作業、最近の編集。現在のファイル内容は必要に応じてReadする。",
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
        },
      }),
    ).toMatchObject({
      compactedThroughMessageId: "message-2",
      sourceMessageIds: ["message-1", "message-2"],
      tokenUsage: {
        totalTokens: 120,
      },
    });
  });
});

describe("conversation runtime schema", () => {
  const legacyConversation = {
    createdAt: "2026-06-20T00:00:00.000Z",
    editProposals: [],
    id: "conversation-1",
    lastOpenedAt: "2026-06-20T00:00:00.000Z",
    messages: [],
    title: "Legacy conversation",
    updatedAt: "2026-06-20T00:00:00.000Z",
    workspaceId: "workspace-1",
  };

  it("defaults legacy conversations to the Vercel AI runtime", () => {
    expect(conversationSchema.parse(legacyConversation)).toMatchObject({
      agentRuntime: "vercel-ai",
    });
  });

  it("stores the Codex runtime and optional App Server thread id", () => {
    expect(
      conversationSchema.parse({
        ...legacyConversation,
        agentRuntime: "codex-app-server",
        codexThreadId: "thread-1",
      }),
    ).toMatchObject({
      agentRuntime: "codex-app-server",
      codexThreadId: "thread-1",
    });
  });

  it("keeps legacy model selection absent and stores a nullable per-conversation selection", () => {
    expect(conversationSchema.parse(legacyConversation)).not.toHaveProperty(
      "selectedCodexModel",
    );
    expect(
      conversationSchema.parse({
        ...legacyConversation,
        agentRuntime: "codex-app-server",
        selectedCodexModel: "gpt-sol",
      }),
    ).toMatchObject({ selectedCodexModel: "gpt-sol" });
    expect(
      conversationSchema.parse({
        ...legacyConversation,
        agentRuntime: "codex-app-server",
        selectedCodexModel: null,
      }),
    ).toMatchObject({ selectedCodexModel: null });
  });

  it("migrates legacy Codex conversations to an idle durable turn state", () => {
    expect(
      conversationSchema.parse({
        ...legacyConversation,
        agentRuntime: "codex-app-server",
        codexThreadId: "thread-1",
      }),
    ).toMatchObject({
      codexTurnState: { phase: "idle" },
    });
  });

  it("stores optional sanitized Codex runtime metadata", () => {
    expect(
      conversationSchema.parse({
        ...legacyConversation,
        agentRuntime: "codex-app-server",
        codexRuntimeMetadata: {
          model: "codex-default",
          modelProvider: "openai",
          protocolVersion: "v2",
          userAgentOrCliVersion: "codex-cli/0.144.1",
        },
      }),
    ).toMatchObject({
      codexRuntimeMetadata: {
        model: "codex-default",
        modelProvider: "openai",
        protocolVersion: "v2",
        userAgentOrCliVersion: "codex-cli/0.144.1",
      },
    });
  });
});
