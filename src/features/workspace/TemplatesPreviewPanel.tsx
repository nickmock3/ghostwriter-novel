import { FiFileText, FiFolder } from "react-icons/fi";
import { buildTemplatePreview, type TemplateDraft } from "./templateDraftModel";

type TemplatesPreviewPanelProps = {
  currentTemplate: TemplateDraft;
  validationIssues: string[];
};

export function TemplatesPreviewPanel({ currentTemplate, validationIssues }: TemplatesPreviewPanelProps) {
  const currentTemplatePreview = buildTemplatePreview(currentTemplate);

  return (
    <aside className="templates-preview-column" aria-label="テンプレート検証">
      <div className="templates-preview-section">
        <h4>検証</h4>
        {validationIssues.length === 0 ? (
          <p className="template-validation-ok">検証OK</p>
        ) : (
          <div className="template-validation-errors" role="alert">
            {validationIssues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </div>
        )}
      </div>

      <div className="templates-preview-section">
        <h4>作成予定ディレクトリ</h4>
        {currentTemplatePreview.plannedDirectories.length ? (
          <ul className="templates-preview-list">
            {currentTemplatePreview.plannedDirectories.map((path) => (
              <li key={path}>
                <FiFolder aria-hidden="true" focusable="false" />
                <span>{path}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="templates-empty">なし</p>
        )}
      </div>

      <div className="templates-preview-section">
        <h4>作成予定ファイル</h4>
        {currentTemplatePreview.plannedFiles.length ? (
          <ul className="templates-preview-list">
            {currentTemplatePreview.plannedFiles.map((path) => (
              <li key={path}>
                <FiFileText aria-hidden="true" focusable="false" />
                <span>{path}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="templates-empty">なし</p>
        )}
      </div>
    </aside>
  );
}
