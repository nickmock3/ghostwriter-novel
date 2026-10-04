import { generateObject as defaultGenerateObject } from "ai";
import { z } from "zod";
import type { ChatModelSelection, ModelProvider } from "../ai-agent/modelProvider";
import { appendConversationCompaction, getConversation } from "./conversationHistory";
import {
  conversationCompactionSchema,
  type Conversation,
  type ConversationMessage,
  type TokenUsage,
} from "./conversationSchemas";

const compactConversationInputSchema = z.object({
  compactedThroughMessageId: z.string().min(1),
  conversationId: z.string().min(1),
  workspaceRoot: z.string().min(1),
});

const compactionSummarySchema = z.object({
  summary: z.string().min(1),
});

const READ_CAUTION = "現在のファイル内容は必要に応じてReadする。";

type GenerateObjectFunction = (options: {
  model: unknown;
  prompt: string;
  schema: typeof compactionSummarySchema;
}) => Promise<{
  object: unknown;
  usage?: unknown;
}>;

export type CompactConversationModelSelection = ChatModelSelection & {
  profileId?: string;
};

export function toCompactConversationModelSelection(input: {
  modelId: string;
  profileId?: string;
  providerId: string;
}): CompactConversationModelSelection {
  return {
    modelId: input.modelId,
    providerId: input.providerId,
    ...(input.profileId && !input.profileId.startsWith("model:")
      ? { profileId: input.profileId }
      : {}),
  };
}

export type CompactConversationOptions = {
  compactedThroughMessageId: string;
  conversationId: string;
  dataRoot: string;
  generateObject?: GenerateObjectFunction;
  modelProvider: ModelProvider;
  modelSelection: CompactConversationModelSelection;
  workspaceRoot: string;
};

export type CompactConversationResult =
  | { conversation: Conversation; status: "compacted" }
  | { conversation: Conversation; reason: string; status: "skipped" };

function latestCompaction(conversation: Conversation) {
  if (conversation.conversationCompactions.length === 0) {
    return undefined;
  }
  return [...conversation.conversationCompactions].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  )[0];
}

function eligibleCompactionMessages(messages: ConversationMessage[]) {
  return messages.filter(
    (message) =>
      message.role === "user" || message.role === "assistant" || message.role === "system",
  );
}

function compactionRangeMessages(
  conversation: Conversation,
  compactedThroughMessageId: string,
): ConversationMessage[] | null {
  const throughIndex = conversation.messages.findIndex(
    (message) => message.id === compactedThroughMessageId,
  );
  if (throughIndex === -1) {
    return null;
  }

  const checkpoint = latestCompaction(conversation);
  let startIndex = 0;
  if (checkpoint) {
    const checkpointIndex = conversation.messages.findIndex(
      (message) => message.id === checkpoint.compactedThroughMessageId,
    );
    startIndex = checkpointIndex === -1 ? 0 : checkpointIndex + 1;
  }

  if (startIndex > throughIndex) {
    return [];
  }

  return eligibleCompactionMessages(
    conversation.messages.slice(startIndex, throughIndex + 1),
  );
}

function ensureReadCaution(summary: string): string {
  if (summary.includes("現在のファイル内容") && /Read/i.test(summary)) {
    return summary;
  }
  return `${summary.trim()}\n\n${READ_CAUTION}`;
}

function buildCompactionPrompt(
  rangeMessages: ConversationMessage[],
  previousSummary?: string,
): string {
  const sections = [
    "以下の会話を圧縮要約してください。作品状態、ユーザーの希望、決定事項、未解決の作業、最近の編集・作成を含め、現在のファイル内容は必要に応じてReadする注意も含めてください。",
  ];
  if (previousSummary) {
    sections.push("", "[前回の圧縮要約]", previousSummary);
  }
  sections.push("", "[圧縮対象の会話]");
  for (const message of rangeMessages) {
    sections.push(`${message.role}: ${message.content}`);
  }
  return sections.join("\n");
}

function tokenUsageFromGenerateResult(usage: unknown): TokenUsage | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }
  const record = usage as Record<string, unknown>;
  const inputTokens = typeof record.inputTokens === "number" ? record.inputTokens : undefined;
  const outputTokens = typeof record.outputTokens === "number" ? record.outputTokens : undefined;
  const totalTokens = typeof record.totalTokens === "number" ? record.totalTokens : undefined;
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return { inputTokens, outputTokens, totalTokens };
}

export async function compactConversation(
  options: CompactConversationOptions,
): Promise<CompactConversationResult> {
  const parsedInput = compactConversationInputSchema.parse({
    compactedThroughMessageId: options.compactedThroughMessageId,
    conversationId: options.conversationId,
    workspaceRoot: options.workspaceRoot,
  });
  const conversation = await getConversation({
    conversationId: parsedInput.conversationId,
    dataRoot: options.dataRoot,
    workspaceRoot: parsedInput.workspaceRoot,
  });
  const rangeMessages = compactionRangeMessages(
    conversation,
    parsedInput.compactedThroughMessageId,
  );
  if (!rangeMessages || rangeMessages.length === 0) {
    return {
      conversation,
      reason: "Not enough eligible messages to compact",
      status: "skipped",
    };
  }

  const checkpoint = latestCompaction(conversation);
  const generateObject = options.generateObject ?? (defaultGenerateObject as GenerateObjectFunction);
  const model = options.modelProvider.getLanguageModel(
    options.modelSelection.modelId,
    options.modelSelection.providerId,
    options.modelSelection.profileId,
  );
  const result = await generateObject({
    model,
    prompt: buildCompactionPrompt(rangeMessages, checkpoint?.summary),
    schema: compactionSummarySchema,
  });
  const summary = ensureReadCaution(
    compactionSummarySchema.parse(result.object).summary,
  );
  const sourceMessageIds = [
    ...(checkpoint?.sourceMessageIds ?? []),
    ...rangeMessages.map((message) => message.id),
  ];
  const updated = await appendConversationCompaction({
    compactedThroughMessageId: parsedInput.compactedThroughMessageId,
    conversationId: parsedInput.conversationId,
    dataRoot: options.dataRoot,
    sourceMessageIds,
    summary,
    tokenUsage: tokenUsageFromGenerateResult(result.usage),
    workspaceRoot: parsedInput.workspaceRoot,
  });

  conversationCompactionSchema.parse(updated.conversationCompactions.at(-1));

  return {
    conversation: updated,
    status: "compacted",
  };
}
