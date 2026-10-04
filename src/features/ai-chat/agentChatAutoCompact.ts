import type {
  AgentChatApplicationInput,
  AgentChatCompactConversationHandler,
} from "./agentChatApplicationTypes";
import type { Conversation, MainContextSnapshot } from "./conversationSchemas";

function latestMainContextSnapshotMessage(
  conversation: Conversation,
): { messageId: string; snapshot: MainContextSnapshot } | null {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    if (message.role === "assistant" && message.mainContextSnapshot) {
      return { messageId: message.id, snapshot: message.mainContextSnapshot };
    }
  }
  return null;
}

export function shouldAutoCompactConversation(input: {
  autoCompactEnabled: boolean;
  autoCompactThresholdRatio: number;
  snapshot: MainContextSnapshot | null;
}): boolean {
  if (!input.autoCompactEnabled || !input.snapshot) return false;
  const { contextWindowTokens, inputTokens } = input.snapshot;
  if (inputTokens === undefined || contextWindowTokens === undefined || contextWindowTokens <= 0) {
    return false;
  }
  return inputTokens / contextWindowTokens >= input.autoCompactThresholdRatio;
}

export async function maybeAutoCompactConversation(input: {
  applicationInput: AgentChatApplicationInput;
  compactConversation: AgentChatCompactConversationHandler;
  dataRoot: string;
  userConversation: Conversation;
}): Promise<Conversation> {
  const snapshotMessage = latestMainContextSnapshotMessage(input.userConversation);
  if (
    !snapshotMessage ||
    !shouldAutoCompactConversation({
      autoCompactEnabled: input.applicationInput.autoCompactEnabled,
      autoCompactThresholdRatio: input.applicationInput.autoCompactThresholdRatio,
      snapshot: snapshotMessage.snapshot,
    })
  ) {
    return input.userConversation;
  }

  try {
    const result = await input.compactConversation({
      compactedThroughMessageId: snapshotMessage.messageId,
      conversationId: input.userConversation.id,
      dataRoot: input.dataRoot,
      workspaceRoot: input.applicationInput.workspaceRoot,
    });
    return result.status === "compacted" ? result.conversation : input.userConversation;
  } catch (error) {
    console.error("Auto conversation compaction failed", {
      conversationId: input.userConversation.id,
      error,
      workspaceRoot: input.applicationInput.workspaceRoot,
    });
    return input.userConversation;
  }
}
