import { useCallback, useEffect, useRef, useState } from "react";
import type { AppliedEditProposal } from "../features/ai-chat/ChatPane";
import {
  IDEA_CONSULT_PROMPT,
  shouldShowStartGuide,
} from "../features/workspace/StartGuideModal";
import { workspaceSelectSuccessSchema } from "../features/workspace/workspaceSchemas";
import { useFileSession } from "../features/editor/useFileSession";
import { apiFetch } from "../shared/client/apiTransport";
import {
  readUserSettings,
  writeUserSettings,
  type UserSettings,
} from "../features/settings/settingsStorage";
import {
  EditorSessionContext,
  type EditorSelectionJumpRequest,
  type NewEditorSelectionJumpRequest,
} from "./EditorSessionContext";
import { LlmSettingsContext } from "./LlmSettingsContext";
import { PaneLayoutContext } from "./PaneLayoutContext";
import { WorkspaceContext } from "./WorkspaceContext";
import { ChatSessionProvider } from "./ChatSessionContext";
import { AppShell } from "./AppShell";
import { useThreePaneLayout } from "./threePaneLayout";
import { useLlmSettings } from "./useLlmSettings";
import {
  clearStoredWorkspaceRoot,
  readStoredWorkspaceRoot,
  writeStoredWorkspaceRoot,
} from "./workspaceSessionStorage";

type WorkspaceRestoreState =
  | { status: "idle" }
  | { previousRoot: string; status: "restoring" }
  | { previousRoot: string; status: "failed" };

