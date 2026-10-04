import type { ReactNode } from "react";
import { FaCircleNotch, FaExclamationTriangle } from "react-icons/fa";
import { AgentPlanView, AgentPlansView } from "./AgentPlanView";
import {
  editProposalsForMessage,
  orphanEditProposals,
  plansForMessage,
  toolActivitiesForMessage,
} from "./chatMessageAssociations";
import type { AgentPlan, Conversation, EditProposal } from "./conversationSchemas";
import { EditProposalCard } from "../edit-proposals/EditProposalCard";
import { latestUndoableProposalId } from "./editProposalUndo";
import { MessageMarkdown } from "./MessageMarkdown";
import { ReasoningProgress } from "./ReasoningProgress";
import { ToolActivityGroup, toolActivityGroupId } from "./ToolActivityGroup";
import type { ToolActivitySummary } from "./toolActivity";

function renderMessageWarnings(message: Conversation["messages"][number]) {
  if (message.role !== "assistant" || !message.warnings || message.warnings.length === 0) {
    return null;
  }

  return (
    <div className="message-warnings">
      {message.warnings.map((warning) => (
        <p className="message-warning" key={warning.type} role="note">
          <FaExclamationTriangle aria-hidden="true" />
          <span>{warning.message}</span>
        </p>
      ))}
    </div>
  );
}

export type ChatMessageListProps = {
  activeConversation: Conversation | null;
  agentRunState: "idle" | "running" | "failed";
  commandFeedback: string | null;
  compactionState: "idle" | "running";
  completedToolFeedbackIds: Set<string>;
  dirtyPaths: string[];
  emptyConversationCopy: ReactNode;
  expandedToolActivityGroups: Set<string>;
  mode?: "chat" | "editor";
  onOpenPath?: (path: string) => void;
  streamAssistantContent: string;
  streamReasoningContent: string;
  streamPlan: Pick<AgentPlan, "items"> | null;
  streamToolActivities: ToolActivitySummary[];
  toggleToolActivityGroup: (groupId: string) => void;
  updateEditProposal: (
    action: "applyEditProposal" | "rejectEditProposal" | "undoEditProposal",
    proposalId: string,
  ) => void;
};

export function ChatMessageList({
  activeConversation,
  agentRunState,
  commandFeedback,
  compactionState,
  completedToolFeedbackIds,
  dirtyPaths,
  emptyConversationCopy,
  expandedToolActivityGroups,
  mode,
  onOpenPath,
  streamAssistantContent,
  streamReasoningContent,
  streamPlan,
  streamToolActivities,
  toggleToolActivityGroup,
  updateEditProposal,
}: ChatMessageListProps) {
  const messages = activeConversation?.messages ?? [];
  const undoableProposalId = latestUndoableProposalId(activeConversation?.editProposals ?? []);
  const dirtyPathSet = new Set(dirtyPaths);
  const orphanProposals = orphanEditProposals(
    activeConversation?.editProposals ?? [],
    messages,
  );
  const shouldShowAgentRunningMessage = agentRunState === "running";
  const shouldShowCompactionRunningMessage = compactionState === "running";

  function renderToolActivities(
    activities: ToolActivitySummary[] | Conversation["toolActivities"],
    feedbackToolCallIds?: Set<string>,
    groupId = toolActivityGroupId(activities),
  ) {
    return (
      <ToolActivityGroup
        activities={activities}
        feedbackToolCallIds={feedbackToolCallIds}
        groupId={groupId}
        isExpanded={expandedToolActivityGroups.has(groupId)}
        onToggle={() => toggleToolActivityGroup(groupId)}
      />
    );
  }

  function renderEditProposals(proposals: EditProposal[]) {
    if (proposals.length === 0) {
      return null;
    }

    return (
      <div className="message-edit-proposals">
        {proposals.map((proposal) => {
          const isTargetDirty = dirtyPathSet.has(proposal.path);
          const isPending = proposal.status === "pending";
          const canApply = isPending && !isTargetDirty;
          const canUndo = proposal.id === undoableProposalId;
          return (
            <EditProposalCard
              canApply={canApply}
              canUndo={canUndo}
              isTargetDirty={isTargetDirty}
              key={proposal.id}
              mode={mode}
              onApply={() => void updateEditProposal("applyEditProposal", proposal.id)}
              onOpenPath={onOpenPath}
              onReject={() => void updateEditProposal("rejectEditProposal", proposal.id)}
              onUndo={() => void updateEditProposal("undoEditProposal", proposal.id)}
              proposal={proposal}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className="message-list" aria-label="会話履歴">
      {activeConversation && activeConversation.messages.length > 0 ? (
        activeConversation.messages.map((message) => (
          <article className={`${message.role}-message`} key={message.id}>
            {message.content ? <MessageMarkdown content={message.content} /> : null}
            {renderMessageWarnings(message)}
            {message.role === "assistant" ? (
              <>
                {renderToolActivities(
                  toolActivitiesForMessage(
                    activeConversation.toolActivities,
                    messages,
                    message.id,
                  ),
                )}
                <AgentPlansView
                  plans={plansForMessage(activeConversation.plans ?? [], messages, message.id)}
                />
                {renderEditProposals(
                  editProposalsForMessage(
                    activeConversation.editProposals,
                    messages,
                    message.id,
                  ),
                )}
              </>
            ) : null}
          </article>
        ))
      ) : emptyConversationCopy ? (
        <article className="assistant-message chat-empty-message">{emptyConversationCopy}</article>
      ) : null}
      {commandFeedback ? (
        <article className="assistant-message chat-command-feedback">{commandFeedback}</article>
      ) : null}
      {shouldShowCompactionRunningMessage ? (
        <article className="assistant-message is-compacting" aria-live="polite">
          <div className="agent-run-status" role="status" aria-label="会話圧縮中">
            <FaCircleNotch className="agent-run-status-icon" aria-hidden="true" />
            <span>会話を圧縮中</span>
          </div>
        </article>
      ) : null}
      {shouldShowAgentRunningMessage ? (
        <article className="assistant-message is-generating" aria-live="polite">
          <div className="agent-run-status" role="status" aria-label="AI応答生成中">
            <FaCircleNotch className="agent-run-status-icon" aria-hidden="true" />
            <span>AIが応答を生成中</span>
          </div>
          <ReasoningProgress content={streamReasoningContent} />
          {streamAssistantContent ? <MessageMarkdown content={streamAssistantContent} /> : null}
          <AgentPlanView plan={streamPlan} />
          {renderToolActivities(streamToolActivities, completedToolFeedbackIds)}
        </article>
      ) : null}
      {orphanProposals.length ? (
        <article className="assistant-message">{renderEditProposals(orphanProposals)}</article>
      ) : null}
    </div>
  );
}
