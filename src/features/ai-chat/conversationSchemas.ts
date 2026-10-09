import { planItemSchema } from "../ai-agent/agentPlan";
export { planItemSchema, planItemStatusSchema } from "../ai-agent/agentPlan";
export type { PlanItem } from "../ai-agent/agentPlan";
import { siwcBindingSchema, siwcHistorySchema } from "./siwcHistory";
import { z } from "zod";
import { editProposalSchema } from "../edit-proposals/editProposalSchemas";

export { editProposalSchema, editProposalUndoSnapshotSchema } from "../edit-proposals/editProposalSchemas";
export type { EditProposal, EditProposalUndoSnapshot } from "../edit-proposals/editProposalSchemas";

import { COMPACT_TOOL_RESULT_SUMMARY_MAX_CHARS } from "./compactToolResult";

export const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  llmProfileId: z.string().min(1).optional(),
  llmProfileRole: z.enum(["main", "writing", "simple", "search"]).optional(),
  providerId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
});

export const conversationMessageWarningSchema = z.object({
  message: z.string().min(1),
  type: z.enum(["chat_mode_tool_failures", "output_limit", "step_limit"]),
});

export const mainContextSnapshotSchema = z.object({
  contextWindowTokens: z.number().int().positive(),
  inputTokens: z.number().int().nonnegative(),
  llmProfileRole: z.literal("main"),
  modelId: z.string().min(1),
  providerId: z.string().min(1),
});

export const conversationMessageSchema = z.object({
  siwcHistory: siwcHistorySchema.optional(),
  content: z.string(),
  createdAt: z.string().datetime(),
  finishReason: z.string().min(1).optional(),
  id: z.string().min(1),
  mainContextSnapshot: mainContextSnapshotSchema.optional(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  tokenUsage: tokenUsageSchema.optional(),
  warnings: z.array(conversationMessageWarningSchema).optional(),
});

export const toolActivitySchema = z.object({
  assistantMessageId: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  detail: z.string().min(1).optional(),
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(["running", "completed", "failed"]),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
});

export const agentPlanSchema = z
  .object({
    assistantMessageId: z.string().min(1).optional(),
    createdAt: z.string().datetime(),
    id: z.string().min(1),
    items: z.array(planItemSchema).min(1),
    updatedAt: z.string().datetime(),
  })
  .refine(
    (plan) => plan.items.filter((item) => item.status === "in_progress").length <= 1,
    "Only one plan item can be in_progress",
  );

export const toolResultSummarySchema = z.object({
  assistantMessageId: z.string().min(1),
  createdAt: z.string().datetime(),
  summary: z.string().min(1).max(COMPACT_TOOL_RESULT_SUMMARY_MAX_CHARS),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
});

export const agentRuntimeSchema = z.enum(["vercel-ai", "codex-app-server"]);

export const codexTurnPhaseSchema = z.enum([
  "idle",
  "starting",
  "accepted",
  "tooling",
  "failed",
]);

export const codexTurnStateSchema = z.object({
  phase: codexTurnPhaseSchema,
  turnId: z.string().min(1).optional(),
});

export const codexRuntimeMetadataSchema = z.object({
  model: z.string().min(1),
  modelProvider: z.string().min(1),
  protocolVersion: z.literal("v2"),
  userAgentOrCliVersion: z.string().min(1),
});

export const conversationCompactionSchema = z.object({
  compactedThroughCreatedAt: z.string().datetime(),
  compactedThroughMessageId: z.string().min(1),
  createdAt: z.string().datetime(),
  id: z.string().min(1),
  sourceMessageIds: z.array(z.string().min(1)).min(1),
  summary: z.string().min(1),
  tokenUsage: tokenUsageSchema.optional(),
});

export const conversationSchema = z.object({
  siwc: siwcBindingSchema.optional(),
  agentRuntime: agentRuntimeSchema.default("vercel-ai"),
  codexRuntimeMetadata: codexRuntimeMetadataSchema.optional(),
  codexThreadId: z.string().min(1).optional(),
  codexTurnState: codexTurnStateSchema.default({ phase: "idle" }),
  conversationCompactions: z.array(conversationCompactionSchema).default([]),
  createdAt: z.string().datetime(),
  editProposals: z.array(editProposalSchema),
  editRecovery: editProposalSchema.optional(),
  id: z.string().min(1),
  lastOpenedAt: z.string().datetime(),
  messages: z.array(conversationMessageSchema),
  plans: z.array(agentPlanSchema).default([]),
  selectedCodexModel: z.string().min(1).nullable().optional(),
  toolActivities: z.array(toolActivitySchema).default([]),
  toolResultSummaries: z.array(toolResultSummarySchema).default([]),
  title: z.string().min(1),
  updatedAt: z.string().datetime(),
  workspaceId: z.string().min(1),
});

export const conversationListResponseSchema = z.object({
  activeConversation: conversationSchema.nullable(),
  conversations: z.array(conversationSchema),
  errors: z.array(
    z.object({
      fileName: z.string(),
      message: z.string(),
    }),
  ),
});

export type CodexTurnPhase = z.infer<typeof codexTurnPhaseSchema>;
export type CodexTurnState = z.infer<typeof codexTurnStateSchema>;
export type CodexRuntimeMetadata = z.infer<typeof codexRuntimeMetadataSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type ConversationMessageWarning = z.infer<typeof conversationMessageWarningSchema>;
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;
export type AgentPlan = z.infer<typeof agentPlanSchema>;
export type ToolActivity = z.infer<typeof toolActivitySchema>;
export type ToolResultSummary = z.infer<typeof toolResultSummarySchema>;
export type ConversationCompaction = z.infer<typeof conversationCompactionSchema>;
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export type MainContextSnapshot = z.infer<typeof mainContextSnapshotSchema>;
