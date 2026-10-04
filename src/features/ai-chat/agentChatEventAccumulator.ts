import type { SiwcHistory } from "./siwcHistory";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentLoopEvent } from "../ai-agent/runAgentLoop";
import { addTokenUsage, tokenUsageFromUnknown } from "../ai-agent/agentTokenUsage";
import { summarizeCompactToolResult } from "./compactToolResult";
import {
  editProposalSchema,
  planItemSchema,
  type MainContextSnapshot,
  type PlanItem,
  type TokenUsage,
  type ToolActivity,
  type ToolResultSummary,
} from "./conversationSchemas";
import { summarizeToolActivity, type ToolActivitySummary } from "./toolActivity";

export type AgentChatEventAccumulatorProfile = {
  contextWindowTokens: number;
  id: string;
  llmProfileRole: "main";
  modelId: string;
  providerId: string;
};

export type AgentChatStreamEffect =
  | { text: string; type: "reasoning-delta" }
  | { text: string; type: "text-delta" }
  | { activity: ToolActivitySummary; type: "tool-activity" }
  | { plan: { items: PlanItem[] }; type: "plan-update" };

export type AgentChatRunResult = {
  siwcHistory?: SiwcHistory;
  assistantContent: string;
  currentPlanItems: PlanItem[] | null;
  editProposals: Array<z.infer<typeof editProposalSchema>>;
  failedToolResultCount: number;
  finishReason: string | undefined;
  mainContextSnapshot: MainContextSnapshot | null;
  tokenUsage: TokenUsage | null;
  toolActivities: ToolActivity[];
  toolResultSummaries: Array<Omit<ToolResultSummary, "assistantMessageId">>;
};

type Options = {
  createId?: () => string;
  mainProfile: AgentChatEventAccumulatorProfile;
  now?: () => string;
};

function isEditProposalLike(value: unknown) {
  return editProposalSchema
    .pick({
      persistedProposalId: true,
      createdAt: true,
      diff: true,
      newText: true,
      oldText: true,
      operation: true,
      path: true,
      sourceRole: true,
      status: true,
      title: true,
      undoSnapshot: true,
      updatedAt: true,
    })
    .partial({
      createdAt: true,
      operation: true,
      sourceRole: true,
      status: true,
      undoSnapshot: true,
      updatedAt: true,
    })
    .safeParse(value);
}

function parsePlanUpdate(value: unknown): PlanItem[] | null {
  const parsed = z
    .object({ items: z.array(planItemSchema).min(1) })
    .refine(
      (plan) => plan.items.filter((item) => item.status === "in_progress").length <= 1,
      "Only one plan item can be in_progress",
    )
    .safeParse(value);
  return parsed.success ? parsed.data.items : null;
}

function tokenUsageFromToolOutput(value: unknown): TokenUsage | null {
  if (typeof value !== "object" || value === null || !("tokenUsage" in value)) return null;
  return tokenUsageFromUnknown((value as { tokenUsage?: unknown }).tokenUsage);
}

function finishReasonFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isFailedToolResultOutput(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    "status" in output &&
    (output as { status?: unknown }).status === "error"
  );
}

function previousActivitySummary(activity: ToolActivity | undefined): ToolActivitySummary | undefined {
  return activity
    ? {
        detail: activity.detail,
        label: activity.label,
        status: activity.status,
        toolCallId: activity.toolCallId,
        toolName: activity.toolName,
      }
    : undefined;
}

function activityListFromMap(activityMap: Map<string, ToolActivity>): ToolActivity[] {
  return Array.from(activityMap.values()).sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
  );
}

function summaryListFromMap(
  summaryMap: Map<string, Omit<ToolResultSummary, "assistantMessageId">>,
): Array<Omit<ToolResultSummary, "assistantMessageId">> {
  return Array.from(summaryMap.values()).sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
  );
}

export function toolActivitiesForAssistantMessage(
  toolActivities: ToolActivity[],
  assistantMessageId: string,
): ToolActivity[] {
  return toolActivities.map((activity) => ({ ...activity, assistantMessageId }));
}

export function toolResultSummariesForAssistantMessage(
  toolResultSummaries: Array<Omit<ToolResultSummary, "assistantMessageId">>,
  assistantMessageId: string,
): ToolResultSummary[] {
  return toolResultSummaries.map((summary) => ({ ...summary, assistantMessageId }));
}

