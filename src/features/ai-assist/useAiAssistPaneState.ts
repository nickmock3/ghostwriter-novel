import { z } from "zod";
import { aiAssistStandardModelSelectionSchema } from "./aiAssistModelSelection";
import { useAiConnection } from "../siwc/useAiConnection";
import { useEffect, useMemo, useState } from "react";
import type { LlmProfileRoleAssignment } from "../ai-agent/llmProfiles";
import type { EditProposal } from "../edit-proposals/editProposalSchemas";
import type { LlmProfileWithAvailability } from "../ai-chat/chatModelSelection";
import type { LlmProviderChoice } from "../settings/settingsStorage";
import {
  builtInAiAssists,
  type AiAssistDefinition,
  type AiAssistExecutionOption,
  type CustomAiAssistDefinition,
} from "./aiAssistContracts";
import {
  aiAssistModelSelectValue,
  isDefaultWritingModelValue,
  resolvedStandardModelSelection,
  standardSelectionFromModelValue,
  unavailableReasonForAiAssistModelSelection,
  type AiAssistStandardModelSelection,
} from "./aiAssistModelSelection";
import {
  executionBlockReason,
  modelSelectionBlockReason,
  resolveInstructionPlaceholder,
  type AiAssistEditorTarget,
} from "./aiAssistPaneHelpers";
import type { AiAssistSaveInput } from "./useAiAssistDefinitions";

const modelPreferencesSchema = z.object({
  standard: aiAssistStandardModelSelectionSchema,
});
const modelPreferencesKey = "ghostwriter:ai-assist-models:v1";
function readModelPreferences() {
  try {
    return modelPreferencesSchema.parse(JSON.parse(localStorage.getItem(modelPreferencesKey) ?? "null"));
  } catch { return { standard: { kind: "default-writing" as const } }; }
}

export type UseAiAssistPaneStateInput = {
  assists?: readonly AiAssistDefinition[];
  executionOptions: AiAssistExecutionOption[];
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
  target: AiAssistEditorTarget | null;
  writingAssignment?: LlmProfileRoleAssignment;
};

