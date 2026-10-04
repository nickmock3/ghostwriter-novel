import {
  appendConversationEditProposal,
  appendConversationMessage,
  appendConversationPlan,
  appendConversationToolActivities,
  appendConversationToolResultSummaries,
  applyConversationEditProposal,
} from "./conversationHistory";
import {
  toolActivitiesForAssistantMessage,
  toolResultSummariesForAssistantMessage,
  type AgentChatRunResult,
} from "./agentChatEventAccumulator";
import {
  conversationSchema,
  type Conversation,
  type ConversationMessageWarning,
} from "./conversationSchemas";
import type { AgentChatApplicationEvent } from "./agentChatApplicationTypes";

const CHAT_MODE_TOOL_FAILURES_WARNING: ConversationMessageWarning = {
  message:
    "ツール呼び出しの失敗が続いています。選択中のモデルはチャットモードで必要なファイル操作に十分対応していない可能性があります。LLMプロフィール設定でツール対応の強いモデルへ変更してください。",
  type: "chat_mode_tool_failures",
};

export type PersistAgentChatRunResultInput = {
  autoApplyProposals: boolean;
  dataRoot: string;
  runResult: AgentChatRunResult;
  userConversation: Conversation;
  workspaceRoot: string;
};

export type PersistAgentChatFailureInput = {
  content: string;
  dataRoot: string;
  error: unknown;
  fallbackErrorMessage: string;
  logEvent: string;
  logPayload?: Record<string, unknown>;
  onEvent?: (event: AgentChatApplicationEvent) => void;
  userConversation: Conversation;
  workspaceRoot: string;
};

export function warningsForAssistantMessage(input: {
  chatMode: boolean;
  failedToolResultCount: number;
  finishReason: string | undefined;
}): ConversationMessageWarning[] | undefined {
  const warnings: ConversationMessageWarning[] = [];

  if (input.finishReason === "tool-calls") {
    warnings.push({
      message: "処理回数の上限に達したため、ここで一度停止しました。作成済みの編集案・保存済みの内容は残っています。「続けて」と送信すると残りの作業を依頼できます。",
      type: "step_limit",
    });
  }

  if (input.finishReason === "length") {
    warnings.push({
      message: "出力上限に達したため応答が途中で止まった可能性があります。",
      type: "output_limit",
    });
  }

  if (input.chatMode && input.failedToolResultCount >= 2) {
    warnings.push(CHAT_MODE_TOOL_FAILURES_WARNING);
  }

  return warnings.length > 0 ? warnings : undefined;
}

async function maybeAutoApplyPendingProposal(input: {
  autoApplyProposals: boolean;
  conversation: Conversation;
  dataRoot: string;
  proposalId: string;
  workspaceRoot: string;
}): Promise<Conversation> {
  const proposal = input.conversation.editProposals.find(
    (candidate) => candidate.id === input.proposalId,
  );
  if (!input.autoApplyProposals || proposal?.status !== "pending") {
    return input.conversation;
  }

  return applyConversationEditProposal({
    conversationId: input.conversation.id,
    dataRoot: input.dataRoot,
    dirtyPaths: [],
    proposalId: proposal.id,
    workspaceRoot: input.workspaceRoot,
  });
}

export async function persistAgentChatFailure(
  input: PersistAgentChatFailureInput,
): Promise<never> {
  console.error(input.logEvent, {
    conversationId: input.userConversation.id,
    ...(input.logPayload ?? { error: input.error }),
  });
  const updatedConversation = await appendConversationMessage({
    content: input.content,
    conversationId: input.userConversation.id,
    dataRoot: input.dataRoot,
    role: "system",
    workspaceRoot: input.workspaceRoot,
  });
  const conversation = conversationSchema.parse(updatedConversation);
  input.onEvent?.({ conversation, type: "conversation" });
  throw Object.assign(
    input.error instanceof Error ? input.error : new Error(input.fallbackErrorMessage),
    { conversation },
  );
}

export function llmErrorLogMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "LLM execution failed";
  return `LLMエラー: ${message}`;
}

export async function persistAgentChatRunResult(
  input: PersistAgentChatRunResultInput,
): Promise<Conversation> {
  const warnings = warningsForAssistantMessage({
    chatMode: input.autoApplyProposals,
    failedToolResultCount: input.runResult.failedToolResultCount,
    finishReason: input.runResult.finishReason,
  });
  let updatedConversation = input.userConversation;
  if (
    input.runResult.assistantContent.trim() ||
    input.runResult.toolActivities.length > 0 ||
    input.runResult.editProposals.length > 0 ||
    input.runResult.currentPlanItems
  ) {
    updatedConversation = await appendConversationMessage({
      ...(input.runResult.siwcHistory ? { siwcHistory: input.runResult.siwcHistory } : {}),
      content: input.runResult.assistantContent,
      conversationId: updatedConversation.id,
      dataRoot: input.dataRoot,
      ...(input.runResult.finishReason ? { finishReason: input.runResult.finishReason } : {}),
      ...(input.runResult.mainContextSnapshot
        ? { mainContextSnapshot: input.runResult.mainContextSnapshot }
        : {}),
      role: "assistant",
      ...(input.runResult.tokenUsage ? { tokenUsage: input.runResult.tokenUsage } : {}),
      ...(warnings ? { warnings } : {}),
      workspaceRoot: input.workspaceRoot,
    });
  }

  const assistantMessage = updatedConversation.messages.at(-1);
  if (assistantMessage?.role !== "assistant") return updatedConversation;

  for (const proposal of input.runResult.editProposals) {
    updatedConversation = await appendConversationEditProposal({
      assistantMessageId: assistantMessage.id,
      conversationId: updatedConversation.id,
      createdAt: proposal.createdAt,
      dataRoot: input.dataRoot,
      diff: proposal.diff,
      newText: proposal.newText,
      oldText: proposal.oldText,
      operation: proposal.operation,
      path: proposal.path,
      proposalId: proposal.id,
      ...(proposal.sourceRole ? { sourceRole: proposal.sourceRole } : {}),
      status: proposal.status,
      title: proposal.title,
      ...(proposal.undoSnapshot ? { undoSnapshot: proposal.undoSnapshot } : {}),
      updatedAt: proposal.updatedAt,
      workspaceRoot: input.workspaceRoot,
    });

    updatedConversation = await maybeAutoApplyPendingProposal({
      autoApplyProposals: input.autoApplyProposals,
      conversation: updatedConversation,
      dataRoot: input.dataRoot,
      proposalId: proposal.id,
      workspaceRoot: input.workspaceRoot,
    });
  }

  updatedConversation = await appendConversationToolActivities({
    conversationId: updatedConversation.id,
    dataRoot: input.dataRoot,
    toolActivities: toolActivitiesForAssistantMessage(
      input.runResult.toolActivities,
      assistantMessage.id,
    ),
    workspaceRoot: input.workspaceRoot,
  });
  updatedConversation = await appendConversationToolResultSummaries({
    conversationId: updatedConversation.id,
    dataRoot: input.dataRoot,
    toolResultSummaries: toolResultSummariesForAssistantMessage(
      input.runResult.toolResultSummaries,
      assistantMessage.id,
    ),
    workspaceRoot: input.workspaceRoot,
  });

  if (input.runResult.currentPlanItems) {
    updatedConversation = await appendConversationPlan({
      assistantMessageId: assistantMessage.id,
      conversationId: updatedConversation.id,
      dataRoot: input.dataRoot,
      items: input.runResult.currentPlanItems,
      workspaceRoot: input.workspaceRoot,
    });
  }

  return updatedConversation;
}
