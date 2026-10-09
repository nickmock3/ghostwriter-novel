import { siwcExecutionMessage } from "../siwc/useAiConnection";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { FaExclamationTriangle, FaHistory, FaPlus } from "react-icons/fa";
import type { EditProposal } from "./conversationSchemas";
import type { LlmProviderChoice, SelectedModel } from "../llm/selection/llmSelection";
import type { LlmProfileRoleAssignments } from "../llm/profiles/llmProfiles";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageList } from "./ChatMessageList";
import type { LlmProfileWithAvailability } from "../llm/selection/llmModelSelection";
import {
  llmModelSelectValue,
  selectedModelFromRoleAssignment,
  unavailableReasonForCurrentModelSelection,
} from "../llm/selection/llmModelSelection";
import { ConversationHistoryDialog } from "./ConversationHistoryDialog";
import { latestMainContextSnapshot, sessionTokenUsage } from "./tokenUsageDisplay";
import { useChatConversationController } from "./useChatConversationController";
import { useChatDroppedTextFiles } from "./useChatDroppedTextFiles";
import { useChatModeBottomFollow } from "./useChatModeBottomFollow";

export type AppliedEditProposal = Pick<EditProposal, "operation" | "path">;

export type ChatPaneLlmProps = {
  providers?: LlmProviderChoice[];
  profiles?: LlmProfileWithAvailability[];
  roleAssignments?: LlmProfileRoleAssignments | null;
  modelSelection?: SelectedModel | null;
  onMainLlmProfileIdChange?: (profileId: string | null) => void;
  onMainLlmModelSelectionChange?: (modelSelection: SelectedModel | null) => void;
  onModelSelectionChange?: (modelSelection: SelectedModel | null) => void;
};

export type ChatPaneConversationOptions = {
  autoCompactEnabled?: boolean;
  autoCompactThresholdRatio?: number;
};

export type ChatPaneFileContext = {
  workspaceRoot: string | null;
  currentFilePath?: string | null;
  dirtyPaths?: string[];
  appendedTextRequest?: { id: number; text: string } | null;
};

export type ChatPaneEditActions = {
  onAppliedEdit?: (proposal: AppliedEditProposal) => void;
  onOpenPath?: (path: string) => void;
};

export type ChatPanePaneControls = {
  paneCollapseControl?: ReactNode;
  paneLayoutResetControl?: ReactNode;
};

export type ChatPaneProps = {
  llm?: ChatPaneLlmProps;
  conversationOptions?: ChatPaneConversationOptions;
  fileContext: ChatPaneFileContext;
  editActions?: ChatPaneEditActions;
  paneControls?: ChatPanePaneControls;
  mode?: "chat" | "editor";
  layout?: "editor-pane" | "full-page";
  controller?: ReturnType<typeof useChatConversationController>;
};

export function ChatPane(props: ChatPaneProps) {
  return props.controller
    ? <ChatPaneView {...props} controller={props.controller} />
    : <LocalChatPane {...props} />;
}

function LocalChatPane(props: ChatPaneProps) {
  const controller = useChatConversationController({
    ...props.fileContext,
    ...props.conversationOptions,
    mode: props.mode,
    llmProviders: props.llm?.providers,
    llmProfiles: props.llm?.profiles,
    llmProfileRoleAssignments: props.llm?.roleAssignments,
    modelSelection: props.llm?.modelSelection,
    onAppliedEdit: props.editActions?.onAppliedEdit,
  });
  return <ChatPaneView {...props} controller={controller} />;
}

