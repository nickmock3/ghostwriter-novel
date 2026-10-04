import type { AgentPlan, Conversation, EditProposal } from "./conversationSchemas";
import type { ToolActivitySummary } from "./toolActivity";

type AssistantLinkedItem = {
  assistantMessageId?: string;
};

export function lastAssistantMessageId(
  messages: Conversation["messages"],
): string | undefined {
  let messageId: string | undefined;
  for (const message of messages) {
    if (message.role === "assistant") {
      messageId = message.id;
    }
  }
  return messageId;
}

function itemsForAssistantMessage<T extends AssistantLinkedItem>(
  items: T[],
  messages: Conversation["messages"],
  messageId: string,
): T[] {
  const fallbackMessageId = lastAssistantMessageId(messages);
  return items.filter(
    (item) =>
      item.assistantMessageId === messageId ||
      (!item.assistantMessageId && messageId === fallbackMessageId),
  );
}

export function toolActivitiesForMessage(
  activities: Array<ToolActivitySummary | Conversation["toolActivities"][number]>,
  messages: Conversation["messages"],
  messageId: string,
) {
  return itemsForAssistantMessage(activities, messages, messageId);
}

export function editProposalsForMessage(
  proposals: EditProposal[],
  messages: Conversation["messages"],
  messageId: string,
) {
  return itemsForAssistantMessage(proposals, messages, messageId);
}

export function plansForMessage(
  plans: AgentPlan[],
  messages: Conversation["messages"],
  messageId: string,
) {
  return itemsForAssistantMessage(plans, messages, messageId);
}

export function orphanEditProposals(
  proposals: EditProposal[],
  messages: Conversation["messages"],
) {
  return lastAssistantMessageId(messages) === undefined ? proposals : [];
}
