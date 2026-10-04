import type { ModelMessage } from "ai";
import {
  COMPACT_TOOL_HISTORY_CONVERSATION_MAX_CHARS,
  COMPACT_TOOL_HISTORY_TURN_MAX_CHARS,
  appendCompactHistoryToContent,
  buildCompactHistoryBlock,
} from "./compactToolResult";
import type { Conversation, ConversationCompaction } from "./conversationSchemas";

export type ConversationModelMessageStrategy =
  | "current"
  | "compact-tool-results"
  | "conversation-compaction";

export type ToModelMessagesOptions = {
  strategy?: ConversationModelMessageStrategy;
  siwcAccountId?: string;
};

function latestCompaction(conversation: Conversation): ConversationCompaction | undefined {
  if (conversation.conversationCompactions.length === 0) {
    return undefined;
  }
  return [...conversation.conversationCompactions].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  )[0];
}

function messagesAfterLatestCompaction(conversation: Conversation) {
  const compaction = latestCompaction(conversation);
  if (!compaction) {
    return conversation.messages;
  }
  const throughIndex = conversation.messages.findIndex(
    (message) => message.id === compaction.compactedThroughMessageId,
  );
  if (throughIndex === -1) {
    return conversation.messages;
  }
  return conversation.messages.slice(throughIndex + 1);
}

function compactHistoryBudgets(
  conversation: Conversation,
  messages: Conversation["messages"],
): Map<string, number> {
  const assistantMessageIds = messages
    .filter((message) => message.role === "assistant")
    .map((message) => message.id);
  const assistantsWithHistory = assistantMessageIds.filter(
    (assistantMessageId) => buildCompactHistoryBlock(conversation, assistantMessageId, 1) !== null,
  );
  const budgets = new Map<string, number>();

  if (assistantsWithHistory.length === 0) {
    return budgets;
  }

  const evenBudget = Math.min(
    COMPACT_TOOL_HISTORY_TURN_MAX_CHARS,
    Math.floor(COMPACT_TOOL_HISTORY_CONVERSATION_MAX_CHARS / assistantsWithHistory.length),
  );

  for (const assistantMessageId of assistantMessageIds) {
    if (assistantsWithHistory.includes(assistantMessageId)) {
      budgets.set(assistantMessageId, evenBudget);
    } else {
      budgets.set(assistantMessageId, 0);
    }
  }

  return budgets;
}

function toCompactAssistantContent(
  conversation: Conversation,
  assistantMessageId: string,
  content: string,
  maxChars: number,
): string {
  return appendCompactHistoryToContent(conversation, assistantMessageId, content, maxChars);
}

function convertMessages(
  conversation: Conversation,
  messages: Conversation["messages"],
  useToolCompaction: boolean,
  siwcAccountId?: string,
): ModelMessage[] {
  const historyBudgets = useToolCompaction ? compactHistoryBudgets(conversation, messages) : null;

  return messages.flatMap((message): ModelMessage[] => {
    if (message.role === "user") {
      return [{ content: message.content, role: "user" }];
    }
    if (message.role === "assistant") {
      if (siwcAccountId && message.siwcHistory) {
        if (message.siwcHistory.accountId !== siwcAccountId) throw new Error("account_changed");
        return message.siwcHistory.messages;
      }
      if (useToolCompaction) {
        const maxChars = historyBudgets?.get(message.id) ?? 0;
        const history = buildCompactHistoryBlock(conversation, message.id, maxChars);
        if (!history && message.content.trim() === "") {
          return [];
        }
        return [
          {
            content: toCompactAssistantContent(conversation, message.id, message.content, maxChars),
            role: "assistant",
          },
        ];
      }
      return [{ content: message.content, role: "assistant" }];
    }
    if (message.role === "system") {
      return [{ content: message.content, role: "system" }];
    }
    return [];
  });
}

export function toModelMessages(
  conversation: Conversation,
  options: ToModelMessagesOptions = {},
): ModelMessage[] {
  if (options.siwcAccountId && conversation.siwc?.accountId !== options.siwcAccountId) throw new Error("account_changed");
  const strategy = options.strategy ?? "current";
  const useConversationCompaction = strategy === "conversation-compaction";
  const useToolCompaction =
    strategy === "compact-tool-results" || strategy === "conversation-compaction";
  const messages = useConversationCompaction
    ? messagesAfterLatestCompaction(conversation)
    : conversation.messages;
  const converted = convertMessages(conversation, messages, useToolCompaction, options.siwcAccountId);

  if (!useConversationCompaction) {
    return converted;
  }

  const compaction = latestCompaction(conversation);
  if (!compaction) {
    return converted;
  }

  return [{ content: compaction.summary, role: "system" }, ...converted];
}
