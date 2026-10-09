import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { apiFetch } from "../../shared/client/apiTransport";
import type { LlmProfileRoleAssignments } from "../llm/profiles/llmProfiles";
import type { LlmProviderChoice, SelectedModel } from "../llm/selection/llmSelection";
import {
  compactActiveConversation,
  type DroppedTextFileStatus,
  sendChatMessage,
} from "./chatConversationClient";
import type { WorkspaceOperationGeneration } from "./chatConversationControllerHelpers";
import type { ChatConversationDispatch } from "./useChatConversationState";
import type { LlmProfileWithAvailability } from "../llm/selection/llmModelSelection";
import {
  llmModelSelectValue,
  profileIdFromRoleAssignment,
  requiresApiKeySetup,
  selectedModelFromRoleAssignment,
  unavailableReasonForCurrentModelSelection,
} from "../llm/selection/llmModelSelection";
import type {
  AgentPlan,
  Conversation,
  EditProposal,
} from "./conversationSchemas";
import { parseSlashCommandInput } from "./slashCommands";
import type { ToolActivitySummary } from "./toolActivity";
import type {
  DroppedTextFilesRequestStatus,
  PendingDroppedTextFile,
} from "./useChatDroppedTextFileState";

const TOOL_COMPLETION_FEEDBACK_DURATION_MS = 1400;

type UseChatConversationSubmitParams = {
  activeConversation: Conversation | null;
  autoCompactEnabled: boolean;
  autoCompactThresholdRatio: number;
  currentFilePath?: string | null;
  dirtyPaths: string[];
  draft: string;
  droppedTextFiles: PendingDroppedTextFile[];
  llmProfileRoleAssignments: LlmProfileRoleAssignments | null;
  llmProfiles: LlmProfileWithAvailability[];
  connectionBlocked?: boolean;
  llmProviders: LlmProviderChoice[];
  mode?: "chat" | "editor";
  modelSelection: SelectedModel | null;
  onAppliedEdit?: (proposal: Pick<EditProposal, "operation" | "path">) => void;
  operation: WorkspaceOperationGeneration;
  selectedAgentRuntime: Conversation["agentRuntime"];
  dispatch: ChatConversationDispatch;
  setDraft: Dispatch<SetStateAction<string>>;
  setDroppedTextFileResults: Dispatch<SetStateAction<DroppedTextFileStatus[]>>;
  setDroppedTextFiles: Dispatch<SetStateAction<PendingDroppedTextFile[]>>;
  setDroppedTextFilesRequestStatus: Dispatch<
    SetStateAction<DroppedTextFilesRequestStatus>
  >;
  workspaceRoot: string | null;
};

