import { useEffect, useId, useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import {
  AI_ASSIST_ADDITIONAL_INSTRUCTION_PLACEHOLDER_MAX_LENGTH,
  AI_ASSIST_DESCRIPTION_MAX_LENGTH,
  AI_ASSIST_FIXED_INSTRUCTION_MAX_LENGTH,
  AI_ASSIST_NAME_MAX_LENGTH,
  aiAssistResultTypeOptions,
  type AiAssistDefinitionInput,
  type AiAssistResultType,
  type CustomAiAssistDefinition,
} from "./aiAssistContracts";
import type { AiAssistSaveInput } from "./useAiAssistDefinitions";

type AiAssistManagementDialogProps = {
  customAssists: readonly CustomAiAssistDefinition[];
  isDeleting: boolean;
  isOpen: boolean;
  isSaving: boolean;
  onClose: () => void;
  onDelete: (assistId: string) => Promise<void>;
  onSave: (input: AiAssistSaveInput) => Promise<void>;
};

type FormState = {
  additionalInstructionPlaceholder: string;
  description: string;
  fixedInstruction: string;
  id?: string;
  name: string;
  resultType: AiAssistResultType;
};

const defaultResultType = aiAssistResultTypeOptions[0]?.value ?? "edit-proposal";

const emptyFormState = (): FormState => ({
  additionalInstructionPlaceholder: "",
  description: "",
  fixedInstruction: "",
  name: "",
  resultType: defaultResultType,
});

function toFormState(assist: CustomAiAssistDefinition): FormState {
  return {
    additionalInstructionPlaceholder: assist.additionalInstructionPlaceholder,
    description: assist.description,
    fixedInstruction: assist.fixedInstruction,
    id: assist.id,
    name: assist.name,
    resultType: assist.resultType,
  };
}

function validateForm(form: FormState): string | null {
  const name = form.name.trim();
  const fixedInstruction = form.fixedInstruction.trim();
  const description = form.description.trim();
  const additionalInstructionPlaceholder = form.additionalInstructionPlaceholder.trim();

  if (!name) {
    return "名前を入力してください。";
  }

  if (name.length > AI_ASSIST_NAME_MAX_LENGTH) {
    return `名前は${AI_ASSIST_NAME_MAX_LENGTH}文字以内で入力してください。`;
  }

  if (!fixedInstruction) {
    return "固定指示を入力してください。";
  }

  if (fixedInstruction.length > AI_ASSIST_FIXED_INSTRUCTION_MAX_LENGTH) {
    return `固定指示は${AI_ASSIST_FIXED_INSTRUCTION_MAX_LENGTH}文字以内で入力してください。`;
  }

  if (description.length > AI_ASSIST_DESCRIPTION_MAX_LENGTH) {
    return `説明は${AI_ASSIST_DESCRIPTION_MAX_LENGTH}文字以内で入力してください。`;
  }

  if (additionalInstructionPlaceholder.length > AI_ASSIST_ADDITIONAL_INSTRUCTION_PLACEHOLDER_MAX_LENGTH) {
    return `追加指示欄のプレースホルダーは${AI_ASSIST_ADDITIONAL_INSTRUCTION_PLACEHOLDER_MAX_LENGTH}文字以内で入力してください。`;
  }

  return null;
}

function toSaveInput(form: FormState): AiAssistDefinitionInput {
  return {
    additionalInstructionPlaceholder: form.additionalInstructionPlaceholder.trim(),
    description: form.description.trim(),
    fixedInstruction: form.fixedInstruction.trim(),
    name: form.name.trim(),
    resultType: form.resultType,
    targetType: "text",
  };
}

export function AiAssistManagementDialog({
  customAssists,
  isDeleting,
  isOpen,
  isSaving,
  onClose,
  onDelete,
  onSave,
}: AiAssistManagementDialogProps) {
  const formId = useId();
  const [form, setForm] = useState<FormState>(emptyFormState);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setForm(emptyFormState());
    setValidationError(null);
    setActionError(null);
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const isBusy = isSaving || isDeleting;
  const validationMessage = validationError ?? validateForm(form);
  const canSave = validationMessage === null && !isBusy;
  const selectedResultTypeOption = aiAssistResultTypeOptions.find(
    (option) => option.value === form.resultType,
  );

  function startNewForm() {
    setForm(emptyFormState());
    setValidationError(null);
    setActionError(null);
  }

  function startEdit(assist: CustomAiAssistDefinition) {
    setForm(toFormState(assist));
    setValidationError(null);
    setActionError(null);
  }

  async function handleSave() {
    const message = validateForm(form);
    if (message) {
      setValidationError(message);
      return;
    }

    setValidationError(null);
    setActionError(null);

    try {
      await onSave({
        ...toSaveInput(form),
        ...(form.id ? { id: form.id } : {}),
      });
      startNewForm();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "AIアシストの保存に失敗しました。");
    }
  }

  async function handleDelete(assist: CustomAiAssistDefinition) {
    setActionError(null);

    try {
      await onDelete(assist.id);
      if (form.id === assist.id) {
        startNewForm();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "AIアシストの削除に失敗しました。");
    }
  }

  return (
    <div className="ai-assist-manage-backdrop">
      <section
        aria-labelledby={`${formId}-title`}
        aria-modal="true"
        className="ai-assist-manage-dialog"
        role="dialog"
      >
        <header className="ai-assist-manage-header">
          <h3 id={`${formId}-title`}>カスタムアシスト管理</h3>
          <button
            aria-label="閉じる"
            className="ai-assist-manage-close"
            disabled={isBusy}
            onClick={onClose}
            type="button"
          >
            閉じる
          </button>
        </header>

        <div className="ai-assist-manage-body">
          <section aria-label="カスタムアシスト一覧" className="ai-assist-manage-list-section">
            <div className="ai-assist-manage-list-actions">
              <button
                className="secondary-action ai-assist-manage-new"
                disabled={isBusy}
                onClick={startNewForm}
                type="button"
              >
                新規作成
              </button>
            </div>
            {customAssists.length === 0 ? (
              <p className="ai-assist-manage-empty">カスタムアシストはまだありません。</p>
            ) : (
              <ul className="ai-assist-manage-list">
                {customAssists.map((assist) => (
                  <li key={assist.id}>
                    <span className="ai-assist-manage-list-name">{assist.name}</span>
                    <div className="ai-assist-manage-list-buttons">
                      <button
                        aria-label={`${assist.name}を編集`}
                        className="secondary-action"
                        disabled={isBusy}
                        onClick={() => startEdit(assist)}
                        type="button"
                      >
                        編集
                      </button>
                      <button
                        aria-label={`${assist.name}を削除`}
                        className="icon-action ai-assist-manage-delete"
                        disabled={isBusy}
                        onClick={() => {
                          void handleDelete(assist);
                        }}
                        type="button"
                      >
                        <FiTrash2 aria-hidden="true" focusable="false" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <form
            className="ai-assist-manage-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <label className="ai-assist-manage-field">
              <span>名前</span>
              <input
                aria-label="名前"
                className="ai-assist-manage-input"
                disabled={isBusy}
                maxLength={AI_ASSIST_NAME_MAX_LENGTH}
                onChange={(event) => {
                  setForm((current) => ({ ...current, name: event.target.value }));
                  setValidationError(null);
                }}
                required
                type="text"
                value={form.name}
              />
            </label>

            <label className="ai-assist-manage-field">
              <span>説明</span>
              <textarea
                aria-label="説明"
                className="ai-assist-manage-textarea"
                disabled={isBusy}
                maxLength={AI_ASSIST_DESCRIPTION_MAX_LENGTH}
                onChange={(event) => {
                  setForm((current) => ({ ...current, description: event.target.value }));
                  setValidationError(null);
                }}
                rows={2}
                value={form.description}
              />
            </label>

            <label className="ai-assist-manage-field">
              <span>固定指示</span>
              <textarea
                aria-label="固定指示"
                className="ai-assist-manage-textarea"
                disabled={isBusy}
                maxLength={AI_ASSIST_FIXED_INSTRUCTION_MAX_LENGTH}
                onChange={(event) => {
                  setForm((current) => ({ ...current, fixedInstruction: event.target.value }));
                  setValidationError(null);
                }}
                required
                rows={4}
                value={form.fixedInstruction}
              />
            </label>

            <label className="ai-assist-manage-field">
              <span>対象種別</span>
              <input
                aria-label="対象種別"
                className="ai-assist-manage-readonly"
                readOnly
                type="text"
                value="text"
              />
            </label>

            <label className="ai-assist-manage-field">
              <span>結果種別</span>
              <select
                aria-label="結果種別"
                className="ai-assist-manage-input"
                disabled={isBusy}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    resultType: event.target.value as AiAssistResultType,
                  }));
                  setValidationError(null);
                }}
                value={form.resultType}
              >
                {aiAssistResultTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {selectedResultTypeOption ? (
                <p className="ai-assist-manage-field-description">
                  {selectedResultTypeOption.description}
                </p>
              ) : null}
            </label>

            <label className="ai-assist-manage-field">
              <span>追加指示欄のプレースホルダー</span>
              <input
                aria-label="追加指示欄のプレースホルダー"
                className="ai-assist-manage-input"
                disabled={isBusy}
                maxLength={AI_ASSIST_ADDITIONAL_INSTRUCTION_PLACEHOLDER_MAX_LENGTH}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    additionalInstructionPlaceholder: event.target.value,
                  }));
                  setValidationError(null);
                }}
                type="text"
                value={form.additionalInstructionPlaceholder}
              />
            </label>

            {validationMessage && !canSave ? (
              <p className="ai-assist-manage-validation" role="alert">
                {validationMessage}
              </p>
            ) : null}
            {actionError ? (
              <p className="pane-error" role="alert">
                {actionError}
              </p>
            ) : null}

            <div className="ai-assist-manage-form-actions">
              <button
                className="secondary-action"
                disabled={isBusy}
                onClick={onClose}
                type="button"
              >
                キャンセル
              </button>
              <button className="primary-action" disabled={!canSave} type="submit">
                {isSaving ? "保存中…" : "保存"}
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
