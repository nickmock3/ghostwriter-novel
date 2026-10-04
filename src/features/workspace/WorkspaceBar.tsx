import { useState } from "react";
import { getWorkspaceFolderName } from "./workspaceFolderName";
import {
  applyWorkspaceTemplate,
  listWorkspaceTemplates,
  pickWorkspaceRoot,
  validateWorkspaceRoot,
} from "./workspaceClientWorkflow";
import {
  chatModeNovelWorkspaceTemplateId,
  type WorkspaceTemplate,
} from "./workspaceTemplateContracts";

type WorkspaceBarProps = {
  chatMode?: boolean;
  compactWhenUnselected?: boolean;
  onTemplateApplied?(): void;
  workspaceRoot: string | null;
  onWorkspaceSelected(
    workspaceRoot: string,
    options?: { showStartGuide?: boolean; suppressStartGuide?: boolean },
  ): void;
};

function isNativePickerImplementationDetail(message: string) {
  return /osascript|powershell|Add-Type|System\.Windows\.Forms|\.NET|stack/i.test(
    message,
  );
}

type WorkspaceTemplateOption = WorkspaceTemplate;

type NewWorkspaceStartMode = "empty" | string;

export function WorkspaceBar({
  chatMode = false,
  compactWhenUnselected = false,
  onTemplateApplied,
  workspaceRoot,
  onWorkspaceSelected,
}: WorkspaceBarProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [manualWorkspaceRoot, setManualWorkspaceRoot] = useState("");
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [isManualOpening, setIsManualOpening] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [newWorkspaceTemplateOptions, setNewWorkspaceTemplateOptions] = useState<
    WorkspaceTemplateOption[] | null
  >(null);
  const [newWorkspaceStartMode, setNewWorkspaceStartMode] =
    useState<NewWorkspaceStartMode | null>(null);
  const [chatNewNovelManualFallback, setChatNewNovelManualFallback] = useState(false);

  const showManualWorkspaceControls =
    (!workspaceRoot || errorMessage) &&
    (!compactWhenUnselected || chatNewNovelManualFallback);

  const selectedNewWorkspaceTemplate =
    newWorkspaceStartMode && newWorkspaceStartMode !== "empty"
      ? (newWorkspaceTemplateOptions?.find((template) => template.id === newWorkspaceStartMode) ?? null)
      : null;
  const selectedNewWorkspaceTemplateDirectories =
    selectedNewWorkspaceTemplate?.items.filter((item) => item.kind === "directory") ?? [];
  const selectedNewWorkspaceTemplateFiles =
    selectedNewWorkspaceTemplate?.items.filter((item) => item.kind === "file") ?? [];

  async function selectWorkspace() {
    setIsSelecting(true);
    setErrorMessage(null);
    setErrorDetail(null);

    try {
      const selectedWorkspaceRoot = await pickWorkspaceRoot();
      if (selectedWorkspaceRoot !== null) {
        onWorkspaceSelected(selectedWorkspaceRoot);
      }
    } catch (error) {
      setErrorMessage("ワークスペースを開けませんでした。絶対パスを確認してください。");
      setErrorDetail(
        error instanceof Error && !isNativePickerImplementationDetail(error.message)
          ? error.message
          : null,
      );
    } finally {
      setIsSelecting(false);
    }
  }

  async function applyChatModeNovelTemplate(validatedWorkspaceRoot: string) {
    await applyWorkspaceTemplate({
      templateId: chatModeNovelWorkspaceTemplateId,
      workspaceRoot: validatedWorkspaceRoot,
    });
    setChatNewNovelManualFallback(false);
    onWorkspaceSelected(validatedWorkspaceRoot, { suppressStartGuide: true });
    onTemplateApplied?.();
  }

  async function openManualWorkspace() {
    const requestedWorkspaceRoot = manualWorkspaceRoot.trim();
    if (!requestedWorkspaceRoot) {
      return;
    }

    setIsManualOpening(true);
    setErrorMessage(null);
    setErrorDetail(null);

    try {
      const validatedWorkspaceRoot = await validateWorkspaceRoot(requestedWorkspaceRoot);

      if (chatNewNovelManualFallback) {
        await applyChatModeNovelTemplate(validatedWorkspaceRoot);
      } else {
        onWorkspaceSelected(validatedWorkspaceRoot);
      }

      setManualWorkspaceRoot(validatedWorkspaceRoot);
    } catch (error) {
      if (chatNewNovelManualFallback) {
        setErrorMessage(
          "新しい小説を始められませんでした。空のフォルダを選ぶか、別のフォルダを選び直してください。",
        );
      } else {
        setErrorMessage("ワークスペースを開けませんでした。絶対パスを確認してください。");
        setErrorDetail(error instanceof Error ? error.message : null);
      }
    } finally {
      setIsManualOpening(false);
    }
  }

  async function openNewWorkspaceTemplateSelection() {
    setIsCreatingWorkspace(true);
    setErrorMessage(null);
    setErrorDetail(null);

    try {
      const templates = await listWorkspaceTemplates();
      const defaultTemplateId =
        templates.find((template) => template.source === "built-in")?.id ??
        templates[0]?.id ??
        null;
      setNewWorkspaceTemplateOptions(templates);
      setNewWorkspaceStartMode(defaultTemplateId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "テンプレート一覧の取得に失敗しました",
      );
    } finally {
      setIsCreatingWorkspace(false);
    }
  }

  async function startNewNovelInChatMode() {
    setIsCreatingWorkspace(true);
    setErrorMessage(null);
    setErrorDetail(null);
    setChatNewNovelManualFallback(false);

    try {
      const selectedWorkspaceRoot = await pickWorkspaceRoot();
      if (selectedWorkspaceRoot === null) {
        return;
      }

      await applyChatModeNovelTemplate(selectedWorkspaceRoot);
    } catch {
      setChatNewNovelManualFallback(true);
      setErrorMessage(
        "新しい小説を始められませんでした。空のフォルダを選ぶか、別のフォルダを選び直してください。",
      );
    } finally {
      setIsCreatingWorkspace(false);
    }
  }

  async function createNewWorkspaceWithSelection() {
    if (!newWorkspaceStartMode) {
      return;
    }

    setIsCreatingWorkspace(true);
    setErrorMessage(null);
    setErrorDetail(null);

    try {
      const selectedWorkspaceRoot = await pickWorkspaceRoot();
      if (selectedWorkspaceRoot === null) {
        return;
      }

      if (newWorkspaceStartMode === "empty") {
        setNewWorkspaceTemplateOptions(null);
        setNewWorkspaceStartMode(null);
        onWorkspaceSelected(selectedWorkspaceRoot, { suppressStartGuide: true });
        return;
      }

      const selectedTemplate = newWorkspaceTemplateOptions?.find(
        (template) => template.id === newWorkspaceStartMode,
      );
      if (!selectedTemplate) {
        throw new Error("テンプレートの選択内容を確認できませんでした。");
      }

      await applyWorkspaceTemplate({
        templateId: selectedTemplate.id,
        workspaceRoot: selectedWorkspaceRoot,
      });
      setNewWorkspaceTemplateOptions(null);
      setNewWorkspaceStartMode(null);
      onWorkspaceSelected(selectedWorkspaceRoot, { showStartGuide: true });
      onTemplateApplied?.();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "新しいワークスペースを準備できませんでした。別のフォルダを選び直してください。",
      );
    } finally {
      setIsCreatingWorkspace(false);
    }
  }

  function closeNewWorkspaceTemplateSelection() {
    setNewWorkspaceTemplateOptions(null);
    setNewWorkspaceStartMode(null);
  }

  return (
    <header className="workspace-bar">
      <img className="workspace-brand-mark" src="/favicon.png" alt="" />
      <div className="workspace-summary">
        <h1 title={workspaceRoot ?? undefined}>
          {workspaceRoot ? getWorkspaceFolderName(workspaceRoot) : "Ghostwriter"}
        </h1>
        {!workspaceRoot ? (
          <>
            <p className="workspace-status">未選択</p>
            {!compactWhenUnselected ? (
              <p className="workspace-empty">ワークスペースを選択してください。</p>
            ) : null}
          </>
        ) : null}
        {errorMessage ? (
          <div className="workspace-error" role="alert">
            {errorMessage}
          </div>
        ) : null}
        {errorDetail ? (
          <p className="workspace-error-detail">{errorDetail}</p>
        ) : null}
        {showManualWorkspaceControls ? (
          <div className="manual-workspace-controls">
            <label className="manual-workspace-field">
              <span>ワークスペースの絶対パス</span>
              <input
                aria-label="ワークスペースの絶対パス"
                onChange={(event) => setManualWorkspaceRoot(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void openManualWorkspace();
                  }
                }}
                placeholder="/path/to/workspace"
                type="text"
                value={manualWorkspaceRoot}
              />
            </label>
            <button
              type="button"
              className="secondary-action"
              disabled={!manualWorkspaceRoot.trim() || isManualOpening}
              onClick={openManualWorkspace}
            >
              {isManualOpening
                ? "確認中..."
                : chatNewNovelManualFallback
                  ? "このパスで小説を始める"
                  : "パスを指定して開く"}
            </button>
          </div>
        ) : null}
      </div>
      <div className="workspace-actions" aria-label="ワークスペース操作">
        <button
          type="button"
          className="primary-action workspace-new-action"
          disabled={isCreatingWorkspace}
          onClick={chatMode ? startNewNovelInChatMode : openNewWorkspaceTemplateSelection}
        >
          {isCreatingWorkspace
            ? "読み込み中..."
            : chatMode
              ? "新しい小説を始める"
              : "新規ワークスペース"}
        </button>
        <button
          type="button"
          className="secondary-action workspace-open-action"
          disabled={isSelecting}
          onClick={selectWorkspace}
        >
          {isSelecting ? "選択中..." : "ワークスペースを開く"}
        </button>
      </div>
      {newWorkspaceTemplateOptions ? (
        <div className="workspace-template-modal-backdrop">
          <section
            aria-label="新しい小説ワークスペースを作成"
            className="workspace-template-modal"
            role="dialog"
          >
            <div className="workspace-template-modal-header">
              <div>
                <h2>新しい小説ワークスペースを作成</h2>
                <p>
                  テンプレートを選択してから、次に開くフォルダ選択で作品名のフォルダを作成または選択してください。
                </p>
              </div>
              <button
                type="button"
                className="template-item-delete"
                onClick={closeNewWorkspaceTemplateSelection}
              >
                閉じる
              </button>
            </div>
            <p className="workspace-template-warning">
              既存ファイルは上書きしません。衝突した場合は作成を中止します。
            </p>
            <div className="workspace-template-modal-body">
              <div className="workspace-template-options" aria-label="テンプレート一覧">
                {newWorkspaceTemplateOptions.map((template) => (
                  <button
                    type="button"
                    className="template-list-button"
                    aria-label={
                      template.source === "built-in"
                        ? "標準の小説テンプレートで始める"
                        : template.name
                    }
                    aria-pressed={template.id === newWorkspaceStartMode}
                    disabled={isCreatingWorkspace}
                    key={template.id}
                    onClick={() => setNewWorkspaceStartMode(template.id)}
                  >
                    <span className="template-list-button-main">
                      {template.source === "built-in" ? "標準小説テンプレート" : template.name}
                    </span>
                    <span className="template-list-button-meta">
                      {template.source === "built-in"
                        ? "原稿、プロット、設定資料、メモの基本フォルダを作成します。"
                        : "ユーザー定義"}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  className="template-list-button"
                  aria-label="空のワークスペースで始める"
                  aria-pressed={newWorkspaceStartMode === "empty"}
                  disabled={isCreatingWorkspace}
                  onClick={() => setNewWorkspaceStartMode("empty")}
                >
                  <span className="template-list-button-main">空で開始</span>
                  <span className="template-list-button-meta">
                    ファイルやフォルダを作らず、空のワークスペースとして開きます。
                  </span>
                </button>
              </div>
              <div className="workspace-template-plan" aria-label="作成予定項目">
                {newWorkspaceStartMode === "empty" ? (
                  <>
                    <h3>空で開始</h3>
                    <p>ファイルやフォルダを作らず、空のワークスペースとして開きます。</p>
                  </>
                ) : selectedNewWorkspaceTemplate ? (
                  <>
                    <h3>{selectedNewWorkspaceTemplate.name}</h3>
                    <section>
                      <h4>作成予定ディレクトリ</h4>
                      {selectedNewWorkspaceTemplateDirectories.length > 0 ? (
                        <ul>
                          {selectedNewWorkspaceTemplateDirectories.map((item) => (
                            <li key={`new-directory:${item.path}`}>{item.path}</li>
                          ))}
                        </ul>
                      ) : (
                        <p>作成予定ディレクトリはありません。</p>
                      )}
                    </section>
                    <section>
                      <h4>作成予定ファイル</h4>
                      {selectedNewWorkspaceTemplateFiles.length > 0 ? (
                        <ul>
                          {selectedNewWorkspaceTemplateFiles.map((item) => (
                            <li key={`new-file:${item.path}`}>{item.path}</li>
                          ))}
                        </ul>
                      ) : (
                        <p>作成予定ファイルはありません。</p>
                      )}
                    </section>
                  </>
                ) : (
                  <p>開始方法を選んでください。</p>
                )}
              </div>
            </div>
            <div className="workspace-template-modal-actions">
              <button
                type="button"
                className="secondary-action"
                onClick={closeNewWorkspaceTemplateSelection}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="primary-action"
                disabled={!newWorkspaceStartMode || isCreatingWorkspace}
                onClick={createNewWorkspaceWithSelection}
              >
                {isCreatingWorkspace ? "作成中..." : "フォルダを選んで作成"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </header>
  );
}