export function createAgentChatEventAccumulator(options: Options) {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? randomUUID;
  const activityMap = new Map<string, ToolActivity>();
  const toolCallInputMap = new Map<string, unknown>();
  const summaryMap = new Map<string, Omit<ToolResultSummary, "assistantMessageId">>();
  let assistantContent = "";
  const editProposals: Array<z.infer<typeof editProposalSchema>> = [];
  let currentPlanItems: PlanItem[] | null = null;
  let finishReason: string | undefined;
  let failedToolResultCount = 0;
  let tokenUsage: TokenUsage | null = null;
  let mainContextSnapshot: MainContextSnapshot | null = null;
  const tokenUsageMetadata: TokenUsage = {
    llmProfileId: options.mainProfile.id,
    llmProfileRole: options.mainProfile.llmProfileRole,
    modelId: options.mainProfile.modelId,
    providerId: options.mainProfile.providerId,
  };

  function consume(event: AgentLoopEvent): AgentChatStreamEffect[] {
    // Display-only: never add reasoning to the persisted answer or model history.
    if (event.type === "reasoning-delta") return [event];
    if (event.type === "text-delta") {
      assistantContent += event.text;
      return [{ text: event.text, type: "text-delta" }];
    }

    if (event.type === "finish-step") {
      const stepUsage = tokenUsageFromUnknown(event.usage);
      if (stepUsage?.inputTokens !== undefined) {
        mainContextSnapshot = {
          contextWindowTokens: options.mainProfile.contextWindowTokens,
          inputTokens: stepUsage.inputTokens,
          llmProfileRole: "main",
          modelId: options.mainProfile.modelId,
          providerId: options.mainProfile.providerId,
        };
      }
      return [];
    }

    if (event.type === "finish") {
      finishReason = finishReasonFromUnknown(event.finishReason);
      const finishUsage = tokenUsageFromUnknown(event.totalUsage);
      tokenUsage = addTokenUsage(
        tokenUsage,
        finishUsage ? { ...finishUsage, ...tokenUsageMetadata } : null,
      );
      return [];
    }

    if (event.toolName === "UpdatePlan" && event.type === "tool-call") return [];
    if (event.toolName === "UpdatePlan" && event.type === "tool-result") {
      const planItems = parsePlanUpdate(event.output);
      if (!planItems) return [];
      currentPlanItems = planItems;
      return [{ plan: { items: planItems }, type: "plan-update" }];
    }

    if (event.type === "tool-progress") {
      const previous = activityMap.get(event.toolCallId);
      if (!previous || previous.status !== "running") return [];
      const activity = { ...previous, detail: `本文を生成中・${event.generatedCharacters}文字受信` };
      activityMap.set(event.toolCallId, activity);
      return [{ activity, type: "tool-activity" }];
    }

    if (event.type === "tool-call") toolCallInputMap.set(event.toolCallId, event.input);

    const previousActivity = activityMap.get(event.toolCallId);
    const activity = summarizeToolActivity(event, previousActivitySummary(previousActivity));
    const effects: AgentChatStreamEffect[] = [];
    if (activity) {
      activityMap.set(event.toolCallId, {
        ...activity,
        createdAt: previousActivity?.createdAt ?? now(),
        id: previousActivity?.id ?? createId(),
      });
      effects.push({ activity, type: "tool-activity" });
    }

    if (event.type !== "tool-result") return effects;

    if (isFailedToolResultOutput(event.output)) failedToolResultCount += 1;
    tokenUsage = addTokenUsage(tokenUsage, tokenUsageFromToolOutput(event.output));
    summaryMap.set(event.toolCallId, {
      createdAt: now(),
      summary: summarizeCompactToolResult({
        input: toolCallInputMap.get(event.toolCallId),
        output: event.output,
        toolName: event.toolName,
      }),
      toolCallId: event.toolCallId,
      toolName: event.toolName,
    });

    if (
      event.toolName === "Edit" ||
      event.toolName === "Create" ||
      event.toolName === "CreateDirectory" ||
      event.toolName === "CreateWritingEditProposal" ||
      event.toolName === "PlaceDroppedTextFile"
    ) {
      const parsedProposal = isEditProposalLike(event.output);
      if (parsedProposal.success) {
        const createdAt = parsedProposal.data.createdAt ?? now();
        editProposals.push(
          editProposalSchema.parse({
            ...parsedProposal.data,
            createdAt,
            id: parsedProposal.data.persistedProposalId ?? event.toolCallId,
            status: parsedProposal.data.status ?? "pending",
            updatedAt: parsedProposal.data.updatedAt ?? createdAt,
          }),
        );
      }
    }
    return effects;
  }

  function result(): AgentChatRunResult {
    return {
      assistantContent,
      currentPlanItems,
      editProposals: [...editProposals],
      failedToolResultCount,
      finishReason,
      mainContextSnapshot,
      tokenUsage,
      toolActivities: activityListFromMap(activityMap),
      toolResultSummaries: summaryListFromMap(summaryMap),
    };
  }

  return { consume, result };
}
