import type { EditorTarget } from "../features/editor/editorTarget";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { FiChevronsLeft, FiChevronsRight } from "react-icons/fi";
import { FaUndo } from "react-icons/fa";
import { AiAssistPane } from "../features/ai-assist/AiAssistPane";
import {
  applyAiAssistProposal,
  executeAiAssist,
  rejectAiAssistProposal,
} from "../features/ai-assist/aiAssistClient";
import { useAiAssistDefinitions } from "../features/ai-assist/useAiAssistDefinitions";
import type { AvailableLlmProvider } from "../features/llm/modelProvider";
import { useAiAssistExecutionOptions } from "../features/ai-assist/useAiAssistExecutionOptions";
import { EditorPane } from "../features/editor/EditorPane";
import { FileTreePane } from "../features/file-tree/FileTreePane";
import { StartGuideModal } from "../features/workspace/StartGuideModal";
import { useEditorSessionContext } from "./EditorSessionContext";
import { useLlmSettingsContext } from "./LlmSettingsContext";
import { usePaneLayoutContext } from "./PaneLayoutContext";
import { useWorkspaceContext } from "./WorkspaceContext";

export function EditorRoutePage() {
  const navigate = useNavigate();
  const {
    dismissStartGuide,
    handleStartGuideIdeaConsult,
    showStartGuide,
    workspaceRoot,
  } = useWorkspaceContext();
  const {
    consumeEditorSelectionJumpRequest,
    dirtyPaths,
    editorSelectionJumpRequest,
    editorRefreshKey,
    fileSession,
    fileTreeRefreshKey,
    handleAppliedEdit,
    handleDirtyStateChange,
    handleFileOperation,
    selectedPath,
    setDirtyPaths,
    setSelectedPath,
  } = useEditorSessionContext();
  const {
    handleCollapseLeftPane,
    handleCollapseRightPane,
    handleResetPaneWidths,
    handleResizeStart,
    handleRestoreLeftPane,
    handleRestoreRightPane,
    isLeftPaneCollapsed,
    isPaneResizeDragging,
    isRightPaneCollapsed,
    layoutRef,
    paneWidths,
    threePaneLayoutStyle,
  } = usePaneLayoutContext();
  const { llmProfileSettings, llmProfiles, llmProviders, settings } = useLlmSettingsContext();
  const [aiAssistTarget, setAiAssistTarget] = useState<EditorTarget | null>(null);
  const { executionOptions, isLoading: isExecutionOptionsLoading } = useAiAssistExecutionOptions({
    llmProfileSettings,
    llmProfiles,
    llmProviders: llmProviders as AvailableLlmProvider[],
  });
  const {
    assists,
    deleteAssist,
    error: definitionsError,
    isLoading: isDefinitionsLoading,
    saveAssist,
  } = useAiAssistDefinitions();

  const handleAiAssistTargetChange = useCallback((next: EditorTarget | null) => {
    setAiAssistTarget((current) => {
      if (current === next) {
        return current;
      }
      if (!current || !next) {
        return next;
      }

      const currentSelection = current.selection;
      const nextSelection = next.selection;
      const selectionIsEqual =
        currentSelection === nextSelection ||
        (currentSelection !== null &&
          nextSelection !== null &&
          currentSelection.start === nextSelection.start &&
          currentSelection.end === nextSelection.end);

      return current.content === next.content &&
        current.isDirty === next.isDirty &&
        current.path === next.path &&
        selectionIsEqual
        ? current
        : next;
    });
  }, []);

  const handleExecute = useCallback(
    async (input: {
      additionalInstruction?: string;
      assistId: string;
      executionOptionId: string;
      standardModelSelection?: Parameters<typeof executeAiAssist>[0]["standardModelSelection"];
      target: EditorTarget;
    }) => {
      if (!workspaceRoot) {
        throw new Error("ワークスペースが選択されていません。");
      }

      return executeAiAssist({
        ...input,
        executionOptions,
        roleAssignments: llmProfileSettings?.roleAssignments,
        userProfiles: llmProfileSettings?.userProfiles,
        workspaceRoot,
      });
    },
    [executionOptions, llmProfileSettings, workspaceRoot],
  );

  const handleApply = useCallback(
    async (proposal: Parameters<typeof applyAiAssistProposal>[0]["proposal"]) => {
      if (!workspaceRoot) {
        throw new Error("ワークスペースが選択されていません。");
      }

      const updated = await applyAiAssistProposal({
        dirtyPaths,
        proposal,
        workspaceRoot,
      });
      if (updated.status === "applied") {
        handleAppliedEdit({ operation: updated.operation, path: updated.path });
      }
      return updated;
    },
    [dirtyPaths, handleAppliedEdit, workspaceRoot],
  );

  const handleUndo = useCallback(async (proposal: Parameters<typeof applyAiAssistProposal>[0]["proposal"]) => {
    if (!workspaceRoot) throw new Error("ワークスペースが選択されていません。");
    const updated = await applyAiAssistProposal({ action: "undo", dirtyPaths, proposal, workspaceRoot });
    if (updated.status === "undone") handleAppliedEdit({ operation: updated.operation, path: updated.path });
    return updated;
  }, [dirtyPaths, handleAppliedEdit, workspaceRoot]);

  const handleReject = useCallback(
    async (proposal: Parameters<typeof rejectAiAssistProposal>[0]["proposal"]) => {
      if (!workspaceRoot) {
        throw new Error("ワークスペースが選択されていません。");
      }

      return rejectAiAssistProposal({ proposal, workspaceRoot });
    },
    [workspaceRoot],
  );

  const handleIdeaConsult = useCallback(() => {
    handleStartGuideIdeaConsult();
    void navigate({ to: "/chat" });
  }, [handleStartGuideIdeaConsult, navigate]);

  const collapseControl = (
    <button
      type="button"
      className="icon-action left-pane-collapse-button"
      aria-label="左ペインを折りたたむ"
      title="左ペインを折りたたむ"
      onClick={handleCollapseLeftPane}
    >
      <FiChevronsLeft aria-hidden="true" focusable="false" />
    </button>
  );
  const fileTreeRestoreControl = isLeftPaneCollapsed ? (
    <button
      type="button"
      className="icon-action left-pane-restore-button"
      aria-label="左ペインを表示"
      title="左ペインを表示"
      onClick={handleRestoreLeftPane}
    >
      <FiChevronsRight aria-hidden="true" focusable="false" />
    </button>
  ) : null;
  const aiAssistPaneCollapseControl = (
    <button
      type="button"
      className="icon-action right-pane-collapse-button"
      aria-label="右ペインを折りたたむ"
      title="右ペインを折りたたむ"
      onClick={handleCollapseRightPane}
    >
      <FiChevronsRight aria-hidden="true" focusable="false" />
    </button>
  );
  const aiAssistPaneRestoreControl = isRightPaneCollapsed ? (
    <button
      type="button"
      className="icon-action right-pane-restore-button"
      aria-label="右ペインを表示"
      title="右ペインを表示"
      onClick={handleRestoreRightPane}
    >
      <FiChevronsLeft aria-hidden="true" focusable="false" />
    </button>
  ) : null;

  return (
    <section
      ref={layoutRef}
      className="three-pane-layout"
      aria-label="エディターワークスペース"
      data-left-pane-collapsed={isLeftPaneCollapsed ? "true" : undefined}
      data-right-pane-collapsed={isRightPaneCollapsed ? "true" : undefined}
      {...(threePaneLayoutStyle ? { style: threePaneLayoutStyle } : {})}
    >
      {isRightPaneCollapsed ? null : (
        <div className="pane-resize-control" data-dragging={isPaneResizeDragging ? "true" : undefined}>
          <div
            aria-label="中央ペインとAIアシストの幅を調整"
            aria-orientation="vertical"
            className="pane-resize-handle"
            role="separator"
            onPointerDown={handleResizeStart}
          />
        </div>
      )}
      {isLeftPaneCollapsed ? null : (
        <FileTreePane
          collapseControl={collapseControl}
          dirtyPaths={dirtyPaths}
          onFileOperation={handleFileOperation}
          refreshKey={fileTreeRefreshKey}
          showNoisyDirectories={settings.showNoisyDirectories}
          workspaceRoot={workspaceRoot}
          selectedPath={selectedPath}
          onFileSelected={(path) => {
            setSelectedPath(path);
            setDirtyPaths([]);
          }}
        />
      )}
      <EditorPane
        aiAssistPaneRestoreControl={aiAssistPaneRestoreControl}
        fileSession={fileSession}
        fileTreeRestoreControl={fileTreeRestoreControl}
        onActivePathChange={setSelectedPath}
        onAiAssistTargetChange={handleAiAssistTargetChange}
        onDirtyStateChange={handleDirtyStateChange}
        refreshKey={editorRefreshKey}
        selectionRequest={editorSelectionJumpRequest}
        onSelectionRequestConsumed={consumeEditorSelectionJumpRequest}
        showLineNumbers={settings.showEditorLineNumbers}
        wrapLines={settings.wrapEditorLines}
        workspaceRoot={workspaceRoot}
        selectedPath={selectedPath}
      />
      {isRightPaneCollapsed ? null : (
        <AiAssistPane
          assists={assists}
          definitionsError={definitionsError}
          executionOptions={executionOptions}
          isDefinitionsLoading={isDefinitionsLoading}
          isExecutionOptionsLoading={isExecutionOptionsLoading}
          llmProfiles={llmProfiles}
          llmProviders={llmProviders}
          onApply={handleApply}
          onUndo={handleUndo}
          onDeleteAssist={deleteAssist}
          onExecute={handleExecute}
          onReject={handleReject}
          onSaveAssist={saveAssist}
          paneControls={{
            paneCollapseControl: aiAssistPaneCollapseControl,
            paneLayoutResetControl:
              paneWidths ? (
                <button
                  type="button"
                  className="icon-action pane-layout-reset-button"
                  aria-label="中央ペインとAIアシストの幅をリセット"
                  title="中央ペインとAIアシストの幅をリセット"
                  onClick={handleResetPaneWidths}
                >
                  <FaUndo aria-hidden="true" focusable="false" />
                </button>
              ) : null,
          }}
          target={aiAssistTarget}
          writingAssignment={llmProfileSettings?.roleAssignments.writing}
        />
      )}
      {showStartGuide && workspaceRoot ? (
        <StartGuideModal
          siwcEnabled={llmProviders.some(provider => provider.id === "openai-chatgpt")}
          onDismiss={dismissStartGuide}
          onIdeaConsult={handleIdeaConsult}
          onOpenPath={setSelectedPath}
          workspaceRoot={workspaceRoot}
        />
      ) : null}
    </section>
  );
}
