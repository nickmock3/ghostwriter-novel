import { useAiConnection, type AiConnection } from "../siwc/useAiConnection";
import { selectedModelFromRoleAssignment } from "../llm/selection/llmModelSelection";
import { useRef, useState } from "react";
import { useChatConversationState } from "./useChatConversationState";
import type { LlmProfileRoleAssignments } from "../llm/profiles/llmProfiles";
import type { LlmProviderChoice, SelectedModel } from "../llm/selection/llmSelection";
import type { LlmProfileWithAvailability } from "../llm/selection/llmModelSelection";
import type { Conversation, EditProposal } from "./conversationSchemas";
import { useChatConversationHistory } from "./useChatConversationHistory";
import { useChatConversationSubmit } from "./useChatConversationSubmit";
import {
  useChatDroppedTextFileState,
  type PendingDroppedTextFile,
} from "./useChatDroppedTextFileState";
import { useWorkspaceOperationGeneration } from "./useWorkspaceOperationGeneration";

export type { PendingDroppedTextFile };

export type ChatConversationControllerParams = {
  workspaceRoot: string | null;
  currentFilePath?: string | null;
  dirtyPaths?: string[];
  mode?: "chat" | "editor";
  autoCompactEnabled?: boolean;
  autoCompactThresholdRatio?: number;
  llmProviders?: LlmProviderChoice[];
  llmProfiles?: LlmProfileWithAvailability[];
  llmProfileRoleAssignments?: LlmProfileRoleAssignments | null;
  modelSelection?: SelectedModel | null;
  onAppliedEdit?: (proposal: Pick<EditProposal, "operation" | "path">) => void;
};

export function useChatConversationController({
  workspaceRoot,
  currentFilePath,
  dirtyPaths = [],
  mode,
  autoCompactEnabled = true,
  autoCompactThresholdRatio = 0.7,
  llmProviders = [],
  llmProfiles = [],
  llmProfileRoleAssignments = null,
  modelSelection = null,
  onAppliedEdit,
}: ChatConversationControllerParams) {
  const operation = useWorkspaceOperationGeneration();
  const droppedTextFileState = useChatDroppedTextFileState();
  const { state, dispatch } = useChatConversationState();
  const {
    activeConversation,
    conversations,
    error,
    agentRunState,
    compactionState,
    commandFeedback,
    isLoading,
    selectedAgentRuntime,
    showApiKeySetupGuidance,
  } = state;
  const [draft, setDraft] = useState("");
  const lastAppendedTextRequestId = useRef<number | null>(null);
  const setShowApiKeySetupGuidance = (show: boolean) =>
    dispatch({ type: "apiKeyGuidanceChanged", show });

  const assignedModel = selectedModelFromRoleAssignment(llmProfileRoleAssignments?.main, llmProfiles);
  const legacyModelSelection = llmProfileRoleAssignments?.main.kind === "profile"
    ? assignedModel : modelSelection ?? assignedModel;
  const connection = useAiConnection({ scope: "chat", providers: llmProviders,
    legacySelection: legacyModelSelection,
    binding: activeConversation?.siwc,
    fixedConnection: selectedAgentRuntime === "codex-app-server" ? "codex" : activeConversation?.messages.length && !activeConversation.siwc ? "api" : undefined,
  });
  const apiModelMismatch = connection.connection === "api" &&
    legacyModelSelection?.providerId === "openai-chatgpt";
  const submit = useChatConversationSubmit({
    activeConversation,
    dispatch,
    autoCompactEnabled,
    autoCompactThresholdRatio,
    currentFilePath,
    dirtyPaths,
    draft,
    droppedTextFiles: droppedTextFileState.droppedTextFiles,
    llmProfileRoleAssignments: connection.connection === "chatgpt" ? null : llmProfileRoleAssignments,
    llmProfiles,
    llmProviders,
    mode,
    modelSelection: connection.connection === "chatgpt" ? connection.selection : modelSelection,
    connectionBlocked: connection.blocked || apiModelMismatch || selectedAgentRuntime === "codex-app-server",
    onAppliedEdit,
    operation,
    selectedAgentRuntime: "vercel-ai" as const,
    setDraft,
    setDroppedTextFileResults: droppedTextFileState.setDroppedTextFileResults,
    setDroppedTextFiles: droppedTextFileState.setDroppedTextFiles,
    setDroppedTextFilesRequestStatus:
      droppedTextFileState.setDroppedTextFilesRequestStatus,
    workspaceRoot,
  });

  function clearActiveConversationPresentationState() {
    submit.clearStreamPresentationState();
    dispatch({ type: "presentationReset" });
  }

  const history = useChatConversationHistory({
    activeConversation,
    dispatch,
    agentRunState,
    clearActiveConversationPresentationState,
    clearDroppedTextFiles: droppedTextFileState.clearDroppedTextFiles,
    clearStreamPresentationState: submit.clearStreamPresentationState,
    compactionState,
    operation,
    selectedAgentRuntime: "vercel-ai" as const,
    workspaceRoot,
  });

  async function handleConnectionChange(next: AiConnection) {
    if (next === connection.connection) return;
    // Changing billing path always starts a new conversation, even inside vercel-ai.
    const created = await history.handleCreateConversation("vercel-ai");
    if (created) connection.chooseConnection(next);
  }

  return {
    connection: { ...connection, blocked: connection.blocked || apiModelMismatch || selectedAgentRuntime === "codex-app-server" },
    apiModelMismatch,
    handleConnectionChange,
    lastAppendedTextRequestId,
    activeConversation,
    agentRunState,
    closeHistoryDialog: history.closeHistoryDialog,
    commandFeedback,
    compactionState,
    completedToolFeedbackIds: submit.completedToolFeedbackIds,
    conversations,
    deletingConversationId: history.deletingConversationId,
    draft,
    droppedTextFiles: droppedTextFileState.droppedTextFiles,
    droppedTextFilesRequestStatus:
      droppedTextFileState.droppedTextFilesRequestStatus,
    droppedTextFileResults: droppedTextFileState.droppedTextFileResults,
    error,
    expandedToolActivityGroups: submit.expandedToolActivityGroups,
    handleAgentRuntimeChange: history.handleAgentRuntimeChange,
    handleCreateConversation: async () => {
      const created = await history.handleCreateConversation();
      if (created) {
        if (connection.selection) connection.chooseModel(connection.selection.modelId);
        else connection.chooseConnection(connection.connection);
      }
    },
    handleDeleteConversation: history.handleDeleteConversation,
    handleHistoryDialogKeyDown: history.handleHistoryDialogKeyDown,
    handleSelectConversation: history.handleSelectConversation,
    handleSubmit: submit.handleSubmit,
    historyDialogRef: history.historyDialogRef,
    historyTriggerRef: history.historyTriggerRef,
    isHistoryOpen: history.isHistoryOpen,
    isConversationDeleteDisabled: history.isConversationDeleteDisabled,
    isLoading,
    selectedAgentRuntime: "vercel-ai" as const,
    setDraft,
    setDroppedTextFiles: droppedTextFileState.setDroppedTextFiles,
    setIsHistoryOpen: history.setIsHistoryOpen,
    setShowApiKeySetupGuidance,
    showApiKeySetupGuidance,
    streamAssistantContent: submit.streamAssistantContent,
    streamReasoningContent: submit.streamReasoningContent,
    streamPlan: submit.streamPlan,
    streamToolActivities: submit.streamToolActivities,
    toggleToolActivityGroup: submit.toggleToolActivityGroup,
    updateEditProposal: submit.updateEditProposal,
  };
}