export function useChatConversationSubmit({
  activeConversation,
  autoCompactEnabled,
  autoCompactThresholdRatio,
  currentFilePath,
  dirtyPaths,
  draft,
  droppedTextFiles,
  llmProfileRoleAssignments,
  llmProfiles,
  connectionBlocked = false,
  llmProviders,
  mode,
  modelSelection,
  onAppliedEdit,
  operation,
  selectedAgentRuntime,
  dispatch,
  setDraft,
  setDroppedTextFileResults,
  setDroppedTextFiles,
  setDroppedTextFilesRequestStatus,
  workspaceRoot,
}: UseChatConversationSubmitParams) {
  const [streamAssistantContent, setStreamAssistantContent] = useState("");
  const [streamReasoningContent, setStreamReasoningContent] = useState("");
  const [streamPlan, setStreamPlan] = useState<Pick<AgentPlan, "items"> | null>(
    null,
  );
  const [streamToolActivities, setStreamToolActivities] = useState<
    ToolActivitySummary[]
  >([]);
  const [expandedToolActivityGroups, setExpandedToolActivityGroups] = useState<
    Set<string>
  >(() => new Set());
  const [completedToolFeedbackIds, setCompletedToolFeedbackIds] = useState<
    Set<string>
  >(() => new Set());
  const completionFeedbackTimers = useRef(new Map<string, number>());
  const streamToolActivityStatuses = useRef(
    new Map<string, ToolActivitySummary["status"]>(),
  );

  function clearCompletionFeedback() {
    completionFeedbackTimers.current.forEach((timerId) =>
      window.clearTimeout(timerId),
    );
    completionFeedbackTimers.current.clear();
    streamToolActivityStatuses.current.clear();
    setCompletedToolFeedbackIds(new Set());
  }

  function collapseToolActivityGroups() {
    setExpandedToolActivityGroups(new Set());
  }

  function showCompletionFeedback(toolCallId: string) {
    window.clearTimeout(completionFeedbackTimers.current.get(toolCallId));
    setCompletedToolFeedbackIds((current) => {
      const next = new Set(current);
      next.add(toolCallId);
      return next;
    });
    const timerId = window.setTimeout(() => {
      completionFeedbackTimers.current.delete(toolCallId);
      setCompletedToolFeedbackIds((current) => {
        if (!current.has(toolCallId)) {
          return current;
        }
        const next = new Set(current);
        next.delete(toolCallId);
        return next;
      });
    }, TOOL_COMPLETION_FEEDBACK_DURATION_MS);
    completionFeedbackTimers.current.set(toolCallId, timerId);
  }

  useEffect(() => {
    return () => {
      completionFeedbackTimers.current.forEach((timerId) =>
        window.clearTimeout(timerId),
      );
      completionFeedbackTimers.current.clear();
    };
  }, []);

  function clearStreamPresentationState() {
    setStreamAssistantContent("");
    setStreamReasoningContent("");
    setStreamPlan(null);
    setStreamToolActivities([]);
    collapseToolActivityGroups();
    clearCompletionFeedback();
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
    submittedDroppedTextFiles = droppedTextFiles,
  ) {
    event.preventDefault();
    if (connectionBlocked || !workspaceRoot || !draft.trim()) {
      return;
    }

    if (
      submittedDroppedTextFiles.length > 0 &&
      selectedAgentRuntime === "codex-app-server"
    ) {
      dispatch({
        type: "errorChanged",
        error:
          "添付テキストファイルは標準モデルでのみ利用できます。実行方式を標準モデルへ変更してください。",
      });
      return;
    }

    const parsedInput = parseSlashCommandInput(draft);
    if (parsedInput.kind === "unknown") {
      setDraft("");
      dispatch({ type: "errorChanged", error: null });
      dispatch({ type: "apiKeyGuidanceChanged", show: false });
      dispatch({
        type: "feedbackChanged",
        feedback: "未対応のスラッシュコマンドです。",
      });
      return;
    }

    if (parsedInput.kind === "command" && parsedInput.commandId === "compact") {
      setDraft("");
      dispatch({ type: "errorChanged", error: null });
      dispatch({ type: "apiKeyGuidanceChanged", show: false });
      dispatch({ type: "feedbackChanged", feedback: null });

      if (!activeConversation) {
        dispatch({
          type: "feedbackChanged",
          feedback: "圧縮する会話がまだありません。",
        });
        return;
      }

      dispatch({ type: "compactStarted" });
      const operationGeneration = operation.begin();
      try {
        const result = await compactActiveConversation(
          workspaceRoot,
          activeConversation.id,
        );
        if (operation.isStale(operationGeneration)) {
          return;
        }
        dispatch({
          type: "compactSucceeded",
          conversation: result.conversation,
          feedback:
            result.status === "compacted"
              ? "ここまでの会話を圧縮しました。"
              : "圧縮できる履歴がまだありません。",
        });
      } catch (nextError) {
        if (operation.isStale(operationGeneration)) {
          return;
        }
        const message =
          nextError instanceof Error
            ? nextError.message
            : "会話圧縮に失敗しました。";
        dispatch({
          type: "compactFailed",
          error: message.startsWith("会話圧縮に失敗")
            ? message
            : `会話圧縮に失敗しました。${message}`,
        });
      } finally {
        if (!operation.isStale(operationGeneration)) {
          dispatch({ type: "operationFinished" });
        }
      }
      return;
    }

    const mainAssignment = llmProfileRoleAssignments?.main;
    const submitChatModelValue = llmModelSelectValue({
      mainAssignment,
      modelSelection,
      profiles: llmProfiles,
    });
    const submitUnavailableReasons =
      unavailableReasonForCurrentModelSelection({
        chatModelValue: submitChatModelValue,
        llmProfiles,
        llmProviders,
      });
    if (
      selectedAgentRuntime !== "codex-app-server" &&
      requiresApiKeySetup(submitUnavailableReasons)
    ) {
      dispatch({ type: "errorChanged", error: null });
      dispatch({ type: "apiKeyGuidanceChanged", show: true });
      return;
    }

    const selectedMainProfileId = profileIdFromRoleAssignment(mainAssignment);
    const selectedMainModel = selectedMainProfileId
      ? selectedModelFromRoleAssignment(mainAssignment, llmProfiles)
      : (modelSelection ??
        selectedModelFromRoleAssignment(mainAssignment, llmProfiles));
    const userProfiles = llmProfiles.filter(
      (profile): profile is LlmProfileWithAvailability =>
        profile.source === "user",
    );

    dispatch({ type: "errorChanged", error: null });
    dispatch({ type: "apiKeyGuidanceChanged", show: false });
    dispatch({ type: "feedbackChanged", feedback: null });
    dispatch({ type: "submitStarted" });
    const content =
      parsedInput.kind === "message" ? parsedInput.message : draft.trim();
    const droppedTextFilesForRequest = submittedDroppedTextFiles.map(
      ({ contentBase64, name }) => ({
        contentBase64,
        name,
      }),
    );
    setDraft("");
    if (droppedTextFilesForRequest.length > 0) {
      setDroppedTextFilesRequestStatus("sending");
      setDroppedTextFileResults([]);
    }
    clearStreamPresentationState();
    const operationGeneration = operation.begin();
    try {
      const updated = await sendChatMessage(
        workspaceRoot,
        activeConversation?.id,
        content,
        currentFilePath,
        selectedMainModel,
        selectedMainProfileId,
        userProfiles,
        {
          autoCompactEnabled,
          autoCompactThresholdRatio,
          ...(droppedTextFilesForRequest.length > 0
            ? { droppedTextFiles: droppedTextFilesForRequest }
            : {}),
          ...(mode ? { mode } : {}),
          onReasoningDelta: (text) => {
            if (operation.isStale(operationGeneration)) return;
            setStreamReasoningContent((current) => `${current}${text}`.slice(-12_000));
          },
          onTextDelta: (text) => {
            if (operation.isStale(operationGeneration)) {
              return;
            }
            setStreamAssistantContent((current) => `${current}${text}`);
          },
          onPlanUpdate: (plan) => {
            if (operation.isStale(operationGeneration)) {
              return;
            }
            setStreamPlan(plan);
          },
          onDroppedTextFileStatus: (file) => {
            if (operation.isStale(operationGeneration)) {
              return;
            }
            setDroppedTextFileResults((current) => {
              const existingIndex = current.findIndex(
                (item) => item.index === file.index,
              );
              if (existingIndex === -1) {
                return [...current, file].sort(
                  (left, right) => left.index - right.index,
                );
              }
              const next = [...current];
              next[existingIndex] = file;
              return next;
            });
          },
          onToolActivity: (activity) => {
            if (operation.isStale(operationGeneration)) {
              return;
            }
            const previousStatus = streamToolActivityStatuses.current.get(
              activity.toolCallId,
            );
            streamToolActivityStatuses.current.set(
              activity.toolCallId,
              activity.status,
            );
            if (
              previousStatus === "running" &&
              activity.status === "completed"
            ) {
              showCompletionFeedback(activity.toolCallId);
            }
            setStreamToolActivities((current) => {
              const index = current.findIndex(
                (item) => item.toolCallId === activity.toolCallId,
              );
              if (index === -1) {
                return [...current, activity];
              }

              const next = [...current];
              next[index] = activity;
              return next;
            });
          },
        },
      );
      if (operation.isStale(operationGeneration)) {
        return;
      }
      dispatch({ type: "submitSucceeded", conversation: updated });
      updated.editProposals.forEach((proposal) => {
        const previous = activeConversation?.editProposals.find((item) => item.id === proposal.id);
        if (proposal.status === "applied" && previous?.status !== "applied") {
          onAppliedEdit?.({ operation: proposal.operation, path: proposal.path });
        }
      });
      setDroppedTextFiles([]);
      if (droppedTextFilesForRequest.length > 0) {
        setDroppedTextFilesRequestStatus("accepted");
      }
      clearStreamPresentationState();
    } catch (nextError) {
      if (operation.isStale(operationGeneration)) {
        return;
      }
      setDraft(content);
      if (droppedTextFilesForRequest.length > 0) {
        setDroppedTextFilesRequestStatus("failed");
      }

      clearStreamPresentationState();
      dispatch({
        type: "submitFailed",
        error:
          nextError instanceof Error
            ? nextError.message
            : "AI応答の生成に失敗しました。",
      });
    } finally {
      if (!operation.isStale(operationGeneration)) {
        dispatch({ type: "operationFinished" });
      }
    }
  }

  async function updateEditProposal(
    action: "applyEditProposal" | "rejectEditProposal" | "undoEditProposal",
    proposalId: string,
  ) {
    if (!workspaceRoot || !activeConversation) {
      return;
    }

    dispatch({ type: "errorChanged", error: null });
    const operationGeneration = operation.begin();
    const response = await apiFetch("/api/conversations", {
      body: JSON.stringify({
        action,
        conversationId: activeConversation.id,
        ...(action === "applyEditProposal" ? { dirtyPaths } : {}),
        proposalId,
        workspaceRoot,
      }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const body = await response.json();
    if (operation.isStale(operationGeneration)) {
      return;
    }
    if (!response.ok) {
      const message =
        typeof body?.message === "string"
          ? body.message
          : "編集案の更新に失敗しました。";
      dispatch({ type: "errorChanged", error: message });
      return;
    }

    const nextConversation = body.conversation as Conversation;
    const previousProposal = activeConversation.editProposals.find(
      (proposal) => proposal.id === proposalId,
    );
    const nextProposal = nextConversation.editProposals.find(
      (proposal) => proposal.id === proposalId,
    );
    dispatch({ type: "conversationUpdated", conversation: nextConversation });

    if (
      ((action === "applyEditProposal" && nextProposal?.status === "applied") ||
        (action === "undoEditProposal" && nextProposal?.status === "undone")) &&
      previousProposal
    ) {
      onAppliedEdit?.({
        operation: previousProposal.operation,
        path: previousProposal.path,
      });
      return;
    }

    if (
      action === "applyEditProposal" &&
      nextProposal?.status === "conflicted"
    ) {
      dispatch({
        type: "errorChanged",
        error:
          "編集案が競合しました。ファイルを再読み込みして確認してください。",
      });
    }

    if (
      action === "undoEditProposal" &&
      nextProposal?.status === "conflicted"
    ) {
      dispatch({
        type: "errorChanged",
        error:
          "取り消しできませんでした。対象ファイルが適用後に変更されています。",
      });
    }
  }

  function toggleToolActivityGroup(groupId: string) {
    setExpandedToolActivityGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  return {
    clearStreamPresentationState,
    completedToolFeedbackIds,
    expandedToolActivityGroups,
    handleSubmit,
    streamAssistantContent,
    streamReasoningContent,
    streamPlan,
    streamToolActivities,
    toggleToolActivityGroup,
    updateEditProposal,
  };
}
