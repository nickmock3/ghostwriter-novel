import { describe, expect, it } from "vitest";
import {
  editProposalsForMessage,
  lastAssistantMessageId,
  orphanEditProposals,
  plansForMessage,
  toolActivitiesForMessage,
} from "./chatMessageAssociations";
import type { AgentPlan, Conversation, EditProposal } from "./conversationSchemas";
import type { ToolActivitySummary } from "./toolActivity";

function message(
  id: string,
  role: Conversation["messages"][number]["role"],
): Conversation["messages"][number] {
  return {
    content: `${role}:${id}`,
    id,
    role,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function proposal(
  id: string,
  assistantMessageId?: string,
): EditProposal {
  return {
    id,
    assistantMessageId,
    createdAt: "2026-01-01T00:00:00.000Z",
    diff: "",
    newText: "after",
    oldText: "before",
    operation: "edit",
    path: "小説/第001章/本文.md",
    status: "pending",
    title: "summary",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function plan(id: string, assistantMessageId?: string): AgentPlan {
  return {
    id,
    assistantMessageId,
    createdAt: "2026-01-01T00:00:00.000Z",
    items: [{ id: `${id}-item`, status: "pending", title: "step" }],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("chatMessageAssociations", () => {
  it("returns the last assistant message id", () => {
    expect(
      lastAssistantMessageId([
        message("u1", "user"),
        message("a1", "assistant"),
        message("u2", "user"),
        message("a2", "assistant"),
      ]),
    ).toBe("a2");
  });

  it("filters tool activities by explicit assistant message id", () => {
    const messages = [message("a1", "assistant"), message("a2", "assistant")];
    const activities: ToolActivitySummary[] = [
      {
        assistantMessageId: "a1",
        label: "Read",
        status: "completed",
        toolCallId: "t1",
        toolName: "Read",
      },
      {
        assistantMessageId: "a2",
        label: "Grep",
        status: "completed",
        toolCallId: "t2",
        toolName: "Grep",
      },
    ];

    expect(toolActivitiesForMessage(activities, messages, "a1")).toEqual([activities[0]]);
  });

  it("falls back unlinked items to the last assistant message only", () => {
    const messages = [message("a1", "assistant"), message("a2", "assistant")];
    const proposals = [proposal("p-linked", "a1"), proposal("p-orphan")];
    const plans = [plan("plan-linked", "a1"), plan("plan-orphan")];

    expect(editProposalsForMessage(proposals, messages, "a1")).toEqual([proposals[0]]);
    expect(editProposalsForMessage(proposals, messages, "a2")).toEqual([proposals[1]]);
    expect(plansForMessage(plans, messages, "a1")).toEqual([plans[0]]);
    expect(plansForMessage(plans, messages, "a2")).toEqual([plans[1]]);
  });

  it("exposes orphan edit proposals only when no assistant message exists", () => {
    const proposals = [proposal("p1")];
    expect(orphanEditProposals(proposals, [message("u1", "user")])).toEqual(proposals);
    expect(orphanEditProposals(proposals, [message("a1", "assistant")])).toEqual([]);
  });
});