function ChatPaneView({
  controller,
  llm,
  fileContext,
  editActions,
  paneControls,
  mode,
  layout = "editor-pane",
}: ChatPaneProps & { controller: ReturnType<typeof useChatConversationController> }) {
  const {
    workspaceRoot,
    dirtyPaths = [],
    appendedTextRequest,
  } = fileContext;
  const {
    providers: llmProviders = [],
    profiles: llmProfiles = [],
    roleAssignments: llmProfileRoleAssignments = null,
    modelSelection = null,
    onMainLlmProfileIdChange,
    onMainLlmModelSelectionChange,
    onModelSelectionChange,
  } = llm ?? {};
  const { onOpenPath } = editActions ?? {};
  const { paneCollapseControl, paneLayoutResetControl } = paneControls ?? {};

  const {
    activeConversation,
    agentRunState,
    closeHistoryDialog,
    commandFeedback,
    compactionState,
    completedToolFeedbackIds,
    conversations,
    deletingConversationId,
    draft,
    droppedTextFiles,
    droppedTextFilesRequestStatus,
    droppedTextFileResults,
    error,
    expandedToolActivityGroups,
    handleAgentRuntimeChange,
    handleCreateConversation,
    handleDeleteConversation,
    handleHistoryDialogKeyDown,
    handleSelectConversation,
    handleSubmit,
    historyDialogRef,
    historyTriggerRef,
    isHistoryOpen,
    isConversationDeleteDisabled,
    isLoading,
    selectedAgentRuntime,
    setDraft,
    setDroppedTextFiles,
    setIsHistoryOpen,
    setShowApiKeySetupGuidance,
    showApiKeySetupGuidance,
    streamAssistantContent,
    streamReasoningContent,
    streamPlan,
    streamToolActivities,
    toggleToolActivityGroup,
    updateEditProposal,
  } = controller;

  const { chatScrollAreaRef, handleChatScrollAreaScroll } = useChatModeBottomFollow({
    mode,
    isLoading,
    activeConversation,
    streamAssistantContent,
    streamReasoningContent,
    streamPlan,
    streamToolActivities,
    commandFeedback,
    agentRunState,
    compactionState,
    completedToolFeedbackIds,
    expandedToolActivityGroups,
  });

  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const canAttachDroppedTextFiles = mode === "chat" && selectedAgentRuntime === "vercel-ai";
  const droppedTextFilesApi = useChatDroppedTextFiles({
    canAttach: canAttachDroppedTextFiles,
    droppedTextFiles,
    isLoading,
    setDroppedTextFiles,
  });

  useEffect(() => {
    if (!appendedTextRequest?.text || controller.lastAppendedTextRequestId.current === appendedTextRequest.id) {
      return;
    }

    controller.lastAppendedTextRequestId.current = appendedTextRequest.id;
    setDraft((current) =>
      current ? `${current}\n${appendedTextRequest.text}` : appendedTextRequest.text,
    );
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }, [appendedTextRequest, setDraft, controller.lastAppendedTextRequestId]);

  const userDefinedProfiles = llmProfiles.filter((profile) => profile.source === "user");
  const mainAssignment = llmProfileRoleAssignments?.main;
  const chatModelValue = useMemo(
    () =>
      llmModelSelectValue({
        mainAssignment,
        modelSelection,
        profiles: llmProfiles,
      }),
    [mainAssignment, llmProfiles, modelSelection],
  );
  const resolvedMainSelection = useMemo(
    () => modelSelection ?? selectedModelFromRoleAssignment(mainAssignment, llmProfiles),
    [mainAssignment, llmProfiles, modelSelection],
  );
  const unavailableReasons = useMemo(
    () =>
      unavailableReasonForCurrentModelSelection({
        chatModelValue,
        llmProfiles,
        llmProviders,
      }),
    [chatModelValue, llmProfiles, llmProviders],
  );
  const sessionUsage = useMemo(() => sessionTokenUsage(activeConversation), [activeConversation]);
  const mainContextSnapshot = useMemo(
    () => latestMainContextSnapshot(activeConversation),
    [activeConversation],
  );
  const isWorkspaceUnavailable = workspaceRoot === null;
  const composerPlaceholder = isWorkspaceUnavailable
    ? "ワークスペースを開くと利用できます"
    : "ワークスペースについて質問";
  const isCodexRuntime = activeConversation?.agentRuntime === "codex-app-server";
  const showTokenUsageIndicator =
    !isWorkspaceUnavailable &&
    (isCodexRuntime ? sessionUsage !== null : mainContextSnapshot !== null);
  const emptyConversationCopy =
    isWorkspaceUnavailable || agentRunState !== "idle" ? null : (
      <>
        <p>小説づくりをチャットで進めましょう。</p>
        <p>アイデア出し、設定やプロットの整理、本文の執筆・推敲を頼めます。</p>
        <p>まずは、いま書きたいことや困っていることを教えてください。</p>
      </>
    );

  return (
    <aside
      className={`pane chat-pane${layout === "full-page" ? " chat-pane--full-page" : ""}${
        isWorkspaceUnavailable ? " chat-pane--workspace-unavailable" : ""
      }`}
      aria-label="AIチャット"
    >
      <div className="pane-heading">
        <h2>AI Chat</h2>
        <div className="pane-heading-actions">
          {paneLayoutResetControl}
          <button
            aria-label="会話履歴を開く"
            className="conversation-toolbar-action"
            disabled={!workspaceRoot || isLoading}
            onClick={() => setIsHistoryOpen(true)}
            ref={historyTriggerRef}
            type="button"
          >
            <FaHistory aria-hidden="true" />
          </button>
          <button
            className="conversation-toolbar-action"
            disabled={!workspaceRoot || isLoading}
            onClick={() => void handleCreateConversation()}
            type="button"
            aria-label="新規会話"
          >
            <FaPlus aria-hidden="true" />
          </button>
          {paneCollapseControl}
        </div>
      </div>
      <ConversationHistoryDialog
        activeConversationId={activeConversation?.id}
        conversations={conversations}
        deletingConversationId={deletingConversationId}
        dialogRef={historyDialogRef}
        isDeleteDisabled={isConversationDeleteDisabled}
        isOpen={isHistoryOpen}
        onClose={() => closeHistoryDialog()}
        onDeleteConversation={(conversation) => void handleDeleteConversation(conversation)}
        onKeyDown={handleHistoryDialogKeyDown}
        onSelectConversation={handleSelectConversation}
      />
      {showApiKeySetupGuidance && !isCodexRuntime && controller.connection.connection !== "chatgpt" ? (
        <div className="pane-error chat-api-key-setup-guidance" role="alert">
          <p>
            <FaExclamationTriangle aria-hidden="true" />
            AI機能を使うにはAPIキーが必要です
          </p>
          <p className="chat-api-key-setup-description">
            選択中のモデルを使うために、APIキーを設定してください。
          </p>
          <div className="chat-api-key-setup-actions">
            <a className="secondary-action" href="/settings">
              APIキーを設定
            </a>
            <a className="secondary-action" href="/llm-profiles">
              モデル設定を開く
            </a>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="pane-error" role="alert">
          <FaExclamationTriangle aria-hidden="true" />
          {controller.connection.connection === "chatgpt" ? <>{siwcExecutionMessage(error)} <a href="/settings">ChatGPT接続設定</a></> : error}
        </p>
      ) : null}
      <div
        className="chat-scroll-area"
        onDragOver={droppedTextFilesApi.handleConversationFileDragOver}
        onDrop={droppedTextFilesApi.handleConversationFileDrop}
        onScroll={handleChatScrollAreaScroll}
        ref={chatScrollAreaRef}
      >
        <ChatMessageList
          activeConversation={activeConversation}
          agentRunState={agentRunState}
          commandFeedback={commandFeedback}
          compactionState={compactionState}
          completedToolFeedbackIds={completedToolFeedbackIds}
          dirtyPaths={dirtyPaths}
          emptyConversationCopy={emptyConversationCopy}
          expandedToolActivityGroups={expandedToolActivityGroups}
          mode={mode}
          onOpenPath={onOpenPath}
          streamAssistantContent={streamAssistantContent}
          streamReasoningContent={streamReasoningContent}
          streamPlan={streamPlan}
          streamToolActivities={streamToolActivities}
          toggleToolActivityGroup={toggleToolActivityGroup}
          updateEditProposal={updateEditProposal}
        />
      </div>
      {controller.apiModelMismatch ? <p role="status">APIキー接続のモデルを選択してください。</p> : null}
      <ChatComposer
        connection={controller.connection}
        connectionFixed={Boolean(activeConversation?.siwc)}
        onConnectionChange={controller.handleConnectionChange}
        agentRunState={agentRunState}
        chatModelValue={chatModelValue}
        composerPlaceholder={composerPlaceholder}
        composerRef={composerRef}
        draft={draft}
        droppedTextFileError={droppedTextFilesApi.droppedTextFileError}
        droppedTextFileResults={droppedTextFileResults}
        droppedTextFiles={droppedTextFiles}
        droppedTextFilesRequestStatus={droppedTextFilesRequestStatus}
        handleComposerDragOver={droppedTextFilesApi.handleComposerDragOver}
        handleComposerFileDrop={droppedTextFilesApi.handleComposerFileDrop}
        isCodexRuntime={isCodexRuntime}
        isLoading={isLoading}
        isModelSelectorDisabled={
          !workspaceRoot || (llmProfiles.length === 0 && llmProviders.length === 0)
        }
        isWorkspaceUnavailable={isWorkspaceUnavailable}
        llmProviders={llmProviders}
        mainContextSnapshot={mainContextSnapshot}
        mode={mode}
        onAgentRuntimeChange={handleAgentRuntimeChange}
        onMainLlmModelSelectionChange={onMainLlmModelSelectionChange}
        onMainLlmProfileIdChange={onMainLlmProfileIdChange}
        onModelSelectionChange={onModelSelectionChange}
        onRemoveDroppedTextFile={droppedTextFilesApi.removeDroppedTextFile}
        onSubmit={(event) => {
          void droppedTextFilesApi.handleChatSubmit(event, handleSubmit);
        }}
        resolvedMainSelection={resolvedMainSelection}
        selectedAgentRuntime={selectedAgentRuntime}
        sessionUsage={sessionUsage}
        setDraft={setDraft}
        setShowApiKeySetupGuidance={setShowApiKeySetupGuidance}
        showTokenUsageIndicator={showTokenUsageIndicator}
        unavailableReasons={unavailableReasons}
        userDefinedProfiles={userDefinedProfiles}
        workspaceRoot={workspaceRoot}
      />
    </aside>
  );
}
