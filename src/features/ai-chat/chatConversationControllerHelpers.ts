import type { Conversation } from "./conversationSchemas";

export type WorkspaceOperationGeneration = {
  begin: () => number;
  bump: () => number;
  isStale: (operationGeneration: number) => boolean;
  current: () => number;
};

export function createWorkspaceOperationGeneration(
  initialGeneration = 0,
): WorkspaceOperationGeneration {
  let generation = initialGeneration;

  return {
    begin() {
      return generation;
    },
    bump() {
      generation += 1;
      return generation;
    },
    current() {
      return generation;
    },
    isStale(operationGeneration) {
      return operationGeneration !== generation;
    },
  };
}

export function upsertConversationInList(
  conversations: Conversation[],
  conversation: Conversation,
): Conversation[] {
  return [conversation, ...conversations.filter((item) => item.id !== conversation.id)];
}

export function removeConversationFromList(
  conversations: Conversation[],
  conversationId: string,
): Conversation[] {
  return conversations.filter((item) => item.id !== conversationId);
}
