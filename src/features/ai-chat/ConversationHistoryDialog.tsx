import { FaCircleNotch, FaTimes, FaTrash } from "react-icons/fa";
import type { KeyboardEvent, RefObject } from "react";
import type { Conversation } from "./conversationSchemas";

export type ConversationHistoryDialogProps = {
  activeConversationId: string | undefined;
  conversations: Conversation[];
  deletingConversationId: string | null;
  dialogRef: RefObject<HTMLDivElement | null>;
  isDeleteDisabled: (conversation: Conversation) => boolean;
  isOpen: boolean;
  onClose: () => void;
  onDeleteConversation: (conversation: Conversation) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onSelectConversation: (conversation: Conversation) => void;
};

export function ConversationHistoryDialog({
  activeConversationId,
  conversations,
  deletingConversationId,
  dialogRef,
  isDeleteDisabled,
  isOpen,
  onClose,
  onDeleteConversation,
  onKeyDown,
  onSelectConversation,
}: ConversationHistoryDialogProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="conversation-history-backdrop" onMouseDown={onClose}>
      <div
        aria-label="会話履歴"
        aria-modal="true"
        className="conversation-history-dialog"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="conversation-history-heading">
          <h3>会話履歴</h3>
          <button
            aria-label="会話履歴を閉じる"
            className="icon-action"
            onClick={onClose}
            type="button"
          >
            <FaTimes aria-hidden="true" />
          </button>
        </div>
        <div className="conversation-history-list">
          {conversations.length > 0 ? (
            conversations.map((conversation) => {
              const isDeleting = conversation.id === deletingConversationId;
              const isRunning = isDeleteDisabled(conversation);
              const isInteractionDisabled = deletingConversationId !== null;

              return (
                <div
                  aria-current={conversation.id === activeConversationId ? "true" : undefined}
                  className="conversation-history-item-row"
                  key={conversation.id}
                >
                  <button
                    className="conversation-history-item"
                    disabled={isInteractionDisabled}
                    onClick={() => onSelectConversation(conversation)}
                    type="button"
                  >
                    <span className="conversation-history-item-title">{conversation.title}</span>
                    {isRunning ? (
                      <span className="conversation-history-running-status">実行中</span>
                    ) : null}
                  </button>
                  <button
                    aria-label={`${conversation.title} ${isDeleting ? "を削除中" : "を削除"}`}
                    className="conversation-history-delete-action"
                    disabled={isRunning || isInteractionDisabled}
                    onClick={() => onDeleteConversation(conversation)}
                    type="button"
                  >
                    {isDeleting ? (
                      <FaCircleNotch aria-hidden="true" className="agent-run-status-icon" />
                    ) : (
                      <FaTrash aria-hidden="true" />
                    )}
                  </button>
                </div>
              );
            })
          ) : (
            <p className="conversation-history-empty">会話履歴はありません。</p>
          )}
        </div>
      </div>
    </div>
  );
}
