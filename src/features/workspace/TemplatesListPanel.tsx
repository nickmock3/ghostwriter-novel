import type { TemplateDraft } from "./templateDraftModel";

type TemplatesListPanelProps = {
  isLoading: boolean;
  onSelectTemplate: (template: TemplateDraft) => void;
  selectedTemplateId: string | null;
  templates: TemplateDraft[];
};

export function TemplatesListPanel({
  isLoading,
  onSelectTemplate,
  selectedTemplateId,
  templates,
}: TemplatesListPanelProps) {
  return (
    <aside className="templates-list-panel" aria-label="テンプレート一覧">
      <div className="templates-list-panel-heading">
        <h3>テンプレート一覧</h3>
      </div>
      <div className="templates-list">
        {isLoading ? <p className="templates-empty">読み込み中...</p> : null}
        {!isLoading && templates.length === 0 ? (
          <p className="templates-empty">テンプレートがありません。</p>
        ) : null}
        {templates.map((template) => {
          const isSelected = selectedTemplateId === template.id;

          return (
            <button
              aria-label={template.name}
              aria-current={isSelected ? "page" : undefined}
              className="template-list-button"
              key={template.id}
              type="button"
              onClick={() => onSelectTemplate(template)}
            >
              <span className="template-list-button-main">
                <span>{template.name}</span>
                {template.source === "built-in" ? <span className="template-badge">内蔵</span> : null}
              </span>
              <span className="template-list-button-meta">{template.items.length}項目</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
