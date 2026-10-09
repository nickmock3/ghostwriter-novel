import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AppliedEditProposal } from "../features/ai-chat/ChatPane";
import { IDEA_CONSULT_PROMPT } from "../features/workspace/StartGuideModal";
import { useFileSession } from "../features/editor/useFileSession";
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
import { UserSettingsContext } from "./UserSettingsContext";
import type { SelectedModel } from "../features/llm/selection/llmSelection";
import { LlmSettingsContext } from "../features/llm/LlmSettingsContext";
import { PaneLayoutContext } from "./PaneLayoutContext";
import { WorkspaceContext } from "./WorkspaceContext";
import { ChatSessionProvider } from "./ChatSessionContext";
import { AppShell } from "./AppShell";
import { useThreePaneLayout } from "./threePaneLayout";
import { useLlmSettings } from "../features/llm/useLlmSettings";
import { isWorkspaceRestorePending, useWorkspaceSession } from "../features/workspace/useWorkspaceSession";
import { initializeAiConnectionPreferences } from "../features/siwc/useAiConnection";

export function App() {
  useEffect(() => {
    // hydrateRoot schedules hydration; shell controls are ready after this commit.
    window.__GHOSTWRITER_HYDRATED__ = true;
  }, []);
  const [settings, setSettings] = useState<UserSettings>(() => readUserSettings());
  const { dismissStartGuide, selectWorkspace, showStartGuide, workspaceRestoreState, workspaceRoot } =
    useWorkspaceSession(settings.restoreLastWorkspace);
  // Capture SIWC migration intent before LLM settings persist generated defaults.
  useState(() => {
    initializeAiConnectionPreferences();
    return true;
  });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [dirtyPaths, setDirtyPaths] = useState<string[]>([]);
  const [editorRefreshKey, setEditorRefreshKey] = useState(0);
  const [fileTreeRefreshKey, setFileTreeRefreshKey] = useState(0);
  const [chatAppendRequest, setChatAppendRequest] = useState<{ id: number; text: string } | null>(null);
  const [editorSelectionJumpRequest, setEditorSelectionJumpRequest] =
    useState<EditorSelectionJumpRequest | null>(null);
  const chatAppendRequestIdRef = useRef(0);
  const editorSelectionJumpRequestIdRef = useRef(0);

  const onModelSelectionChange: Dispatch<SetStateAction<SelectedModel | null>> = useCallback(
    (update) => setSettings((current) => ({
      ...current,
      modelSelection: typeof update === "function" ? update(current.modelSelection) : update,
    })),
    [],
  );

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
  } = useLlmSettings(workspaceRoot, onModelSelectionChange);

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

  const handleStartGuideIdeaConsult = useCallback(() => {
    handleSendEditorSelectionToChat(IDEA_CONSULT_PROMPT);
  }, [handleSendEditorSelectionToChat]);

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
    <UserSettingsContext.Provider value={{ settings, setSettings }}>
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
          settingsError,
        }}
      >
        <WorkspaceContext.Provider
          value={{
            dismissStartGuide,
            handleStartGuideIdeaConsult,
            isWorkspaceRestoring: isWorkspaceRestorePending(workspaceRestoreState),
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
                    selectWorkspace(nextWorkspaceRoot, options);
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
    </UserSettingsContext.Provider>
  );
}
