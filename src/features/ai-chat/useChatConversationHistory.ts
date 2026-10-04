import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  createNewConversation,
  deleteConversation,
  fetchConversations,
  touchConversation,
} from "./chatConversationClient";
import type { WorkspaceOperationGeneration } from "./chatConversationControllerHelpers";
import type { ChatConversationDispatch } from "./useChatConversationState";
import type { Conversation } from "./conversationSchemas";

type UseChatConversationHistoryParams = {
  activeConversation: Conversation | null;
  agentRunState: "idle" | "running" | "failed";
  clearActiveConversationPresentationState: () => void;
  clearDroppedTextFiles: () => void;
  clearStreamPresentationState: () => void;
  compactionState: "idle" | "running";
  operation: WorkspaceOperationGeneration;
  selectedAgentRuntime: Conversation["agentRuntime"];
  dispatch: ChatConversationDispatch;
  workspaceRoot: string | null;
};

export function useChatConversationHistory({
  activeConversation,
  agentRunState,
  clearActiveConversationPresentationState,
  clearDroppedTextFiles,
  clearStreamPresentationState,
  compactionState,
  operation,
  selectedAgentRuntime,
  dispatch,
  workspaceRoot,
}: UseChatConversationHistoryParams) {
  const [deletingConversationId, setDeletingConversationId] = useState<
    string | null
  >(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const historyDialogRef = useRef<HTMLDivElement | null>(null);
  const historyTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    operation.bump();
    const operationGeneration = operation.begin();
    let cancelled = false;
    dispatch({ type: "workspaceChanged" });
    clearStreamPresentationState();
    clearDroppedTextFiles();
    setDeletingConversationId(null);
    setIsHistoryOpen(false);

    if (!workspaceRoot) {
      return;
    }

    dispatch({ type: "historyLoading" });
    fetchConversations(workspaceRoot)
      .then((result) => {
        if (cancelled || operation.isStale(operationGeneration)) {
          return;
        }
        dispatch({
          type: "historyLoaded",
          activeConversation: result.activeConversation,
          conversations: result.conversations,
          error:
            result.errors.length > 0
              ? `読み込めない履歴があります: ${result.errors.map((item) => item.fileName).join(", ")}`
              : null,
        });
      })
      .catch((nextError: unknown) => {
        if (!cancelled && !operation.isStale(operationGeneration)) {
          dispatch({
            type: "historyFailed",
            error:
              nextError instanceof Error
                ? nextError.message
                : "会話履歴の読み込みに失敗しました。",
          });
        }
      })
      .finally(() => {
        if (!cancelled && !operation.isStale(operationGeneration)) {
          dispatch({ type: "operationFinished" });
        }
      });

    return () => {
      cancelled = true;
    };
    // Workspace switch is the only intentional trigger; handlers are stable enough for this controller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRoot]);

  useEffect(() => {
    if (!isHistoryOpen) {
      return;
    }

    historyDialogRef.current?.focus();
  }, [isHistoryOpen]);

  async function handleCreateConversation(
    runtime: Conversation["agentRuntime"] = selectedAgentRuntime,
  ) {
    if (!workspaceRoot) {
      return;
    }
    const operationGeneration = operation.bump();
    dispatch({ type: "conversationCreating" });
    clearDroppedTextFiles();
    clearStreamPresentationState();
    try {
      const conversation = await createNewConversation(workspaceRoot, runtime);
      if (operation.isStale(operationGeneration)) {
        return;
      }
      dispatch({ type: "conversationCreated", conversation });
      return conversation;
    } catch (nextError) {
      if (!operation.isStale(operationGeneration)) {
        dispatch({
          type: "operationFailed",
          error:
            nextError instanceof Error
              ? nextError.message
              : "新規会話の作成に失敗しました。",
        });
      }
    } finally {
      if (!operation.isStale(operationGeneration)) {
        dispatch({ type: "operationFinished" });
      }
    }
  }

  async function handleAgentRuntimeChange(
    runtime: Conversation["agentRuntime"],
  ) {
    if (runtime === selectedAgentRuntime) {
      return;
    }
    await handleCreateConversation(runtime);
  }

  function closeHistoryDialog(options?: { restoreFocus?: boolean }) {
    setIsHistoryOpen(false);
    if (options?.restoreFocus !== false) {
      window.setTimeout(() => historyTriggerRef.current?.focus(), 0);
    }
  }

  function handleHistoryDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeHistoryDialog();
    }
  }

  function handleSelectConversation(conversation: Conversation) {
    operation.bump();
    clearStreamPresentationState();
    clearDroppedTextFiles();
    dispatch({ type: "conversationSelected", conversation });
    setDeletingConversationId(null);
    closeHistoryDialog({ restoreFocus: false });
    if (workspaceRoot) {
      void touchConversation(workspaceRoot, conversation.id);
    }
  }

  function isConversationDeleteDisabled(conversation: Conversation): boolean {
    const isCodexTurnActive = conversation.codexTurnState.phase !== "idle";
    if (conversation.id !== activeConversation?.id) {
      return isCodexTurnActive;
    }

    return (
      isCodexTurnActive ||
      agentRunState === "running" ||
      compactionState === "running"
    );
  }

  async function handleDeleteConversation(conversation: Conversation) {
    if (
      !workspaceRoot ||
      deletingConversationId !== null ||
      isConversationDeleteDisabled(conversation)
    ) {
      return;
    }

    if (!window.confirm(`「${conversation.title}」を削除しますか？`)) {
      return;
    }

    const operationGeneration =
      activeConversation?.id === conversation.id
        ? operation.bump()
        : operation.begin();
    dispatch({ type: "conversationDeleting" });
    setDeletingConversationId(conversation.id);
    try {
      await deleteConversation(workspaceRoot, conversation.id);
      if (operation.isStale(operationGeneration)) {
        return;
      }

      if (activeConversation?.id === conversation.id) {
        clearActiveConversationPresentationState();
        clearDroppedTextFiles();
      }
      dispatch({
        type: "conversationDeleted",
        conversationId: conversation.id,
      });
    } catch {
      if (!operation.isStale(operationGeneration)) {
        dispatch({
          type: "operationFailed",
          error: "会話の削除に失敗しました。",
        });
      }
    } finally {
      if (!operation.isStale(operationGeneration)) {
        setDeletingConversationId(null);
        dispatch({ type: "operationFinished" });
      }
    }
  }

  return {
    closeHistoryDialog,
    deletingConversationId,
    handleAgentRuntimeChange,
    handleCreateConversation,
    handleDeleteConversation,
    handleHistoryDialogKeyDown,
    handleSelectConversation,
    historyDialogRef,
    historyTriggerRef,
    isConversationDeleteDisabled,
    isHistoryOpen,
    setIsHistoryOpen,
  };
}