export function App() {
  const [settings, setSettings] = useState<UserSettings>(() => readUserSettings());
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [workspaceRestoreState, setWorkspaceRestoreState] = useState<WorkspaceRestoreState>({ status: "idle" });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [dirtyPaths, setDirtyPaths] = useState<string[]>([]);
  const [editorRefreshKey, setEditorRefreshKey] = useState(0);
  const [fileTreeRefreshKey, setFileTreeRefreshKey] = useState(0);
  const [chatAppendRequest, setChatAppendRequest] = useState<{ id: number; text: string } | null>(null);
  const [editorSelectionJumpRequest, setEditorSelectionJumpRequest] =
    useState<EditorSelectionJumpRequest | null>(null);
  const [showStartGuide, setShowStartGuide] = useState(false);
  const chatAppendRequestIdRef = useRef(0);
  const editorSelectionJumpRequestIdRef = useRef(0);
  const suppressStartGuideForWorkspaceRef = useRef<string | null>(null);
  const showStartGuideForWorkspaceRef = useRef<string | null>(null);

  const {
    handleDeleteLlmSecret,
    handleSaveLlmSecret,
    llmProfileSettings,
    llmProfiles,
    llmProviders,
    llmSecretErrors,
    llmSecrets,
    refreshLlmSecrets,
    refreshLlmSettings,
    setLlmProfileSettings,
    settingsError,
  } = useLlmSettings(workspaceRoot, settings, setSettings);

  const {
    handleCollapseLeftPane,
    handleCollapseRightPane,
    handleResetPaneWidths,
    handleResizeStart,
    handleRestoreLeftPane,
    handleRestoreRightPane,
    isLeftPaneCollapsed,
    isRightPaneCollapsed,
    isPaneResizeDragging,
    layoutRef,
    paneWidths,
    restoreRightPane,
    threePaneLayoutStyle,
  } = useThreePaneLayout();

  useEffect(() => {
    writeUserSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!settings.restoreLastWorkspace) {
      return;
    }

    const storedWorkspaceRoot = readStoredWorkspaceRoot();

    if (!storedWorkspaceRoot) {
      setWorkspaceRestoreState({ status: "idle" });
      return;
    }

    const previousWorkspaceRoot = storedWorkspaceRoot;
    let isActive = true;
    setWorkspaceRestoreState({ previousRoot: previousWorkspaceRoot, status: "restoring" });

    async function restoreWorkspace() {
      try {
        const response = await apiFetch("/api/workspace/validate", {
          body: JSON.stringify({ workspaceRoot: storedWorkspaceRoot }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        });
        const body: unknown = await response.json();
        const parsedBody = workspaceSelectSuccessSchema.safeParse(body);

        if (!response.ok || !parsedBody.success) {
          throw new Error("Workspace validation failed");
        }

        if (readStoredWorkspaceRoot() !== previousWorkspaceRoot) {
          return;
        }

        if (!isActive) {
          return;
        }

        setWorkspaceRoot(parsedBody.data.workspaceRoot);
        setWorkspaceRestoreState({ status: "idle" });
        writeStoredWorkspaceRoot(parsedBody.data.workspaceRoot);
      } catch {
        if (readStoredWorkspaceRoot() !== previousWorkspaceRoot) {
          return;
        }

        if (!isActive) {
          return;
        }

        clearStoredWorkspaceRoot();
        setWorkspaceRestoreState({ previousRoot: previousWorkspaceRoot, status: "failed" });
      }
    }

    void restoreWorkspace();

    return () => {
      isActive = false;
    };
  }, [settings.restoreLastWorkspace]);

  const handleDirtyStateChange = useCallback((path: string | null, isDirty: boolean) => {
    setDirtyPaths(path && isDirty ? [path] : []);
  }, []);

  const fileSession = useFileSession({
    onActivePathChange: setSelectedPath,
    onDirtyStateChange: handleDirtyStateChange,
    refreshKey: editorRefreshKey,
    selectedPath,
    workspaceRoot,
  });

  const handleSendEditorSelectionToChat = useCallback((text: string) => {
    chatAppendRequestIdRef.current += 1;
    setChatAppendRequest({ id: chatAppendRequestIdRef.current, text });
    restoreRightPane();
  }, [restoreRightPane]);

  const requestEditorSelectionJump = useCallback((request: NewEditorSelectionJumpRequest) => {
    editorSelectionJumpRequestIdRef.current += 1;
    setEditorSelectionJumpRequest({
      ...request,
      id: editorSelectionJumpRequestIdRef.current,
    });
  }, []);

  const consumeEditorSelectionJumpRequest = useCallback((id: number) => {
    setEditorSelectionJumpRequest((current) => (current?.id === id ? null : current));
  }, []);

  const dismissStartGuide = useCallback(() => {
    setShowStartGuide(false);
  }, []);

  const handleStartGuideIdeaConsult = useCallback(() => {
    handleSendEditorSelectionToChat(IDEA_CONSULT_PROMPT);
  }, [handleSendEditorSelectionToChat]);

  useEffect(() => {
    if (!workspaceRoot) {
      setShowStartGuide(false);
      return;
    }

    if (suppressStartGuideForWorkspaceRef.current === workspaceRoot) {
      suppressStartGuideForWorkspaceRef.current = null;
      setShowStartGuide(false);
      return;
    }

    if (showStartGuideForWorkspaceRef.current === workspaceRoot) {
      showStartGuideForWorkspaceRef.current = null;
      setShowStartGuide(true);
      return;
    }

    const abortController = new AbortController();

    void shouldShowStartGuide(workspaceRoot, abortController.signal)
      .then((shouldShow) => {
        if (!abortController.signal.aborted) {
          setShowStartGuide(shouldShow);
        }
      })
      .catch(() => {
        if (!abortController.signal.aborted) {
          setShowStartGuide(false);
        }
      });

    return () => abortController.abort();
  }, [workspaceRoot]);

  const handleAppliedEdit = useCallback(
    (proposal: AppliedEditProposal) => {
      if (proposal.operation === "create" || proposal.operation === "createDirectory") {
        setFileTreeRefreshKey((current) => current + 1);
      }

      setEditorRefreshKey((current) => current + 1);
    },
    [],
  );

  const handleFileOperation = useCallback(
    (operation:
      | { kind: "directory" | "file"; operation: "create"; path: string }
      | { operation: "delete"; path: string }
      | { newPath: string; operation: "rename"; path: string }) => {
      if (!selectedPath) {
        return;
      }

      if (operation.operation === "delete") {
        if (selectedPath === operation.path || selectedPath.startsWith(`${operation.path}/`)) {
          setSelectedPath(null);
          setDirtyPaths([]);
        }
        return;
      }

      if (operation.operation === "rename") {
        if (selectedPath === operation.path) {
          setSelectedPath(operation.newPath);
          setDirtyPaths([]);
          return;
        }

        if (selectedPath.startsWith(`${operation.path}/`)) {
          setSelectedPath(`${operation.newPath}/${selectedPath.slice(operation.path.length + 1)}`);
          setDirtyPaths([]);
        }
      }
    },
    [selectedPath],
  );

  return (
    <LlmSettingsContext.Provider
      value={{
        handleDeleteLlmSecret,
        handleSaveLlmSecret,
        llmProfileSettings,
        llmProfiles,
        llmProviders,
        llmSecretErrors,
        llmSecrets,
        refreshLlmSecrets,
        refreshLlmSettings,
        setLlmProfileSettings,
        setSettings,
        settings,
        settingsError,
      }}
    >
      <WorkspaceContext.Provider
        value={{
          dismissStartGuide,
          handleStartGuideIdeaConsult,
          showStartGuide,
          workspaceRoot,
        }}
      >
        <EditorSessionContext.Provider
          value={{
            chatAppendRequest,
            consumeEditorSelectionJumpRequest,
            dirtyPaths,
            editorSelectionJumpRequest,
            editorRefreshKey,
            fileSession,
            fileTreeRefreshKey,
            handleAppliedEdit,
            handleDirtyStateChange,
            handleFileOperation,
            handleSendEditorSelectionToChat,
            requestEditorSelectionJump,
            selectedPath,
            setDirtyPaths,
            setSelectedPath,
          }}
        >
          <PaneLayoutContext.Provider
            value={{
              handleCollapseLeftPane,
              handleCollapseRightPane,
              handleResetPaneWidths,
              handleResizeStart,
              handleRestoreLeftPane,
              handleRestoreRightPane,
              isLeftPaneCollapsed,
              isPaneResizeDragging,
              isRightPaneCollapsed,
              layoutRef,
              paneWidths,
              threePaneLayoutStyle,
            }}
          >
            <ChatSessionProvider key={workspaceRoot ?? "no-workspace"}>
              <AppShell
                workspaceRoot={workspaceRoot}
                workspaceRestoreState={workspaceRestoreState}
                onTemplateApplied={() => {
                  setFileTreeRefreshKey((current) => current + 1);
                }}
                onWorkspaceSelected={(nextWorkspaceRoot, options) => {
                  if (options?.suppressStartGuide) {
                    suppressStartGuideForWorkspaceRef.current = nextWorkspaceRoot;
                  }
                  if (options?.showStartGuide) {
                    showStartGuideForWorkspaceRef.current = nextWorkspaceRoot;
                  }
                  setWorkspaceRoot(nextWorkspaceRoot);
                  setWorkspaceRestoreState({ status: "idle" });
                  writeStoredWorkspaceRoot(nextWorkspaceRoot);
                  setSelectedPath(null);
                  setDirtyPaths([]);
                  setEditorSelectionJumpRequest(null);
                  setEditorRefreshKey(0);
                  setFileTreeRefreshKey(0);
                }}
              />
            </ChatSessionProvider>
          </PaneLayoutContext.Provider>
        </EditorSessionContext.Provider>
      </WorkspaceContext.Provider>
    </LlmSettingsContext.Provider>
  );
}

export { resolveStartupWorkModeRoute } from "./workspaceSessionStorage";
export { ChatRoutePage } from "./ChatRoutePage";
export { EditorRoutePage } from "./EditorRoutePage";
export { SettingsRoutePage } from "./SettingsRoutePage";
export { LlmProfilesRoutePage } from "./LlmProfilesRoutePage";
