import { FiCheckCircle, FiCopy, FiPlus, FiTrash2 } from "react-icons/fi";
import {
  emptyTemplateNotice,
  templateItemKey,
  type TemplateDraft,
  type WorkspaceTemplateItemKind,
} from "./templateDraftModel";
import { TemplatesPreviewPanel } from "./TemplatesPreviewPanel";

type TemplatesEditorPanelProps = {
  canSave: boolean;
  currentTemplate: TemplateDraft | null;
  isDeleting: boolean;
  isSaving: boolean;
  onAddItem: () => void;
  onDelete: () => void;
  onDeleteItem: (itemId: string) => void;
  onDuplicateBuiltIn: () => void;
  onItemContentChange: (itemId: string, content: string) => void;
  onItemKindChange: (itemId: string, kind: WorkspaceTemplateItemKind) => void;
  onItemPathChange: (itemId: string, path: string) => void;
  onNameChange: (name: string) => void;
  onSave: () => void;
  validationIssues: string[];
};

export function TemplatesEditorPanel({
  canSave,
  currentTemplate,
  isDeleting,
  isSaving,
  onAddItem,
  onDelete,
  onDeleteItem,
  onDuplicateBuiltIn,
  onItemContentChange,
  onItemKindChange,
  onItemPathChange,
  onNameChange,
  onSave,
  validationIssues,
}: TemplatesEditorPanelProps) {
  return (
    <section className="templates-editor-panel" aria-label="テンプレート編集">
      {currentTemplate ? (
        <>
          <div className="templates-editor-heading">
            <div className="templates-editor-title">
              <h3>{currentTemplate.name}</h3>
              {currentTemplate.source === "built-in" ? (
                <span className="template-badge template-badge-large">アプリ内定義</span>
              ) : null}
            </div>
            <div className="templates-editor-actions">
              {currentTemplate.source === "built-in" ? (
                <button
                  type="button"
                  className="secondary-action"
                  disabled={isSaving}
                  onClick={() => {
                    void onDuplicateBuiltIn();
                  }}
                >
                  <FiCopy aria-hidden="true" focusable="false" />
                  <span>内蔵テンプレートを複製</span>
                </button>
              ) : null}
              {currentTemplate.source === "user" ? (
                <button
                  type="button"
                  className="secondary-action"
                  disabled={!canSave}
                  onClick={() => {
                    void onSave();
                  }}
                >
                  <FiCheckCircle aria-hidden="true" focusable="false" />
                  <span>保存</span>
                </button>
              ) : null}
              {currentTemplate.source === "user" ? (
                <button
                  type="button"
                  className="secondary-action"
                  disabled={isDeleting}
                  onClick={() => {
                    void onDelete();
                  }}
                >
                  <FiTrash2 aria-hidden="true" focusable="false" />
                  <span>削除</span>
                </button>
              ) : null}
            </div>
          </div>

          <div className="templates-editor-grid">
            <div className="templates-form-column">
              <label className="templates-field">
                <span>テンプレート名</span>
                <input
                  aria-label="テンプレート名"
                  disabled={currentTemplate.source === "built-in"}
                  onChange={(event) => onNameChange(event.target.value)}
                  value={currentTemplate.name}
                />
              </label>

              <div className="templates-entries-toolbar">
                <button
                  type="button"
                  className="secondary-action"
                  disabled={currentTemplate.source === "built-in"}
                  onClick={onAddItem}
                >
                  <FiPlus aria-hidden="true" focusable="false" />
                  <span>項目を追加</span>
                </button>
                <p className="templates-helper">
                  APIキーなどの秘密情報はテンプレート本文に保存しないでください。
                </p>
              </div>

              <div className="templates-entries">
                {currentTemplate.items.length === 0 ? (
                  <p className="templates-empty">項目はまだありません。</p>
                ) : null}

                {currentTemplate.items.map((item, index) => {
                  const itemNumber = index + 1;
                  const isBuiltIn = currentTemplate.source === "built-in";

                  return (
                    <article className="template-item" key={templateItemKey(item)}>
                      <div className="template-item-header">
                        <label className="templates-field template-kind-field">
                          <span>種別 {itemNumber}</span>
                          <select
                            aria-label={`項目 ${itemNumber} の種類`}
                            disabled={isBuiltIn}
                            onChange={(event) => {
                              onItemKindChange(item.id, event.target.value as WorkspaceTemplateItemKind);
                            }}
                            value={item.kind}
                          >
                            <option value="directory">ディレクトリ</option>
                            <option value="file">ファイル</option>
                          </select>
                        </label>
                        <button
                          type="button"
                          className="secondary-action template-item-delete"
                          disabled={isBuiltIn}
                          onClick={() => onDeleteItem(item.id)}
                        >
                          <FiTrash2 aria-hidden="true" focusable="false" />
                          <span>{`項目 ${itemNumber} を削除`}</span>
                        </button>
                      </div>

                      {item.kind === "directory" ? (
                        <label className="templates-field">
                          <span>{`ディレクトリ ${itemNumber}`}</span>
                          <input
                            aria-label={`ディレクトリ ${itemNumber}`}
                            disabled={isBuiltIn}
                            onChange={(event) => onItemPathChange(item.id, event.target.value)}
                            value={item.path}
                          />
                        </label>
                      ) : (
                        <>
                          <label className="templates-field">
                            <span>{`ファイルパス ${itemNumber}`}</span>
                            <input
                              aria-label={`ファイルパス ${itemNumber}`}
                              disabled={isBuiltIn}
                              onChange={(event) => onItemPathChange(item.id, event.target.value)}
                              value={item.path}
                            />
                          </label>
                          <label className="templates-field">
                            <span>{`ファイル本文 ${itemNumber}`}</span>
                            <textarea
                              aria-label={`ファイル本文 ${itemNumber}`}
                              disabled={isBuiltIn}
                              onChange={(event) => onItemContentChange(item.id, event.target.value)}
                              rows={5}
                              value={item.content}
                            />
                          </label>
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>

            <TemplatesPreviewPanel currentTemplate={currentTemplate} validationIssues={validationIssues} />
          </div>
        </>
      ) : (
        <p className="templates-empty">{emptyTemplateNotice(currentTemplate)}</p>
      )}
    </section>
  );
}
