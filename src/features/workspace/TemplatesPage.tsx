import { FiPlus } from "react-icons/fi";
import { TemplatesEditorPanel } from "./TemplatesEditorPanel";
import { TemplatesListPanel } from "./TemplatesListPanel";
import { useTemplatesPageController } from "./useTemplatesPageController";

export function TemplatesPage() {
  const controller = useTemplatesPageController();

  return (
    <section aria-label="テンプレート管理" className="templates-page">
      <div className="templates-page-header">
        <div>
          <h2>テンプレート管理</h2>
          <p>ワークスペースの初期構成を保存・複製・整理します。</p>
        </div>
        <button type="button" className="secondary-action" onClick={controller.handleCreateTemplate}>
          <FiPlus aria-hidden="true" focusable="false" />
          <span>新規テンプレート</span>
        </button>
      </div>
      {controller.errorMessage ? <p className="pane-error" role="alert">{controller.errorMessage}</p> : null}
      {controller.feedbackMessage ? <p className="template-feedback" role="status">{controller.feedbackMessage}</p> : null}
      <div className="templates-page-body">
        <TemplatesListPanel isLoading={controller.isLoading} onSelectTemplate={controller.selectTemplate} selectedTemplateId={controller.selectedTemplateId} templates={controller.templates} />
        <TemplatesEditorPanel canSave={controller.canSave} currentTemplate={controller.currentTemplate} isDeleting={controller.isDeleting} isSaving={controller.isSaving} onAddItem={controller.handleAddItem} onDelete={controller.handleDelete} onDeleteItem={controller.handleDeleteItem} onDuplicateBuiltIn={controller.handleDuplicateBuiltIn} onItemContentChange={controller.handleItemContentChange} onItemKindChange={controller.handleItemKindChange} onItemPathChange={controller.handleItemPathChange} onNameChange={controller.handleNameChange} onSave={controller.handleSave} validationIssues={controller.validationIssues} />
      </div>
    </section>
  );
}
