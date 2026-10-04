import { createRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationHistoryDialog } from "./ConversationHistoryDialog";

describe("ConversationHistoryDialog", () => {
  it("shows an empty state", () => {
    const dialogRef = createRef<HTMLDivElement>();
    render(
      <ConversationHistoryDialog
        activeConversationId={undefined}
        conversations={[]}
        deletingConversationId={null}
        dialogRef={dialogRef}
        isDeleteDisabled={() => false}
        isOpen
        onClose={vi.fn()}
        onDeleteConversation={vi.fn()}
        onKeyDown={vi.fn()}
        onSelectConversation={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "会話履歴" })).toBeInTheDocument();
    expect(screen.getByText("会話履歴はありません。")).toBeInTheDocument();
  });

  it("selects a conversation from the list", () => {
    const onSelectConversation = vi.fn();
    const dialogRef = createRef<HTMLDivElement>();
    const conversation = {
      agentRuntime: "vercel-ai" as const,
      codexTurnState: { phase: "idle" as const },
      conversationCompactions: [],
      createdAt: "2026-05-09T00:00:00.000Z",
      editProposals: [],
      id: "conv-2",
      lastOpenedAt: "2026-05-09T00:02:00.000Z",
      messages: [],
      plans: [],
      title: "会話 2",
      toolActivities: [],
      toolResultSummaries: [],
      updatedAt: "2026-05-09T00:02:00.000Z",
      workspaceId: "workspace",
    };
    render(
      <ConversationHistoryDialog
        activeConversationId="conv-1"
        conversations={[
          {
            agentRuntime: "vercel-ai",
            codexTurnState: { phase: "idle" },
            conversationCompactions: [],
            createdAt: "2026-05-09T00:00:00.000Z",
            editProposals: [],
            id: "conv-1",
            lastOpenedAt: "2026-05-09T00:00:00.000Z",
            messages: [],
            plans: [],
            title: "会話 1",
            toolActivities: [],
            toolResultSummaries: [],
            updatedAt: "2026-05-09T00:00:00.000Z",
            workspaceId: "workspace",
          },
          conversation,
        ]}
        deletingConversationId={null}
        dialogRef={dialogRef}
        isDeleteDisabled={() => false}
        isOpen
        onClose={vi.fn()}
        onDeleteConversation={vi.fn()}
        onKeyDown={vi.fn()}
        onSelectConversation={onSelectConversation}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "会話 2" }));
    expect(onSelectConversation).toHaveBeenCalledWith(conversation);
  });

  it("closes with Escape", async () => {
    const onClose = vi.fn();
    const dialogRef = createRef<HTMLDivElement>();
    render(
      <ConversationHistoryDialog
        activeConversationId={undefined}
        conversations={[]}
        deletingConversationId={null}
        dialogRef={dialogRef}
        isDeleteDisabled={() => false}
        isOpen
        onClose={onClose}
        onDeleteConversation={vi.fn()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        onSelectConversation={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "会話履歴" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("does not render when closed", () => {
    const dialogRef = createRef<HTMLDivElement>();
    render(
      <ConversationHistoryDialog
        activeConversationId={undefined}
        conversations={[]}
        deletingConversationId={null}
        dialogRef={dialogRef}
        isDeleteDisabled={() => false}
        isOpen={false}
        onClose={vi.fn()}
        onDeleteConversation={vi.fn()}
        onKeyDown={vi.fn()}
        onSelectConversation={vi.fn()}
      />,
    );

    expect(screen.queryByRole("dialog", { name: "会話履歴" })).not.toBeInTheDocument();
  });

  it("exposes a separate delete action without selecting the conversation", () => {
    const onDeleteConversation = vi.fn();
    const onSelectConversation = vi.fn();
    const dialogRef = createRef<HTMLDivElement>();
    const conversation = {
      agentRuntime: "vercel-ai" as const,
      codexTurnState: { phase: "idle" as const },
      conversationCompactions: [],
      createdAt: "2026-05-09T00:00:00.000Z",
      editProposals: [],
      id: "conv-2",
      lastOpenedAt: "2026-05-09T00:02:00.000Z",
      messages: [],
      plans: [],
      title: "会話 2",
      toolActivities: [],
      toolResultSummaries: [],
      updatedAt: "2026-05-09T00:02:00.000Z",
      workspaceId: "workspace",
    };

    render(
      <ConversationHistoryDialog
        activeConversationId="conv-1"
        conversations={[conversation]}
        deletingConversationId={null}
        dialogRef={dialogRef}
        isDeleteDisabled={() => false}
        isOpen
        onClose={vi.fn()}
        onDeleteConversation={onDeleteConversation}
        onKeyDown={vi.fn()}
        onSelectConversation={onSelectConversation}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "会話 2 を削除" }));

    expect(onDeleteConversation).toHaveBeenCalledWith(conversation);
    expect(onSelectConversation).not.toHaveBeenCalled();
  });

  it("disables deletion for a running or deleting conversation", () => {
    const dialogRef = createRef<HTMLDivElement>();
    const conversation = {
      agentRuntime: "codex-app-server" as const,
      codexTurnState: { phase: "accepted" as const, turnId: "turn-1" },
      conversationCompactions: [],
      createdAt: "2026-05-09T00:00:00.000Z",
      editProposals: [],
      id: "conv-running",
      lastOpenedAt: "2026-05-09T00:02:00.000Z",
      messages: [],
      plans: [],
      title: "実行中の会話",
      toolActivities: [],
      toolResultSummaries: [],
      updatedAt: "2026-05-09T00:02:00.000Z",
      workspaceId: "workspace",
    };

    const { rerender } = render(
      <ConversationHistoryDialog
        activeConversationId="conv-running"
        conversations={[conversation]}
        deletingConversationId={null}
        dialogRef={dialogRef}
        isDeleteDisabled={() => true}
        isOpen
        onClose={vi.fn()}
        onDeleteConversation={vi.fn()}
        onKeyDown={vi.fn()}
        onSelectConversation={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "実行中の会話 を削除" })).toBeDisabled();

    rerender(
      <ConversationHistoryDialog
        activeConversationId="conv-running"
        conversations={[conversation]}
        deletingConversationId="conv-running"
        dialogRef={dialogRef}
        isDeleteDisabled={() => false}
        isOpen
        onClose={vi.fn()}
        onDeleteConversation={vi.fn()}
        onKeyDown={vi.fn()}
        onSelectConversation={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "実行中の会話 を削除中" })).toBeDisabled();
  });
});