export function useAiAssistPaneState({
  assists = builtInAiAssists,
  executionOptions,
  isExecutionOptionsLoading = false,
  llmProfiles = [],
  llmProviders = [],
  onUndo,
  onApply,
  onDeleteAssist,
  onExecute,
  onReject,
  onSaveAssist,
  target,
  writingAssignment,
}: UseAiAssistPaneStateInput) {
  const [legacyExecutionOptionId, setLegacyExecutionOptionId] = useState(
    executionOptions[0]?.id ?? "standard",
  );
  const [standardModelSelection, setStandardModelSelection] =
    useState<AiAssistStandardModelSelection>(() => readModelPreferences().standard);
  function persistModels(standard: AiAssistStandardModelSelection) {
    try { localStorage.setItem(modelPreferencesKey, JSON.stringify({ standard })); } catch { /* optional storage */ }
  }
  const [additionalInstruction, setAdditionalInstruction] = useState("");
  const [activeAssistId, setActiveAssistId] = useState<string | null>(null);
  const [currentProposal, setCurrentProposal] = useState<EditProposal | null>(null);
  const [executingAssistId, setExecutingAssistId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProposalMutating, setIsProposalMutating] = useState(false);
  const [isManageDialogOpen, setIsManageDialogOpen] = useState(false);
  const [isSavingAssist, setIsSavingAssist] = useState(false);
  const [isDeletingAssist, setIsDeletingAssist] = useState(false);

  const builtInAssistList = assists.filter((assist) => assist.isBuiltIn);
  const customAssistList = assists.filter(
    (assist): assist is CustomAiAssistDefinition => !assist.isBuiltIn,
  );
  const canManageCustomAssists = Boolean(onSaveAssist && onDeleteAssist);
  const instructionPlaceholder = resolveInstructionPlaceholder(assists, activeAssistId);
  const connection = useAiConnection({ scope: "assist", providers: llmProviders,
    legacySelection: resolvedStandardModelSelection(standardModelSelection, llmProfiles, writingAssignment),
  });
  const selectedExecutionOptionId = connection.enabled || connection.hasExplicitConnection ? connection.connection === "codex" ? "codex" : connection.connection === "chatgpt" ? "chatgpt" : "standard" : legacyExecutionOptionId;
  function setSelectedExecutionOptionId(id: string) {
    setLegacyExecutionOptionId(id);
    connection.chooseConnection(id === "chatgpt" ? "chatgpt" : "api");
  }
  const selectedExecutionOption = executionOptions.find(
    (option) => option.id === selectedExecutionOptionId,
  );
  const userDefinedProfiles = llmProfiles.filter((profile) => profile.source === "user");
  const chatModelValue = useMemo(
    () =>
      aiAssistModelSelectValue({
        profiles: llmProfiles,
        standardModelSelection,
        writingAssignment,
      }),
    [llmProfiles, standardModelSelection, writingAssignment],
  );
  const resolvedWritingSelection = useMemo(
    () => resolvedStandardModelSelection(standardModelSelection, llmProfiles, writingAssignment),
    [llmProfiles, standardModelSelection, writingAssignment],
  );
  const unavailableReasons = useMemo(
    () =>
      unavailableReasonForAiAssistModelSelection({
        llmProfiles,
        llmProviders,
        standardModelSelection,
      }),
    [llmProfiles, llmProviders, standardModelSelection],
  );

  const blockReason = executionBlockReason(
    target,
    executionOptions,
    isExecutionOptionsLoading,
  );
  const modelBlockReason = connection.connection === "api" && resolvedWritingSelection?.providerId === "openai-chatgpt"
    ? "APIキー接続のモデルを選択してください。" : modelSelectionBlockReason({
    executionOption: selectedExecutionOption,
    standardModelSelection,
    unavailableReasons,
  });
  const isExecuting = executingAssistId !== null;
  const isBusy = isExecuting || isProposalMutating;
  const isExecutionBlocked = Boolean(blockReason || !selectedExecutionOption || (connection.connection !== "chatgpt" && modelBlockReason) || connection.blocked);

  useEffect(() => {
    if (connection.enabled || connection.hasExplicitConnection || executionOptions.length === 0) {
      return;
    }

    if (!executionOptions.some((option) => option.id === selectedExecutionOptionId)) {
      setSelectedExecutionOptionId(executionOptions[0]!.id);
    }
  }, [executionOptions, selectedExecutionOptionId, connection.enabled, connection.hasExplicitConnection]);

  useEffect(() => {
    setCurrentProposal(current => current?.status === "applied" && current.path === target?.path ? current : null);
    setErrorMessage(null);
  }, [target?.path, target?.content, target?.isDirty, target?.selection?.end, target?.selection?.start]);

  function handlePreviewAssist(assistId: string) {
    setActiveAssistId(assistId);
  }

  function handlePreviewAssistEnd(assistId: string, element: HTMLButtonElement) {
    if (element !== document.activeElement) {
      setActiveAssistId((current) => (current === assistId ? null : current));
    }
  }

  async function handleExecute(assistId: string) {
    if (!target || isExecutionBlocked || isBusy) {
      return;
    }

    setActiveAssistId(assistId);
    const trimmedInstruction = additionalInstruction.trim();
    setExecutingAssistId(assistId);
    setErrorMessage(null);

    try {
      const proposal = await onExecute({
        additionalInstruction: trimmedInstruction.length > 0 ? trimmedInstruction : undefined,
        assistId,
        executionOptionId: selectedExecutionOptionId,
        standardModelSelection: connection.connection === "chatgpt" && connection.selection ? { kind: "model", ...connection.selection } : standardModelSelection,
        target,
      });
      setCurrentProposal(proposal);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "AIアシストを実行できませんでした。");
    } finally {
      setExecutingAssistId(null);
    }
  }

  async function handleApply() {
    if (!currentProposal || !target || target.isDirty || isProposalMutating) {
      return;
    }

    setIsProposalMutating(true);
    setErrorMessage(null);

    try {
      const updated = await onApply(currentProposal);
      setCurrentProposal(updated);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "編集案を適用できませんでした。");
    } finally {
      setIsProposalMutating(false);
    }
  }

  async function handleUndo() {
    if (!onUndo || !currentProposal || !target || target.isDirty || isProposalMutating) return;
    setIsProposalMutating(true);
    setErrorMessage(null);
    try { setCurrentProposal(await onUndo(currentProposal)); }
    catch (error) { setErrorMessage(error instanceof Error ? error.message : "取り消せませんでした。"); }
    finally { setIsProposalMutating(false); }
  }

  async function handleReject() {
    if (!currentProposal || isProposalMutating) {
      return;
    }

    setIsProposalMutating(true);
    setErrorMessage(null);

    try {
      const updated = await onReject(currentProposal);
      setCurrentProposal(updated);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "編集案を拒否できませんでした。");
    } finally {
      setIsProposalMutating(false);
    }
  }

  async function handleSaveAssist(input: AiAssistSaveInput) {
    if (!onSaveAssist) {
      return;
    }

    setIsSavingAssist(true);
    try {
      await onSaveAssist(input);
    } finally {
      setIsSavingAssist(false);
    }
  }

  async function handleDeleteAssist(assistId: string) {
    if (!onDeleteAssist) {
      return;
    }

    setIsDeletingAssist(true);
    try {
      await onDeleteAssist(assistId);
    } finally {
      setIsDeletingAssist(false);
    }
  }

  function handleStandardModelChange(value: string) {
    const next: AiAssistStandardModelSelection = isDefaultWritingModelValue({ profiles: llmProfiles, value, writingAssignment })
      ? { kind: "default-writing" }
      : standardSelectionFromModelValue(value);
    setStandardModelSelection(next);
    persistModels(next);
  }

  return {
    connection,
    additionalInstruction,
    blockReason,
    builtInAssistList,
    canManageCustomAssists,
    chatModelValue,
    currentProposal,
    customAssistList,
    errorMessage,
    executingAssistId,
    handleApply,
    handleUndo,
    handleDeleteAssist,
    handleExecute,
    handlePreviewAssist,
    handlePreviewAssistEnd,
    handleReject,
    handleSaveAssist,
    handleStandardModelChange,
    instructionPlaceholder,
    isBusy,
    isDeletingAssist,
    isExecutionBlocked,
    isManageDialogOpen,
    isProposalMutating,
    isSavingAssist,
    modelBlockReason,
    resolvedWritingSelection,
    selectedExecutionOptionId,
    setAdditionalInstruction,
    setIsManageDialogOpen,
    setSelectedExecutionOptionId,
    unavailableReasons,
    userDefinedProfiles,
  };
}
