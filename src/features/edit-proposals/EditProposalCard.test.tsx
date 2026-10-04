import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EditProposal } from "./editProposalSchemas";
import { EditProposalCard } from "./EditProposalCard";

function renderProposal(
  proposal: EditProposal,
  options?: {
    canApply?: boolean;
    canUndo?: boolean;
    isTargetDirty?: boolean;
    mode?: "chat" | "editor";
    onOpenPath?: (path: string) => void;
  },
) {
  const onApply = vi.fn();
  const onReject = vi.fn();
  const onUndo = vi.fn();
  render(
    <EditProposalCard
      canApply={options?.canApply ?? true}
      canUndo={options?.canUndo ?? false}
      isTargetDirty={options?.isTargetDirty ?? false}
      mode={options?.mode}
      onApply={onApply}
      onOpenPath={options?.onOpenPath}
      onReject={onReject}
      onUndo={onUndo}
      proposal={proposal}
    />,
  );
  return { onApply, onReject, onUndo };
}

describe("EditProposalCard", () => {
  it("renders structured headers and inline diffs from oldText and newText", async () => {
    const onOpenPath = vi.fn();
    renderProposal(
      {
        assistantMessageId: "assistant-1",
        createdAt: "2026-05-09T00:00:00.000Z",
        diff: "--- misleading.md\n+++ misleading.md\n@@\n-this raw diff should not render",
        id: "proposal-1",
        newText: "朝の庭で、少女は明るい声で笑った。",
        oldText: "朝の庭で、少女は静かな声で笑った。",
        operation: "edit",
        path: "chapters/001.txt",
        status: "pending",
        title: "Edit chapters/001.txt",
        updatedAt: "2026-05-09T00:00:00.000Z",
      },
      { onOpenPath },
    );

    const proposal = await screen.findByRole("group", { name: "編集案 chapters/001.txt" });
    expect(within(proposal).getByRole("button", { name: "chapters/001.txt を開く" })).toBeInTheDocument();
    expect(proposal).toHaveTextContent("Edit");
    expect(proposal).toHaveTextContent("+1");
    expect(proposal).toHaveTextContent("−1");
    expect(proposal).not.toHaveTextContent("--- misleading.md");
    expect(proposal.querySelector(".edit-proposal-inline-diff")).toBeInTheDocument();
    expect(proposal.querySelector(".diff-token-delete")).toHaveTextContent("静かな");
    expect(proposal.querySelector(".diff-token-insert")).toHaveTextContent("明るい");

    fireEvent.click(within(proposal).getByRole("button", { name: "chapters/001.txt を開く" }));
    expect(onOpenPath).toHaveBeenCalledWith("chapters/001.txt");
  });

  it("switches diffs between inline and line views", async () => {
    renderProposal({
      createdAt: "2026-05-09T00:00:00.000Z",
      diff: "--- note.txt\n+++ note.txt\n@@\n-old line\n+new line",
      id: "proposal-1",
      newText: "keep\nnew line\n",
      oldText: "keep\nold line\n",
      operation: "edit",
      path: "note.txt",
      status: "pending",
      title: "Edit note.txt",
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    const proposal = await screen.findByRole("group", { name: "編集案 note.txt" });
    expect(proposal.querySelector(".edit-proposal-inline-diff")).toBeInTheDocument();

    fireEvent.click(within(proposal).getByRole("button", { name: "Line" }));

    expect(proposal.querySelector(".edit-proposal-line-diff")).toBeInTheDocument();
    expect(proposal.querySelector(".line-diff-row.is-delete .line-diff-gutter")).toHaveTextContent("−");
    expect(proposal.querySelector(".line-diff-row.is-insert .line-diff-gutter")).toHaveTextContent("+");
    expect(proposal.querySelector(".line-diff-row.is-delete")).toHaveTextContent("old line");
    expect(proposal.querySelector(".line-diff-row.is-insert")).toHaveTextContent("new line");
  });

  it("omits long unchanged context while keeping distant changes visible", async () => {
    const oldText = Array.from({ length: 18 }, (_, index) => `unchanged old ${index}`).join("\n");
    const newText = `${oldText}\nfinal added line`;
    renderProposal({
      createdAt: "2026-05-09T00:00:00.000Z",
      diff: "legacy diff",
      id: "proposal-1",
      newText,
      oldText,
      operation: "edit",
      path: "long.txt",
      status: "pending",
      title: "Edit long.txt",
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    const proposal = await screen.findByRole("group", { name: "編集案 long.txt" });
    expect(proposal).toHaveTextContent("final added line");
    expect(proposal).not.toHaveTextContent("unchanged old 0");
    expect(within(proposal).getByText(/省略/)).toBeInTheDocument();

    fireEvent.click(within(proposal).getByRole("button", { name: "すべて表示" }));

    expect(proposal).toHaveTextContent("unchanged old 0");
    expect(proposal).toHaveTextContent("final added line");
  });

  it("blocks apply for dirty editor files and prompts the user to save or discard", async () => {
    renderProposal(
      {
        createdAt: "2026-05-09T00:00:00.000Z",
        diff: "--- note.txt\n+++ note.txt\n@@\n-old\n+new",
        id: "proposal-1",
        newText: "new",
        oldText: "old",
        operation: "edit",
        path: "note.txt",
        status: "pending",
        title: "Edit note.txt",
        updatedAt: "2026-05-09T00:00:00.000Z",
      },
      { canApply: false, isTargetDirty: true },
    );

    expect(await screen.findByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.getByText("保存または破棄してからApplyしてください。")).toBeInTheDocument();
  });

  it("shows directory create proposals without diff controls", async () => {
    renderProposal({
      createdAt: "2026-05-09T00:00:00.000Z",
      diff: "--- /dev/null\n+++ docs/\n@@\n+directory: docs",
      id: "proposal-1",
      newText: "",
      oldText: "",
      operation: "createDirectory",
      path: "docs",
      status: "pending",
      title: "Create directory docs",
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    const proposal = await screen.findByRole("group", { name: "編集案 docs" });
    expect(proposal).toHaveTextContent("CreateDirectory");
    expect(proposal).toHaveTextContent("作成予定: docs");
    expect(proposal.querySelector(".edit-proposal-inline-diff")).toBeNull();
  });

  it("collapses diff body after the proposal is applied", async () => {
    renderProposal({
      assistantMessageId: "assistant-1",
      createdAt: "2026-05-09T00:00:00.000Z",
      diff: "--- note.txt\n+++ note.txt\n@@\n-old\n+new",
      id: "proposal-1",
      newText: "new",
      oldText: "old",
      operation: "edit",
      path: "note.txt",
      status: "applied",
      title: "Edit note.txt",
      updatedAt: "2026-05-09T00:00:01.000Z",
    });

    expect(screen.getByText("applied")).toBeInTheDocument();
    expect(screen.queryByText("old")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "変更点" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("keeps applied diffs collapsed and exposes undo", async () => {
    const { onUndo } = renderProposal(
      {
        assistantMessageId: "assistant-1",
        createdAt: "2026-05-09T00:00:00.000Z",
        diff: "--- note.txt\n+++ note.txt\n@@\n-old\n+new",
        id: "proposal-1",
        newText: "new",
        oldText: "old",
        operation: "edit",
        path: "note.txt",
        status: "applied",
        title: "Edit note.txt",
        undoSnapshot: {
          afterContent: "new",
          beforeContent: "old",
        },
        updatedAt: "2026-05-09T00:00:00.000Z",
      },
      { canUndo: true, mode: "chat" },
    );

    expect(screen.getByText("Edit note.txt")).toBeInTheDocument();
    expect(screen.queryByText("old")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "変更点" }));

    expect(screen.getByText("old")).toHaveClass("diff-token-delete");
    expect(screen.getByRole("button", { name: "閉じる" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalled();
  });
});
