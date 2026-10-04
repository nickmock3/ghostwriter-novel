import { describe, expect, it } from "vitest";
import {
  createWorkspaceOperationGeneration,
  removeConversationFromList,
  upsertConversationInList,
} from "./chatConversationControllerHelpers";
import type { Conversation } from "./conversationSchemas";

function conversation(id: string, title = id): Conversation {
  return {
    agentRuntime: "vercel-ai",
    codexTurnState: { phase: "idle" },
    conversationCompactions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    editProposals: [],
    id,
    lastOpenedAt: "2026-01-01T00:00:00.000Z",
    messages: [],
    plans: [],
    title,
    toolActivities: [],
    toolResultSummaries: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    workspaceId: "workspace-1",
  };
}

describe("chatConversationControllerHelpers", () => {
  it("marks workspace operations stale after bump", () => {
    const generation = createWorkspaceOperationGeneration();
    const started = generation.begin();
    expect(generation.isStale(started)).toBe(false);

    generation.bump();
    expect(generation.isStale(started)).toBe(true);
    expect(generation.isStale(generation.begin())).toBe(false);
  });

  it("upserts a conversation to the front of the list", () => {
    const first = conversation("c1", "one");
    const second = conversation("c2", "two");
    const updatedFirst = conversation("c1", "one-updated");

    expect(upsertConversationInList([first, second], updatedFirst)).toEqual([
      updatedFirst,
      second,
    ]);
  });

  it("removes a conversation by id", () => {
    const first = conversation("c1");
    const second = conversation("c2");
    expect(removeConversationFromList([first, second], "c1")).toEqual([second]);
  });
});
