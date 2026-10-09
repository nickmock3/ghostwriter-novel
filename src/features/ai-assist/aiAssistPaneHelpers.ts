import type { EditorTarget } from "../editor/editorTarget";
import type { AiAssistDefinition, AiAssistExecutionOption } from "./aiAssistContracts";
import { type AiAssistStandardModelSelection } from "./aiAssistModelSelection";

export const defaultInstructionPlaceholder = "追加指示（任意）";

export function targetKindLabel(target: EditorTarget): string {
  if (!target.selection) {
    return "ファイル全体";
  }

  const length = target.selection.end - target.selection.start;
  return `選択範囲（${length}文字）`;
}

export function executionBlockReason(
  target: EditorTarget | null,
  executionOptions: AiAssistExecutionOption[],
  isExecutionOptionsLoading: boolean,
): string | null {
  if (!target) {
    return "ファイルを開いてください。";
  }

  if (target.isDirty) {
    return "先に保存または変更を破棄してください。";
  }

  if (target.content.length === 0) {
    return "対象にできる本文がありません。";
  }

  if (isExecutionOptionsLoading) {
    return "実行方式を確認しています…";
  }

  if (executionOptions.length === 0) {
    return "利用可能なモデルがありません。";
  }

  return null;
}

export function modelSelectionBlockReason(input: {
  executionOption: AiAssistExecutionOption | undefined;
  standardModelSelection: AiAssistStandardModelSelection;
  unavailableReasons: Array<{ id: string; reason: string }>;
}): string | null {
  if (input.unavailableReasons.length > 0) {
    return input.unavailableReasons[0]?.reason ?? "選択したモデルは利用できません。";
  }

  return null;
}

export function resolveInstructionPlaceholder(
  assists: readonly AiAssistDefinition[],
  activeAssistId: string | null,
): string {
  if (!activeAssistId) {
    return defaultInstructionPlaceholder;
  }

  const activeAssist = assists.find((assist) => assist.id === activeAssistId);
  if (!activeAssist || activeAssist.isBuiltIn) {
    return defaultInstructionPlaceholder;
  }

  const placeholder = activeAssist.additionalInstructionPlaceholder?.trim();
  return placeholder && placeholder.length > 0 ? placeholder : defaultInstructionPlaceholder;
}
