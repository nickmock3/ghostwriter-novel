import { useEffect, useRef, useState } from "react";
import type { IconType } from "react-icons";
import { FiBookOpen, FiEdit3, FiMap, FiMessageCircle } from "react-icons/fi";
import { fetchFileContent, fetchFileTree } from "./workspaceFilesClient";

export const IDEA_CONSULT_PROMPT =
  "小説のアイディアを一緒に広げたいです。今考えていることは、...";

const SUGGESTED_PLOT_PATH = "プロット/全体構成.md";
const SUGGESTED_CHAPTER_PATH = "小説/第001章/本文.txt";
const SUGGESTED_SETTINGS_PATHS = ["設定/登場人物.md", "設定/世界観.md"] as const;

const MISSING_PLOT_MESSAGE =
  "標準テンプレートのプロットファイルが見つかりません。ファイルツリーから作成するか、チャットで作成案を相談できます。";
const MISSING_CHAPTER_MESSAGE =
  "標準テンプレートの第1章本文ファイルが見つかりません。ファイルツリーから作成するか、チャットで作成案を相談できます。";
const MISSING_SETTINGS_MESSAGE =
  "標準テンプレートの設定資料が見つかりません。ファイルツリーから作成するか、チャットで作成案を相談できます。";

const NEARLY_EMPTY_TREE_ITEM_LIMIT = 12;
const START_GUIDE_DISMISSED_KEY_PREFIX = "ghostwriter:start-guide-dismissed:";

type StartGuideActionVariant = "idea" | "plot" | "chapter" | "settings";

type StartGuideActionConfig = {
  description: string;
  icon: IconType;
  onClick: () => void;
  title: string;
  variant: StartGuideActionVariant;
};

type StartGuideModalProps = {
  siwcEnabled?: boolean;
  onDismiss: () => void;
  onIdeaConsult: () => void;
  onOpenPath: (path: string) => void;
  workspaceRoot: string;
};

export function isStartGuideDismissed(workspaceRoot: string): boolean {
  try {
    return window.localStorage.getItem(`${START_GUIDE_DISMISSED_KEY_PREFIX}${workspaceRoot}`) === "true";
  } catch {
    return false;
  }
}

export function markStartGuideDismissed(workspaceRoot: string) {
  try {
    window.localStorage.setItem(`${START_GUIDE_DISMISSED_KEY_PREFIX}${workspaceRoot}`, "true");
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}

export async function shouldShowStartGuide(workspaceRoot: string, signal?: AbortSignal): Promise<boolean> {
  if (isStartGuideDismissed(workspaceRoot)) {
    return false;
  }

  try {
    const body = await fetchFileTree({ signal, workspaceRoot });
    return body.items.length <= NEARLY_EMPTY_TREE_ITEM_LIMIT && !body.truncated;
  } catch {
    return false;
  }
}

async function checkFileExists(root: string, path: string): Promise<boolean> {
  try {
    await fetchFileContent({ path, workspaceRoot: root });
    return true;
  } catch {
    return false;
  }
}

export function StartGuideModal({
  siwcEnabled = false,
  onDismiss,
  onIdeaConsult,
  onOpenPath,
  workspaceRoot,
}: StartGuideModalProps) {
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setActionMessage(null);
  }, [workspaceRoot]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  function handleDismiss() {
    markStartGuideDismissed(workspaceRoot);
    onDismiss();
  }

  function handleIdeaConsult() {
    setActionMessage(null);
    onIdeaConsult();
    handleDismiss();
  }

  async function openSuggestedFile(path: string, missingMessage: string) {
    setActionMessage(null);
    const exists = await checkFileExists(workspaceRoot, path);
    if (exists) {
      onOpenPath(path);
      handleDismiss();
      return;
    }

    setActionMessage(missingMessage);
  }

  async function handleOpenSettings() {
    setActionMessage(null);
    for (const path of SUGGESTED_SETTINGS_PATHS) {
      if (await checkFileExists(workspaceRoot, path)) {
        onOpenPath(path);
        handleDismiss();
        return;
      }
    }

    setActionMessage(MISSING_SETTINGS_MESSAGE);
  }

  const actions: StartGuideActionConfig[] = [
    {
      description: "まだ固まっていない構想を会話しながら広げます",
      icon: FiMessageCircle,
      onClick: handleIdeaConsult,
      title: "アイディアをAIに相談する",
      variant: "idea",
    },
    {
      description: "全体構成や章立てから整理します",
      icon: FiMap,
      onClick: () => void openSuggestedFile(SUGGESTED_PLOT_PATH, MISSING_PLOT_MESSAGE),
      title: "プロットを作る",
      variant: "plot",
    },
    {
      description: "第1章の本文ファイルを開いて執筆します",
      icon: FiEdit3,
      onClick: () => void openSuggestedFile(SUGGESTED_CHAPTER_PATH, MISSING_CHAPTER_MESSAGE),
      title: "第1章の本文を書く",
      variant: "chapter",
    },
    {
      description: "登場人物や世界観の資料から土台を作ります",
      icon: FiBookOpen,
      onClick: () => void handleOpenSettings(),
      title: "設定資料を整理する",
      variant: "settings",
    },
  ];

  return (
    <div className="start-guide-backdrop">
      <section
        ref={dialogRef}
        aria-label="何から始めますか？"
        aria-modal="true"
        className="start-guide-modal"
        role="dialog"
        tabIndex={-1}
      >
        <div className="start-guide-heading">
          <h2>何から始めますか？</h2>
          <p>アイディア相談、プロット作成、本文執筆など、好きなところから始められます。</p>
        </div>
        {actionMessage ? (
          <p className="start-guide-message" role="alert">
            {actionMessage}
          </p>
        ) : null}
        <div className="start-guide-actions">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.variant}
                type="button"
                aria-label={action.title}
                className={`start-guide-action start-guide-action--${action.variant}`}
                onClick={action.onClick}
              >
                <span className="start-guide-action-icon" aria-hidden="true">
                  <Icon />
                </span>
                <span className="start-guide-action-body">
                  <span className="start-guide-action-title">{action.title}</span>
                  <span className="start-guide-action-description">{action.description}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="start-guide-connection-guidance">
          {siwcEnabled ? <>まずは<a href="/settings">ChatGPTでログイン</a>して、チャットやAIアシストを使いましょう。APIキー接続も設定から追加できます。</> : <>AIの接続は設定から行えます。</>}
        </p>
        <div className="start-guide-footer">
          <button type="button" className="secondary-action" onClick={handleDismiss} aria-label="開始ガイドを閉じる">
            閉じる
          </button>
        </div>
      </section>
    </div>
  );
}
