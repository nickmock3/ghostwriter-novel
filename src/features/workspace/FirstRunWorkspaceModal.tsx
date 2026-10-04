import { useState } from "react";
import { FiBookOpen, FiFolder, FiFolderPlus } from "react-icons/fi";
import {
  applyWorkspaceTemplate,
  listWorkspaceTemplates,
  pickWorkspaceRoot,
} from "./workspaceClientWorkflow";
import {
  type WorkspaceTemplate,
} from "./workspaceTemplateContracts";

type WorkspaceTemplateOption = WorkspaceTemplate;

type CreateStartMode = "empty" | string;

export type WorkspaceSelectedOptions = {
  showStartGuide?: boolean;
  suppressStartGuide?: boolean;
};

export type FirstRunWorkspaceModalProps = {
  mode: "first-run" | "recovery";
  onTemplateApplied: () => void;
  onWorkspaceSelected: (workspaceRoot: string, options?: WorkspaceSelectedOptions) => void;
  previousWorkspaceRoot: string | null;
};

export function FirstRunWorkspaceModal({
  mode,
  onTemplateApplied,
  onWorkspaceSelected,
  previousWorkspaceRoot,
}: FirstRunWorkspaceModalProps) {
  const [createStep, setCreateStep] = useState(false);
  const [templateOptions, setTemplateOptions] = useState<WorkspaceTemplateOption[] | null>(null);
  const [selectedStartMode, setSelectedStartMode] = useState<CreateStartMode | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const selectedTemplate =
    selectedStartMode && selectedStartMode !== "empty"
      ? (templateOptions?.find((template) => template.id === selectedStartMode) ?? null)
      : null;
  const selectedTemplateDirectories =
    selectedTemplate?.items.filter((item) => item.kind === "directory") ?? [];
  const selectedTemplateFiles =
    selectedTemplate?.items.filter((item) => item.kind === "file") ?? [];

  async function openExistingWorkspace() {
    setIsBusy(true);
    setErrorMessage(null);

    try {
      const selectedWorkspaceRoot = await pickWorkspaceRoot();
      if (selectedWorkspaceRoot !== null) {
        onWorkspaceSelected(selectedWorkspaceRoot);
      }
    } catch {
      setErrorMessage("ワークスペースを開けませんでした。別のフォルダを選び直してください。");
    } finally {
      setIsBusy(false);
    }
  }

  async function openCreateFlow() {
    setCreateStep(true);
    setIsBusy(true);
    setErrorMessage(null);

    try {
      const templates = await listWorkspaceTemplates();
      const defaultTemplateId =
        templates.find((template) => template.source === "built-in")?.id ??
        templates[0]?.id ??
        null;
      setTemplateOptions(templates);
      setSelectedStartMode((current) => current ?? defaultTemplateId);
    } catch {
      setTemplateOptions([]);
      setSelectedStartMode(null);
    } finally {
      setIsBusy(false);
    }
  }

  async function createWorkspaceWithSelectedStart() {
    if (!selectedStartMode) {
      return;
    }

    setIsBusy(true);
    setErrorMessage(null);

    try {
      const selectedWorkspaceRoot = await pickWorkspaceRoot();
      if (selectedWorkspaceRoot === null) {
        return;
      }

      if (selectedStartMode === "empty") {
        onWorkspaceSelected(selectedWorkspaceRoot, { suppressStartGuide: true });
        return;
      }

      const template = templateOptions?.find((option) => option.id === selectedStartMode);
      if (!template) {
        throw new Error("テンプレートの選択内容を確認できませんでした。");
      }

      await applyWorkspaceTemplate({ templateId: template.id, workspaceRoot: selectedWorkspaceRoot });
      onWorkspaceSelected(selectedWorkspaceRoot, { showStartGuide: true });
      onTemplateApplied();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "新しいワークスペースを準備できませんでした。別のフォルダを選び直してください。",
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="first-run-workspace-backdrop">
      <section
        aria-label={
          createStep
            ? "新しい小説ワークスペースを作成"
            : mode === "recovery"
              ? "小説ワークスペースを開く"
              : "小説ワークスペースを準備する"
        }
        aria-modal="true"
        className={`first-run-workspace-modal ${
          createStep ? "first-run-workspace-modal--template" : "first-run-workspace-modal--welcome"
        }`}
        role="dialog"
      >
        {!createStep ? (
          <>
            <div className="first-run-workspace-heading">
              <span className="first-run-workspace-hero-icon" aria-hidden="true">
                <FiBookOpen />
              </span>
              <h2>{mode === "recovery" ? "小説ワークスペースを開く" : "小説ワークスペースを準備する"}</h2>
              {mode === "recovery" ? (
                <p>
                  前回のワークスペースを開けませんでした。別の場所に移動されたか、削除された可能性があります。
                </p>
              ) : (
                <div className="first-run-workspace-intro">
                  <p>
                    Ghostwriterへようこそ。まず、小説を書くための作業フォルダを準備しましょう。このアプリでは、小説ごとに1つのフォルダを作業場所として使い、原稿、設定、プロット、メモをまとめて保存できます。
                  </p>
                  <p>
                    初めて使う場合は、新しいフォルダを作って標準テンプレートで始めるのがおすすめです。すでに原稿フォルダがある場合は、そのフォルダを開いてください。
                  </p>
                </div>
              )}
              {mode === "recovery" && previousWorkspaceRoot ? (
                <p className="first-run-workspace-previous">前回の場所: {previousWorkspaceRoot}</p>
              ) : null}
            </div>
            {errorMessage ? <div role="alert" className="workspace-error">{errorMessage}</div> : null}
            <div className="first-run-workspace-actions">
              <button
                type="button"
                aria-label="新しい小説ワークスペースを作成"
                className="first-run-workspace-action first-run-workspace-action--create"
                disabled={isBusy}
                onClick={openCreateFlow}
              >
                <span className="first-run-workspace-action-icon" aria-hidden="true">
                  <FiFolderPlus />
                </span>
                <span className="first-run-workspace-action-body">
                  <span className="first-run-workspace-action-title">新しい小説ワークスペースを作成</span>
                  <span className="first-run-workspace-action-description">
                    標準テンプレートで原稿・設定・プロットのフォルダ構成を用意します。
                  </span>
                </span>
              </button>
              <button
                type="button"
                aria-label="既存のフォルダを開く"
                className="first-run-workspace-action first-run-workspace-action--open"
                disabled={isBusy}
                onClick={openExistingWorkspace}
              >
                <span className="first-run-workspace-action-icon" aria-hidden="true">
                  <FiFolder />
                </span>
                <span className="first-run-workspace-action-body">
                  <span className="first-run-workspace-action-title">既存のフォルダを開く</span>
                  <span className="first-run-workspace-action-description">
                    すでにある原稿フォルダをそのまま作業場所にします。
                  </span>
                </span>
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="first-run-workspace-heading">
              <h2>新しい小説ワークスペースを作成</h2>
              <p>
                テンプレートを選択してから、次に開くフォルダ選択で作品名のフォルダを作成または選択してください。
              </p>
            </div>
            {errorMessage ? <div role="alert" className="workspace-error">{errorMessage}</div> : null}
            <div className="workspace-template-modal-body">
              <div className="workspace-template-options" aria-label="テンプレート一覧">
                {templateOptions?.map((template) => (
                  <button
                    type="button"
                    className="template-list-button"
                    aria-label={
                      template.source === "built-in"
                        ? "標準の小説テンプレートで始める"
                        : template.name
                    }
                    aria-pressed={template.id === selectedStartMode}
                    disabled={isBusy}
                    key={template.id}
                    onClick={() => setSelectedStartMode(template.id)}
                  >
                    <span className="template-list-button-main">
                      {template.source === "built-in"
                        ? "標準小説テンプレート"
                        : template.name}
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
                  aria-pressed={selectedStartMode === "empty"}
                  disabled={isBusy}
                  onClick={() => setSelectedStartMode("empty")}
                >
                  <span className="template-list-button-main">空で開始</span>
                  <span className="template-list-button-meta">
                    ファイルやフォルダを作らず、空のワークスペースとして開きます。
                  </span>
                </button>
              </div>
              <div className="workspace-template-plan" aria-label="作成予定項目">
                {selectedStartMode === "empty" ? (
                  <>
                    <h3>空で開始</h3>
                    <p>ファイルやフォルダを作らず、空のワークスペースとして開きます。</p>
                  </>
                ) : selectedTemplate ? (
                  <>
                    <h3>{selectedTemplate.name}</h3>
                    <section>
                      <h4>作成予定ディレクトリ</h4>
                      {selectedTemplateDirectories.length > 0 ? (
                        <ul>
                          {selectedTemplateDirectories.map((item) => (
                            <li key={`first-run-directory:${item.path}`}>{item.path}</li>
                          ))}
                        </ul>
                      ) : (
                        <p>作成予定ディレクトリはありません。</p>
                      )}
                    </section>
                    <section>
                      <h4>作成予定ファイル</h4>
                      {selectedTemplateFiles.length > 0 ? (
                        <ul>
                          {selectedTemplateFiles.map((item) => (
                            <li key={`first-run-file:${item.path}`}>{item.path}</li>
                          ))}
                        </ul>
                      ) : (
                        <p>作成予定ファイルはありません。</p>
                      )}
                    </section>
                  </>
                ) : templateOptions === null ? (
                  <p>テンプレート一覧を読み込んでいます。</p>
                ) : (
                  <p>開始方法を選んでください。</p>
                )}
              </div>
            </div>
            <div className="workspace-template-modal-actions">
              <button
                type="button"
                className="primary-action"
                disabled={!selectedStartMode || isBusy}
                onClick={createWorkspaceWithSelectedStart}
              >
                フォルダを選んで作成
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
