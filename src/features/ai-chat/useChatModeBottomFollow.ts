import { useEffect, useRef } from "react";
import type { AgentPlan, Conversation } from "./conversationSchemas";
import type { ToolActivitySummary } from "./toolActivity";

const CHAT_SCROLL_NEAR_BOTTOM_THRESHOLD_PX = 48;

function isChatScrollNearBottom(element: HTMLElement): boolean {
  const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
  return distanceFromBottom <= CHAT_SCROLL_NEAR_BOTTOM_THRESHOLD_PX;
}

function scrollChatAreaToBottom(element: HTMLElement): void {
  element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
}

export type ChatModeBottomFollowParams = {
  mode?: "chat" | "editor";
  isLoading: boolean;
  activeConversation: Conversation | null;
  streamAssistantContent: string;
  streamReasoningContent: string;
  streamPlan: Pick<AgentPlan, "items"> | null;
  streamToolActivities: ToolActivitySummary[];
  commandFeedback: string | null;
  agentRunState: "idle" | "running" | "failed";
  compactionState: "idle" | "running";
  completedToolFeedbackIds: Set<string>;
  expandedToolActivityGroups: Set<string>;
};

export function useChatModeBottomFollow({
  mode,
  isLoading,
  activeConversation,
  streamAssistantContent,
  streamReasoningContent,
  streamPlan,
  streamToolActivities,
  commandFeedback,
  agentRunState,
  compactionState,
  completedToolFeedbackIds,
  expandedToolActivityGroups,
}: ChatModeBottomFollowParams) {
  const chatScrollAreaRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const chatScrollRequestIdRef = useRef(0);

  function scheduleChatScrollToBottom(force = false) {
    if (mode !== "chat") {
      return;
    }

    const requestId = ++chatScrollRequestIdRef.current;

    window.requestAnimationFrame(() => {
      if (requestId !== chatScrollRequestIdRef.current) {
        return;
      }

      const scrollArea = chatScrollAreaRef.current;
      if (!scrollArea) {
        return;
      }

      if (force || shouldStickToBottomRef.current) {
        scrollChatAreaToBottom(scrollArea);
        shouldStickToBottomRef.current = true;
      }
    });
  }

  function handleChatScrollAreaScroll() {
    if (mode !== "chat") {
      return;
    }

    const scrollArea = chatScrollAreaRef.current;
    if (!scrollArea) {
      return;
    }

    shouldStickToBottomRef.current = isChatScrollNearBottom(scrollArea);
    if (!shouldStickToBottomRef.current) {
      chatScrollRequestIdRef.current += 1;
    }
  }

  useEffect(() => {
    if (mode !== "chat" || isLoading) {
      return;
    }

    shouldStickToBottomRef.current = true;
    scheduleChatScrollToBottom(true);
  }, [mode, isLoading, activeConversation?.id]);

  useEffect(() => {
    if (mode !== "chat" || isLoading) {
      return;
    }

    scheduleChatScrollToBottom(false);
  }, [
    mode,
    isLoading,
    activeConversation?.messages,
    activeConversation?.editProposals,
    streamAssistantContent,
    streamReasoningContent,
    streamPlan,
    streamToolActivities,
    commandFeedback,
    agentRunState,
    compactionState,
    completedToolFeedbackIds,
    expandedToolActivityGroups,
  ]);

  return {
    chatScrollAreaRef,
    handleChatScrollAreaScroll,
  };
}
