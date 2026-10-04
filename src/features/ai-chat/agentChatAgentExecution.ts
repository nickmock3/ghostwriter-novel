import { siwcHistorySchema, type SiwcHistory } from "./siwcHistory";
import type { DelegateWritingDiagnostic } from "../ai-agent/runAgentLoop";
import {
  createAgentChatEventAccumulator,
  type AgentChatRunResult,
} from "./agentChatEventAccumulator";
import { createChatModeProposalToolServices } from "./editProposalAutoApply";
import type { Conversation } from "./conversationSchemas";
import { toModelMessages } from "./modelMessages";
import {
  createDroppedTextFileToolServices,
  droppedTextFilesModelContext,
} from "./agentChatConversationPrepare";
import {
  llmErrorLogMessage,
  persistAgentChatFailure,
  persistAgentChatRunResult,
} from "./agentChatRunPersistence";
import type {
  AgentChatApplicationEvent,
  AgentChatApplicationInput,
  AgentChatExecutionContext,
  DroppedTextFileStatusTracker,
  RunAgentLoopFunction,
  StagedDroppedTextFiles,
} from "./agentChatApplicationTypes";
import type { TrustedAgentExtensionCatalog } from "../ai-agent/trustedAgentExtensions";

function logDelegateWritingDiagnostic(diagnostic: DelegateWritingDiagnostic): void {
  try {
    console.error("DelegateWriting diagnostic", {
      diagnostic,
      event: "delegate-writing-diagnostic",
    });
  } catch {
    // Logging failures must not affect DelegateWriting error handling.
  }
}

export async function persistLlmFailure(input: {
  dataRoot: string;
  error: unknown;
  onEvent?: (event: AgentChatApplicationEvent) => void;
  userConversation: Conversation;
  workspaceRoot: string;
}): Promise<never> {
  return persistAgentChatFailure({
    content: llmErrorLogMessage(input.error),
    dataRoot: input.dataRoot,
    error: input.error,
    fallbackErrorMessage: "LLM execution failed",
    logEvent: "Agent chat LLM execution failed",
    logPayload: {
      error: input.error,
      workspaceRoot: input.workspaceRoot,
    },
    onEvent: input.onEvent,
    userConversation: input.userConversation,
    workspaceRoot: input.workspaceRoot,
  });
}

export async function executeVercelAgentChat(input: {
  applicationInput: AgentChatApplicationInput;
  conversationForAgent: Conversation;
  dataRoot: string;
  droppedTextFiles?: StagedDroppedTextFiles;
  executionContext: AgentChatExecutionContext;
  onEvent?: (event: AgentChatApplicationEvent) => void;
  runAgentLoop: RunAgentLoopFunction;
  statusTracker: DroppedTextFileStatusTracker;
  trustedAgentExtensions: TrustedAgentExtensionCatalog;
  userConversation: Conversation;
}): Promise<AgentChatRunResult> {
  let siwcHistory: SiwcHistory | undefined;
  const siwc = input.executionContext.modelProvider.siwc;
  const mainResolvedProfile = input.executionContext.resolveRoleProfile("main");
  const accumulator = createAgentChatEventAccumulator({
    mainProfile: {
      contextWindowTokens: mainResolvedProfile.contextWindowTokens,
      id: mainResolvedProfile.id,
      llmProfileRole: "main",
      modelId: mainResolvedProfile.modelId,
      providerId: mainResolvedProfile.providerId,
    },
  });

  try {
    const messages = toModelMessages(input.conversationForAgent, {
      strategy: "conversation-compaction",
      siwcAccountId: siwc?.accountId,
    });
    const droppedFilesContext = droppedTextFilesModelContext(input.droppedTextFiles);
    if (droppedFilesContext) {
      messages.unshift({ content: droppedFilesContext, role: "system" });
    }

    for await (const event of input.runAgentLoop({
      messages,
      ...(siwc ? { onResponseMessages: (messages: unknown) => { siwcHistory = siwcHistorySchema.parse({ ...siwc, messages }); } } : {}),
      modelProvider: input.executionContext.modelProvider,
      onDelegateWritingDiagnostic: logDelegateWritingDiagnostic,
      onToolProgress: (event) => {
        accumulator.consume(event).forEach((effect) => input.onEvent?.(effect));
      },
      profile: input.executionContext.profile,
      ...(input.executionContext.currentFilePath
        ? { currentFilePath: input.executionContext.currentFilePath }
        : {}),
      resolveLlmProfileForRole: input.executionContext.resolveRoleProfile,
      trustedAgentExtensions: input.trustedAgentExtensions,
      ...(input.applicationInput.mode === "chat"
        ? {
            toolServices: {
              ...createChatModeProposalToolServices({ dataRoot: input.dataRoot, conversationId: input.userConversation.id, workspaceRoot: input.applicationInput.workspaceRoot }),
              ...createDroppedTextFileToolServices({
                dataRoot: input.dataRoot,
                conversationId: input.userConversation.id,
                droppedTextFiles: input.droppedTextFiles,
                statusTracker: input.statusTracker,
                workspaceRoot: input.applicationInput.workspaceRoot,
              }),
            },
          }
        : {}),
      workspaceRoot: input.applicationInput.workspaceRoot,
    })) {
      accumulator.consume(event).forEach((effect) => input.onEvent?.(effect));
    }
  } catch (error) {
    for (const activity of accumulator.result().toolActivities) {
      if (activity.status !== "running") continue;
      accumulator.consume({
        type: "tool-result", toolCallId: activity.toolCallId, toolName: activity.toolName,
        output: { status: "error", message: "AIの応答が中断されたため、完了を確認できませんでした。" },
      }).forEach((effect) => input.onEvent?.(effect));
    }
    const partialConversation = await persistAgentChatRunResult({
      autoApplyProposals: false,
      dataRoot: input.dataRoot,
      runResult: accumulator.result(),
      userConversation: input.userConversation,
      workspaceRoot: input.applicationInput.workspaceRoot,
    });
    return persistLlmFailure({
      dataRoot: input.dataRoot,
      error,
      onEvent: input.onEvent,
      userConversation: partialConversation,
      workspaceRoot: input.applicationInput.workspaceRoot,
    });
  }

  return { ...accumulator.result(), ...(siwcHistory ? { siwcHistory } : {}) };
}
