import { describe, expect, it } from "vitest";
import { latestUndoableProposalId } from "./editProposalUndo";
import type { EditProposal } from "./conversationSchemas";

function proposal(
  id: string,
  options: Partial<EditProposal> = {},
): EditProposal {
  return {
    id,
    createdAt: "2026-01-01T00:00:00.000Z",
    diff: "",
    newText: "after",
    oldText: "before",
    operation: "edit",
    path: "小説/第001章/本文.md",
    status: "applied",
    title: "summary",
    undoSnapshot: {
      afterContent: "after",
      beforeContent: "before",
    },
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...options,
  };
}

describe("latestUndoableProposalId", () => {
  it("returns the newest applied proposal that has an undo snapshot", () => {
    expect(
      latestUndoableProposalId([
        proposal("older", { updatedAt: "2026-01-01T00:00:00.000Z" }),
        proposal("pending", { status: "pending", undoSnapshot: undefined }),
        proposal("newer", { updatedAt: "2026-01-02T00:00:00.000Z" }),
        proposal("applied-without-snapshot", {
          status: "applied",
          undoSnapshot: undefined,
          updatedAt: "2026-01-03T00:00:00.000Z",
        }),
      ]),
    ).toBe("newer");
  });

  it("returns undefined when no undoable proposal exists", () => {
    expect(
      latestUndoableProposalId([
        proposal("pending", { status: "pending", undoSnapshot: undefined }),
      ]),
    ).toBeUndefined();
  });
});
