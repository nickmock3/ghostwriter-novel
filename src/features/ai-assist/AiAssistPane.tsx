import { siwcExecutionMessage } from "../siwc/useAiConnection";
import { useId, type ReactNode } from "react";
import { FiCpu } from "react-icons/fi";
import type { LlmProfileRoleAssignment } from "../ai-agent/llmProfiles";
import type { AvailableLlmProvider } from "../ai-agent/modelProvider";
import type { EditProposal } from "../edit-proposals/editProposalSchemas";
import type { LlmProfileWithAvailability } from "../ai-chat/chatModelSelection";
import { EditProposalCard } from "../edit-proposals/EditProposalCard";
import type { LlmProviderChoice } from "../settings/settingsStorage";
import { AiAssistList } from "./AiAssistList";
import { AiAssistManagementDialog } from "./AiAssistManagementDialog";
import { AiAssistModelControls } from "./AiAssistModelControls";
import {
  builtInAiAssists,
  type AiAssistDefinition,
  type AiAssistExecutionOption,
  type CustomAiAssistDefinition,
} from "./aiAssistContracts";
import type { AiAssistStandardModelSelection } from "./aiAssistModelSelection";
import {
  targetKindLabel,
  type AiAssistEditorTarget,
} from "./aiAssistPaneHelpers";
import type { AiAssistSaveInput } from "./useAiAssistDefinitions";
import { useAiAssistPaneState } from "./useAiAssistPaneState";

export type { AiAssistEditorTarget } from "./aiAssistPaneHelpers";
export type { AiAssistExecutionOption } from "./aiAssistContracts";

export type AiAssistPaneProps = {
  assists?: readonly AiAssistDefinition[];
  definitionsError?: string | null;
  executionOptions: AiAssistExecutionOption[];
  isDefinitionsLoading?: boolean;
  isExecutionOptionsLoading?: boolean;
  llmProfiles?: LlmProfileWithAvailability[];
  llmProviders?: LlmProviderChoice[];
  onUndo?: (proposal: EditProposal) => Promise<EditProposal>;
  onApply: (proposal: EditProposal) => Promise<EditProposal>;
  onDeleteAssist?: (assistId: string) => Promise<void>;
  onExecute: (input: {
    additionalInstruction?: string;
    assistId: string;
    executionOptionId: string;
    standardModelSelection?: AiAssistStandardModelSelection;
    target: AiAssistEditorTarget;
  }) => Promise<EditProposal>;
  onReject: (proposal: EditProposal) => Promise<EditProposal>;
  onSaveAssist?: (input: AiAssistSaveInput) => Promise<CustomAiAssistDefinition>;
  paneControls?: {
    paneCollapseControl?: ReactNode;
    paneLayoutResetControl?: ReactNode;
  };
  target: AiAssistEditorTarget | null;
  writingAssignment?: LlmProfileRoleAssignment;
};

