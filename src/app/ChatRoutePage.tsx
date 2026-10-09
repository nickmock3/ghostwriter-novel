import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChatPane } from "../features/ai-chat/ChatPane";
import { useEditorSessionContext } from "./EditorSessionContext";
import { useChatSession } from "./ChatSessionContext";
import { useWorkspaceContext } from "./WorkspaceContext";
import { ModeLoadingStatus } from "./ModeLoadingStatus";

export function ChatRoutePage() {
  const { isWorkspaceRestoring, workspaceRoot } = useWorkspaceContext();
  const {
    chatAppendRequest,
    dirtyPaths,
    handleAppliedEdit,
    selectedPath,
    setSelectedPath,
  } = useEditorSessionContext();
  const { controller, llm } = useChatSession();
  const navigate = useNavigate();
  const handleOpenPathFromChat = useCallback(
    (path: string) => {
      setSelectedPath(path);
      void navigate({ to: "/editor" });
    },
    [navigate, setSelectedPath],
  );
  function requestWorkspaceSelection() {
    document.querySelector<HTMLButtonElement>(".workspace-open-action")?.click();
  }

  return (
    <section className="chat-mode-layout" aria-label="チャットモード">
      <div
        className="chat-mode-shell"
        data-workspace-selected={workspaceRoot ? "true" : undefined}
      >
        {!workspaceRoot && isWorkspaceRestoring ? <ModeLoadingStatus /> : null}
        {!workspaceRoot && !isWorkspaceRestoring ? (
          <section aria-label="チャットモードを始める" className="chat-mode-empty-state">
            <img className="chat-mode-empty-icon" src="/favicon.png" alt="" />
            <h2 className="chat-mode-empty-title">チャットモードを始める</h2>
            <p>
              ワークスペースを開くとAIチャットを始められます。原稿、設定、プロットを置いたフォルダを選ぶと、AIに相談しながら小説を書き進められます。
            </p>
            <button
              type="button"
              className="primary-action chat-mode-empty-cta"
              onClick={requestWorkspaceSelection}
            >
              ワークスペースを開く
            </button>
          </section>
        ) : null}
        {workspaceRoot ? (
          <ChatPane
            controller={controller}
            editActions={{
              onAppliedEdit: handleAppliedEdit,
              onOpenPath: handleOpenPathFromChat,
            }}
            fileContext={{
              appendedTextRequest: chatAppendRequest,
              currentFilePath: selectedPath,
              dirtyPaths,
              workspaceRoot,
            }}
            layout="full-page"
            llm={llm}
            mode="chat"
          />
        ) : null}
      </div>
    </section>
  );
}
