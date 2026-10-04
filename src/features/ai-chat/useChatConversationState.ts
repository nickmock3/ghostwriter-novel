import { useReducer } from "react";
import {
  removeConversationFromList,
  upsertConversationInList,
} from "./chatConversationControllerHelpers";
import type { Conversation } from "./conversationSchemas";

type ChatConversationState = {
  activeConversation: Conversation | null;
  conversations: Conversation[];
  error: string | null;
  agentRunState: "idle" | "running" | "failed";
  compactionState: "idle" | "running";
  commandFeedback: string | null;
  isLoading: boolean;
  selectedAgentRuntime: Conversation["agentRuntime"];
  showApiKeySetupGuidance: boolean;
};

type ChatConversationEvent =
  | { type: "workspaceChanged" }
  | { type: "historyLoading" }
  | {
      type: "historyLoaded";
      conversations: Conversation[];
      activeConversation: Conversation | null;
      error: string | null;
    }
  | { type: "historyFailed"; error: string }
  | { type: "conversationCreating" }
  | { type: "conversationCreated"; conversation: Conversation }
  | { type: "conversationSelected"; conversation: Conversation }
  | { type: "conversationDeleting" }
  | { type: "conversationDeleted"; conversationId: string }
  | { type: "conversationUpdated"; conversation: Conversation }
  | { type: "operationFinished" }
  | { type: "operationFailed"; error: string }
  | { type: "submitStarted" }
  | { type: "submitSucceeded"; conversation: Conversation }
  | { type: "submitFailed"; error: string }
  | { type: "compactStarted" }
  | { type: "compactSucceeded"; conversation: Conversation; feedback: string }
  | { type: "compactFailed"; error: string }
  | { type: "presentationReset" }
  | { type: "feedbackChanged"; feedback: string | null }
  | { type: "errorChanged"; error: string | null }
  | { type: "apiKeyGuidanceChanged"; show: boolean };

export const initialChatConversationState: ChatConversationState = {
  activeConversation: null,
  conversations: [],
  error: null,
  agentRunState: "idle",
  compactionState: "idle",
  commandFeedback: null,
  isLoading: false,
  selectedAgentRuntime: "vercel-ai",
  showApiKeySetupGuidance: false,
};

export function chatConversationReducer(
  state: ChatConversationState,
  event: ChatConversationEvent,
): ChatConversationState {
  switch (event.type) {
    case "workspaceChanged":
      return initialChatConversationState;
    case "historyLoading":
      return { ...state, isLoading: true };
    case "historyLoaded":
      return {
        ...state,
        activeConversation: event.activeConversation,
        conversations: event.conversations,
        selectedAgentRuntime:
          event.activeConversation?.agentRuntime ?? "vercel-ai",
        error: event.error,
        isLoading: false,
      };
    case "historyFailed":
      return { ...state, error: event.error, isLoading: false };
    case "conversationCreating":
      return {
        ...state,
        error: null,
        agentRunState: "idle",
        compactionState: "idle",
        commandFeedback: null,
        isLoading: true,
      };
    case "conversationCreated":
      return {
        ...state,
        activeConversation: event.conversation,
        selectedAgentRuntime: event.conversation.agentRuntime ?? "vercel-ai",
        conversations: [event.conversation, ...state.conversations],
        isLoading: false,
      };
    case "conversationSelected":
      return {
        ...state,
        activeConversation: event.conversation,
        selectedAgentRuntime: event.conversation.agentRuntime ?? "vercel-ai",
        agentRunState: "idle",
        compactionState: "idle",
        isLoading: false,
        commandFeedback: null,
        showApiKeySetupGuidance: false,
      };
    case "conversationDeleting":
      return { ...state, error: null, isLoading: true };
    case "conversationDeleted": {
      const conversations = removeConversationFromList(
        state.conversations,
        event.conversationId,
      );
      const activeConversation =
        state.activeConversation?.id === event.conversationId
          ? (conversations[0] ?? null)
          : state.activeConversation;
      return {
        ...state,
        conversations,
        activeConversation,
        selectedAgentRuntime: activeConversation?.agentRuntime ?? "vercel-ai",
        isLoading: false,
        ...(state.activeConversation?.id === event.conversationId
          ? {
              agentRunState: "idle" as const,
              compactionState: "idle" as const,
              commandFeedback: null,
              showApiKeySetupGuidance: false,
            }
          : {}),
      };
    }
    case "conversationUpdated":
      return {
        ...state,
        activeConversation: event.conversation,
        conversations: upsertConversationInList(
          state.conversations,
          event.conversation,
        ),
      };
    case "operationFinished":
      return { ...state, isLoading: false };
    case "operationFailed":
      return { ...state, error: event.error, isLoading: false };
    case "submitStarted":
      return {
        ...state,
        error: null,
        showApiKeySetupGuidance: false,
        commandFeedback: null,
        agentRunState: "running",
        isLoading: true,
      };
    case "submitSucceeded":
      return {
        ...state,
        activeConversation: event.conversation,
        conversations: upsertConversationInList(
          state.conversations,
          event.conversation,
        ),
        agentRunState: "idle",
        compactionState: "idle",
        commandFeedback: null,
        isLoading: false,
      };
    case "submitFailed":
      return {
        ...state,
        error: event.error,
        agentRunState: "failed",
        isLoading: false,
      };
    case "compactStarted":
      return {
        ...state,
        error: null,
        showApiKeySetupGuidance: false,
        commandFeedback: null,
        compactionState: "running",
        isLoading: true,
      };
    case "compactSucceeded":
      return {
        ...state,
        activeConversation: event.conversation,
        conversations: upsertConversationInList(
          state.conversations,
          event.conversation,
        ),
        commandFeedback: event.feedback,
        compactionState: "idle",
        isLoading: false,
      };
    case "compactFailed":
      return {
        ...state,
        error: event.error,
        commandFeedback: null,
        compactionState: "idle",
        isLoading: false,
      };
    case "presentationReset":
      return {
        ...state,
        agentRunState: "idle",
        compactionState: "idle",
        commandFeedback: null,
        showApiKeySetupGuidance: false,
      };
    case "feedbackChanged":
      return { ...state, commandFeedback: event.feedback };
    case "errorChanged":
      return { ...state, error: event.error };
    case "apiKeyGuidanceChanged":
      return { ...state, showApiKeySetupGuidance: event.show };
  }
}

export function useChatConversationState() {
  const [state, dispatch] = useReducer(
    chatConversationReducer,
    initialChatConversationState,
  );
  return { state, dispatch };
}

export type ChatConversationDispatch = ReturnType<
  typeof useChatConversationState
>["dispatch"];
