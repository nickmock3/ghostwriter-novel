import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useChatConversationController } from "../features/ai-chat/useChatConversationController";
import { useEditorSessionContext } from "./EditorSessionContext";
import { useLlmSettingsContext } from "../features/llm/LlmSettingsContext";
import { useWorkspaceContext } from "./WorkspaceContext";
import { buildMainLlmChatPaneProps, type MainLlmChatPaneProps } from "../features/ai-chat/mainLlmChatPaneProps";
import { displayLlmProfiles } from "../features/llm/llmDisplay";

type ChatSession = {
  controller: ReturnType<typeof useChatConversationController>;
  llm: MainLlmChatPaneProps;
  notification: "completed" | "failed" | null;
};
const ChatSessionContext = createContext<ChatSession | null>(null);

export function useChatSession() {
  const session = useContext(ChatSessionContext);
  if (!session) throw new Error("ChatSessionProvider is required");
  return session;
}

// Lives above route pages; keyed by workspace in App to isolate sessions.
export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const { workspaceRoot } = useWorkspaceContext();
  const { dirtyPaths, handleAppliedEdit, selectedPath } = useEditorSessionContext();
  const { llmProfileSettings, llmProfiles, llmProviders, setLlmProfileSettings, setSettings, settings } = useLlmSettingsContext();
  const isChatVisible = useRouterState({ select: (state) => state.location.pathname === "/chat" });
  const [hasOpenedChat, setHasOpenedChat] = useState(isChatVisible);
  useEffect(() => {
    if (isChatVisible) setHasOpenedChat(true);
  }, [isChatVisible]);
  const mainLlm = buildMainLlmChatPaneProps({
    llmProfileSettings, llmProfiles, llmProviders, setLlmProfileSettings,
    setSettingsModelSelection: (modelSelection) => setSettings((current) => ({ ...current, modelSelection })),
    settingsModelSelection: settings.modelSelection,
  });
  const llm = {
    ...mainLlm,
    profiles: displayLlmProfiles(llmProviders, llmProfileSettings?.userProfiles),
  };
  const controller = useChatConversationController({
    workspaceRoot: hasOpenedChat || isChatVisible ? workspaceRoot : null,
    currentFilePath: selectedPath,
    dirtyPaths,
    mode: "chat",
    autoCompactEnabled: settings.autoCompactEnabled,
    autoCompactThresholdRatio: settings.autoCompactThresholdRatio,
    llmProviders: llm.providers,
    llmProfiles: llm.profiles,
    llmProfileRoleAssignments: llm.roleAssignments,
    modelSelection: llm.modelSelection,
    onAppliedEdit: handleAppliedEdit,
  });
  const [notification, setNotification] = useState<ChatSession["notification"]>(null);
  const previousRunState = useRef(controller.agentRunState);
  useEffect(() => {
    if (isChatVisible) {
      setNotification(null);
    } else if (previousRunState.current === "running" && controller.agentRunState !== "running") {
      setNotification(controller.agentRunState === "failed" ? "failed" : "completed");
    }
    previousRunState.current = controller.agentRunState;
  }, [controller.agentRunState, isChatVisible]);

  return <ChatSessionContext.Provider value={{ controller, llm, notification: isChatVisible ? null : notification }}>
    {children}
  </ChatSessionContext.Provider>;
}
