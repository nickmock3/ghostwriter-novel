import { describe, expect, it } from "vitest";
import type { Conversation } from "./conversationSchemas";
import {
  chatConversationReducer,
  initialChatConversationState,
} from "./useChatConversationState";

const timestamp = "2026-09-25T00:00:00.000Z";
function conversation(
  id: string,
  agentRuntime: Conversation["agentRuntime"] = "vercel-ai",
): Conversation {
  return {
    agentRuntime,
    codexTurnState: { phase: "idle" },
    conversationCompactions: [],
    createdAt: timestamp,
    editProposals: [],
    id,
    lastOpenedAt: timestamp,
    messages: [],
    plans: [],
    title: id,
    toolActivities: [],
    toolResultSummaries: [],
    updatedAt: timestamp,
    workspaceId: "workspace",
  };
}

const empty = chatConversationReducer(initialChatConversationState, {
  type: "historyLoaded",
  activeConversation: conversation("first"),
  conversations: [
    conversation("first"),
    conversation("second", "codex-app-server"),
  ],
  error: null,
});

describe("chat conversation state", () => {
  it("resets running presentation when a different conversation is selected", () => {
    const running = chatConversationReducer(empty, { type: "submitStarted" });
    const selected = chatConversationReducer(running, {
      type: "conversationSelected",
      conversation: conversation("second", "codex-app-server"),
    });
    expect(selected.activeConversation?.id).toBe("second");
    expect(selected.agentRunState).toBe("idle");
    expect(selected.isLoading).toBe(false);
    expect(selected.selectedAgentRuntime).toBe("codex-app-server");
  });

  it("keeps the active conversation when another conversation is deleted", () => {
    const deleting = chatConversationReducer(empty, {
      type: "conversationDeleting",
    });
    const deleted = chatConversationReducer(deleting, {
      type: "conversationDeleted",
      conversationId: "second",
    });
    expect(deleted.activeConversation?.id).toBe("first");
    expect(deleted.conversations.map(({ id }) => id)).toEqual(["first"]);
    expect(deleted.isLoading).toBe(false);
  });
});