export function AiAssistPane({
  assists = builtInAiAssists,
  definitionsError = null,
  executionOptions,
  isDefinitionsLoading = false,
  isExecutionOptionsLoading = false,
  llmProfiles = [],
  llmProviders = [],
  onUndo,
  onApply,
  onDeleteAssist,
  onExecute,
  onReject,
  onSaveAssist,
  paneControls,
  target,
  writingAssignment,
}: AiAssistPaneProps) {
  const tooltipIdBase = useId();
  const state = useAiAssistPaneState({
    assists,
    executionOptions,
    isExecutionOptionsLoading,
    llmProfiles,
    llmProviders,
    onUndo,
  onApply,
    onDeleteAssist,
    onExecute,
    onReject,
    onSaveAssist,
    target,
    writingAssignment,
  });

  return (
    <aside
      aria-label="AIアシスト"
      className="pane chat-pane ai-assist-pane"
      role="complementary"
    >
      <div className="pane-heading">
        <div className="ai-assist-heading">
          <span aria-hidden="true" className="ai-assist-heading-icon">
            <FiCpu />
          </span>
          <div className="ai-assist-heading-body">
            <h2>AIアシスト</h2>
          </div>
        </div>
        <div className="pane-heading-actions">
          {paneControls?.paneLayoutResetControl}
          {paneControls?.paneCollapseControl}
        </div>
      </div>

      <div className="ai-assist-scroll">
        <section aria-label="対象" className="ai-assist-target-meta" role="region">
          {target ? (
            <>
              <p className="ai-assist-target-kind">{targetKindLabel(target)}</p>
              <p className="ai-assist-target-path">{target.path}</p>
            </>
          ) : (
            <p className="ai-assist-target-empty">ファイルを開くと対象が表示されます。</p>
          )}
        </section>

        {state.blockReason ? <p className="ai-assist-block-reason">{state.blockReason}</p> : null}
        {state.modelBlockReason && state.connection.connection !== "chatgpt" ? (
          <p className="ai-assist-block-reason">{state.modelBlockReason}</p>
        ) : null}
        {definitionsError ? (
          <p className="ai-assist-definitions-error" role="status">
            {definitionsError}
          </p>
        ) : null}
        {isDefinitionsLoading ? (
          <p className="ai-assist-definitions-loading" role="status">
            カスタムアシストを読み込んでいます…
          </p>
        ) : null}

        <AiAssistList
          builtInAssists={state.builtInAssistList}
          canManageCustomAssists={state.canManageCustomAssists}
          customAssists={state.customAssistList}
          executingAssistId={state.executingAssistId}
          isBusy={state.isBusy}
          isExecutionBlocked={state.isExecutionBlocked}
          onExecute={(assistId) => {
            void state.handleExecute(assistId);
          }}
          onOpenManageDialog={() => state.setIsManageDialogOpen(true)}
          onPreviewAssist={state.handlePreviewAssist}
          onPreviewAssistEnd={state.handlePreviewAssistEnd}
          tooltipIdBase={tooltipIdBase}
        />

        {state.errorMessage ? (
          <div className="pane-error" role="alert">
            {state.connection.connection === "chatgpt" ? <>{siwcExecutionMessage(state.errorMessage)} <a href="/settings">ChatGPT接続設定</a></> : state.errorMessage}
          </div>
        ) : null}

        {state.currentProposal ? (
          <EditProposalCard
            canApply={Boolean(target) && !target?.isDirty && !state.isProposalMutating}
            canReject={!state.isProposalMutating}
            canUndo={Boolean(onUndo) && !target?.isDirty && !state.isProposalMutating}
            inlineDiffStrategy="lines"
            isTargetDirty={Boolean(target?.isDirty)}
            mode="editor"
            onApply={() => {
              void state.handleApply();
            }}
            onReject={() => {
              void state.handleReject();
            }}
            onUndo={() => { void state.handleUndo(); }}
            proposal={state.currentProposal}
          />
        ) : null}
      </div>

      <AiAssistModelControls
        connection={state.connection}
        additionalInstruction={state.additionalInstruction}
        blockReason={state.blockReason}
        chatModelValue={state.chatModelValue}
        executionOptions={executionOptions}
        instructionPlaceholder={state.instructionPlaceholder}
        isBusy={state.isBusy}
        isExecutionBlocked={state.isExecutionBlocked}
        llmProviders={llmProviders as AvailableLlmProvider[]}
        onAdditionalInstructionChange={state.setAdditionalInstruction}
        onExecutionOptionChange={state.setSelectedExecutionOptionId}
        onStandardModelChange={state.handleStandardModelChange}
        resolvedWritingSelection={state.resolvedWritingSelection}
        selectedExecutionOptionId={state.selectedExecutionOptionId}
        unavailableReasons={state.unavailableReasons}
        userDefinedProfiles={state.userDefinedProfiles}
      />

      {state.canManageCustomAssists && onSaveAssist && onDeleteAssist ? (
        <AiAssistManagementDialog
          customAssists={state.customAssistList}
          isDeleting={state.isDeletingAssist}
          isOpen={state.isManageDialogOpen}
          isSaving={state.isSavingAssist}
          onClose={() => state.setIsManageDialogOpen(false)}
          onDelete={state.handleDeleteAssist}
          onSave={state.handleSaveAssist}
        />
      ) : null}
    </aside>
  );
}
