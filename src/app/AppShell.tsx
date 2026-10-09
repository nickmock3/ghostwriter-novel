import { useEffect } from "react";
import {
  FiBookOpen,
  FiCpu,
  FiEdit3,
  FiFolder,
  FiMessageCircle,
  FiSettings,
} from "react-icons/fi";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { FirstRunWorkspaceModal, type WorkspaceSelectedOptions } from "../features/workspace/FirstRunWorkspaceModal";
import { WorkspaceBar } from "../features/workspace/WorkspaceBar";
import { APP_DISPLAY_VERSION } from "../shared/appVersion";
import { useChatSession } from "./ChatSessionContext";
import { writeStoredWorkMode } from "./workspaceSessionStorage";
import { isWorkspaceRestorePending, type WorkspaceRestoreState } from "../features/workspace/useWorkspaceSession";

type AppShellProps = {
  onTemplateApplied: () => void;
  onWorkspaceSelected: (workspaceRoot: string, options?: WorkspaceSelectedOptions) => void;
  workspaceRestoreState: WorkspaceRestoreState;
  workspaceRoot: string | null;
};

export function AppShell({
  onTemplateApplied,
  onWorkspaceSelected,
  workspaceRestoreState,
  workspaceRoot,
}: AppShellProps) {
  const { notification } = useChatSession();
  const notificationLabel = notification === "failed" ? "チャットの応答に失敗しました" : "チャットの応答が完了しました";
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const showWorkspaceBar = pathname === "/editor" || pathname === "/chat";

  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    if (pathname === "/chat") {
      writeStoredWorkMode(workspaceRoot, "chat");
    } else if (pathname === "/editor") {
      writeStoredWorkMode(workspaceRoot, "editor");
    }
  }, [pathname, workspaceRoot]);
  const isWorkspaceRestoring = isWorkspaceRestorePending(workspaceRestoreState);
  const shouldBlockForWorkspace = pathname === "/editor" && !workspaceRoot && !isWorkspaceRestoring;

  return (
    <main className="app-shell" aria-label="Ghostwriter">
      <nav
        className="app-sidebar"
        aria-label="画面切り替え"
        data-workspace-blocked={shouldBlockForWorkspace ? "true" : undefined}
      >
        <Link
          className="app-sidebar-button"
          aria-label="チャットモード"
          title={notification ? notificationLabel : "チャットモード"}
          aria-describedby={notification ? "chat-completion-notification" : undefined}
          to="/chat"
          activeProps={{ "aria-current": "page" }}
        >
          <FiMessageCircle aria-hidden="true" focusable="false" />
          <span>チャットモード</span>
          {notification ? (
            <span id="chat-completion-notification" className="chat-completion-badge" role="status"
              aria-label={notificationLabel} data-outcome={notification}>
              <span aria-hidden="true">{notification === "failed" ? "!" : "✓"}</span>
              <span className="chat-completion-description">{notificationLabel}</span>
            </span>
          ) : null}
        </Link>
        <Link
          className="app-sidebar-button"
          aria-label="エディット画面"
          title="エディット画面"
          to="/editor"
          activeProps={{ "aria-current": "page" }}
        >
          <FiEdit3 aria-hidden="true" focusable="false" />
          <span>エディット画面</span>
        </Link>
        <Link
          className="app-sidebar-button"
          aria-label="リーダーモード"
          title="リーダーモード"
          to="/reader"
          activeProps={{ "aria-current": "page" }}
        >
          <FiBookOpen aria-hidden="true" focusable="false" />
          <span>リーダーモード</span>
        </Link>
        <Link
          className="app-sidebar-button"
          aria-label="テンプレート管理"
          title="テンプレート管理"
          to="/templates"
          activeProps={{ "aria-current": "page" }}
        >
          <FiFolder aria-hidden="true" focusable="false" />
          <span>テンプレート管理</span>
        </Link>
        <Link
          className="app-sidebar-button"
          aria-label="LLMプロフィール管理"
          title="LLMプロフィール管理"
          to="/llm-profiles"
          activeProps={{ "aria-current": "page" }}
        >
          <FiCpu aria-hidden="true" focusable="false" />
          <span>LLMプロフィール管理</span>
        </Link>
        <Link
          className="app-sidebar-button"
          aria-label="設定ページ"
          data-sidebar-placement="bottom"
          title="設定ページ"
          to="/settings"
          activeProps={{ "aria-current": "page" }}
        >
          <FiSettings aria-hidden="true" data-icon="settings-gear" focusable="false" />
          <span>設定ページ</span>
        </Link>
        <Link
          className="app-sidebar-version"
          aria-label={`アプリバージョン ${APP_DISPLAY_VERSION}`}
          title={`アプリバージョン ${APP_DISPLAY_VERSION}`}
          to="/settings"
        >
          {APP_DISPLAY_VERSION}
        </Link>
      </nav>
      <div
        className="app-main-area"
        data-has-workspace-bar={showWorkspaceBar ? "true" : "false"}
        data-workspace-blocked={shouldBlockForWorkspace ? "true" : undefined}
      >
        {showWorkspaceBar ? (
          <WorkspaceBar
            chatMode={pathname === "/chat"}
            compactWhenUnselected={pathname === "/chat" && workspaceRoot === null}
            isRestoring={isWorkspaceRestoring}
            workspaceRoot={workspaceRoot}
            onTemplateApplied={onTemplateApplied}
            onWorkspaceSelected={onWorkspaceSelected}
          />
        ) : null}
        <div className="app-view-stack">
          <Outlet />
        </div>
      </div>
      {shouldBlockForWorkspace ? (
        <FirstRunWorkspaceModal
          mode={workspaceRestoreState.status === "failed" ? "recovery" : "first-run"}
          previousWorkspaceRoot={
            workspaceRestoreState.status === "failed" ? workspaceRestoreState.previousRoot : null
          }
          onTemplateApplied={onTemplateApplied}
          onWorkspaceSelected={onWorkspaceSelected}
        />
      ) : null}
    </main>
  );
}
