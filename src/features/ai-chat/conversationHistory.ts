import { siwcBindingSchema, siwcHistorySchema, type SiwcHistory } from "./siwcHistory";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, realpath, readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolveWorkspaceRoot } from "../workspace/workspacePaths";
import {
  conversationSchema,
  type AgentPlan,
  type Conversation,
  type ConversationCompaction,
  type CodexRuntimeMetadata,
  type CodexTurnState,
  type ConversationMessageWarning,
  type EditProposal,
  type MainContextSnapshot,
  type TokenUsage,
  type ToolActivity,
  type ToolResultSummary,
} from "./conversationSchemas";
import { resolveServerDataRoot } from "../../shared/server/runtimeConfig";
import { applyEditProposal, createEditProposalForWorkspace, rejectEditProposal, undoEditProposal } from "../edit-proposals/editProposalService";
import { latestUndoableProposalId as latestUndoableProposalIdFromProposals } from "./editProposalUndo";
import { replaceConversationJson, withConversationFileLock } from "./conversationStorage";
import { recoverConversationEdit } from "./conversationEditRecovery";

export type ConversationHistoryError = {
  fileName: string;
  message: string;
};

export type ConversationHistoryOptions = {
  dataRoot: string;
  workspaceRoot: string;
};

type AppendMessageOptions = ConversationHistoryOptions & {
  siwcHistory?: SiwcHistory;
  content: string;
  conversationId: string;
  finishReason?: string;
  mainContextSnapshot?: MainContextSnapshot;
  role: "user" | "assistant" | "system" | "tool";
  tokenUsage?: TokenUsage;
  warnings?: ConversationMessageWarning[];
};

type AppendEditProposalOptions = ConversationHistoryOptions & {
  assistantMessageId?: string;
  conversationId: string;
  createdAt?: string;
  diff?: string;
  newText: string;
  oldText: string;
  operation?: EditProposal["operation"];
  path: string;
  proposalId?: string;
  sourceRole?: EditProposal["sourceRole"];
  status?: EditProposal["status"];
  title?: string;
  undoSnapshot?: EditProposal["undoSnapshot"];
  updatedAt?: string;
};

type ApplyEditProposalOptions = ConversationHistoryOptions & {
  conversationId: string;
  dirtyPaths: string[];
  proposalId: string;
};

type RejectEditProposalOptions = ConversationHistoryOptions & {
  conversationId: string;
  proposalId: string;
};

type UndoEditProposalOptions = ConversationHistoryOptions & {
  conversationId: string;
  proposalId: string;
};

type UpdateToolActivitiesOptions = ConversationHistoryOptions & {
  conversationId: string;
  toolActivities: ToolActivity[];
};

type AppendToolResultSummariesOptions = ConversationHistoryOptions & {
  conversationId: string;
  toolResultSummaries: ToolResultSummary[];
};

type AppendConversationPlanOptions = ConversationHistoryOptions & {
  assistantMessageId?: string;
  conversationId: string;
  items: AgentPlan["items"];
};

type AppendConversationCompactionOptions = ConversationHistoryOptions & {
  compactedThroughMessageId: string;
  conversationId: string;
  sourceMessageIds: string[];
  summary: string;
  tokenUsage?: TokenUsage;
};

export function defaultConversationDataRoot() {
  return resolveServerDataRoot({ cwd: process.cwd(), env: process.env });
}

export function workspaceIdForRoot(workspaceRoot: string): string {
  return createHash("sha256").update(path.resolve(workspaceRoot)).digest("hex").slice(0, 24);
}

function conversationFilePath(dataRoot: string, workspaceId: string, conversationId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(conversationId)) throw new Error("Invalid conversation id");
  return path.join(dataRoot, "conversations", workspaceId, `${conversationId}.json`);
}

async function conversationDirectory(options: ConversationHistoryOptions) {
  const workspaceRoot = await resolveWorkspaceRoot(options.workspaceRoot);
  const workspaceId = workspaceIdForRoot(workspaceRoot);
  const directory = path.join(options.dataRoot, "conversations", workspaceId);
  await mkdir(directory, { recursive: true });
  return { directory: await realpath(directory), workspaceId };
}

function nowIso() {
  return new Date().toISOString();
}

function hasHiddenPathSegment(workspaceRelativePath: string): boolean {
  return workspaceRelativePath.split(/[\\/]+/).some((segment) => segment.startsWith("."));
}

async function readConversationFile(filePath: string): Promise<Conversation> {
  try {
    return conversationSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      throw new Error("Invalid conversation history file");
    }
    throw error;
  }
}

async function writeConversationFile(
  dataRoot: string,
  conversation: Conversation,
): Promise<Conversation> {
  const filePath = conversationFilePath(dataRoot, conversation.workspaceId, conversation.id);
  await mkdir(path.dirname(filePath), { recursive: true });
  await replaceConversationJson(filePath, conversation);
  return conversation;
}

async function accessConversation<T>(
  options: ConversationHistoryOptions & { conversationId: string },
  action: (conversation: Conversation, filePath: string) => Promise<T>,
): Promise<T> {
  // Validate before creating paths and canonicalize aliases for the process queue.
  conversationFilePath(options.dataRoot, "", options.conversationId);
  const { directory, workspaceId } = await conversationDirectory(options);
  const filePath = path.join(directory, `${options.conversationId}.json`);
  return withConversationFileLock(filePath, async () => {
    const stored = await readConversationFile(filePath);
    if (stored.id !== options.conversationId || stored.workspaceId !== workspaceId) {
      throw new Error("Conversation history identity mismatch");
    }
    const conversation = await recoverConversationEdit(stored, options.workspaceRoot);
    if (conversation !== stored) await replaceConversationJson(filePath, conversation);
    return action(conversation, filePath);
  });
}

type CreateConversationOptions = ConversationHistoryOptions & {
  agentRuntime?: Conversation["agentRuntime"];
};

export async function createConversation(
  options: CreateConversationOptions,
): Promise<Conversation> {
  const { workspaceId } = await conversationDirectory(options);
  const createdAt = nowIso();
  const agentRuntime = options.agentRuntime ?? "vercel-ai";
  const conversation: Conversation = {
    agentRuntime,
    codexTurnState: { phase: "idle" },
    conversationCompactions: [],
    createdAt,
    editProposals: [],
    id: randomUUID(),
    lastOpenedAt: createdAt,
    messages: [],
    plans: [],
    toolActivities: [],
    toolResultSummaries: [],
    title: "新規会話",
    updatedAt: createdAt,
    workspaceId,
  };

  return writeConversationFile(options.dataRoot, conversation);
}

export async function appendConversationMessage(
  options: AppendMessageOptions,
): Promise<Conversation> {
  return accessConversation(options, async (conversation) => {
    const createdAt = nowIso();
    const updated: Conversation = {
      ...conversation,
      lastOpenedAt: createdAt,
      messages: [
        ...conversation.messages,
        {
          ...(options.siwcHistory ? { siwcHistory: siwcHistorySchema.parse(options.siwcHistory) } : {}),
          content: options.content,
          createdAt,
          ...(options.finishReason ? { finishReason: options.finishReason } : {}),
          id: randomUUID(),
          role: options.role,
          ...(options.mainContextSnapshot ? { mainContextSnapshot: options.mainContextSnapshot } : {}),
          ...(options.tokenUsage ? { tokenUsage: options.tokenUsage } : {}),
          ...(options.warnings && options.warnings.length > 0 ? { warnings: options.warnings } : {}),
        },
      ],
      title:
        conversation.messages.length === 0 && options.role === "user"
          ? options.content.slice(0, 40) || conversation.title
          : conversation.title,
      updatedAt: createdAt,
    };

    return writeConversationFile(options.dataRoot, updated);
  });
}

export async function getConversation(
  options: ConversationHistoryOptions & { conversationId: string },
): Promise<Conversation> {
  return accessConversation(options, async (conversation) => {
    return conversation;
  });
}

export async function appendConversationEditProposal(
  options: AppendEditProposalOptions,
): Promise<Conversation> {
  return accessConversation(options, async (conversation) => {
    if (options.proposalId) {
      const existingProposal = conversation.editProposals.find(
        (proposal) => proposal.id === options.proposalId,
      );
      if (existingProposal) {
        if ((!options.assistantMessageId || existingProposal.assistantMessageId) &&
            (!options.sourceRole || existingProposal.sourceRole === options.sourceRole)) return conversation;
        return writeConversationFile(options.dataRoot, {
          ...conversation,
          editProposals: conversation.editProposals.map((item) => item.id === existingProposal.id
            ? { ...item, ...(!item.assistantMessageId && options.assistantMessageId ? { assistantMessageId: options.assistantMessageId } : {}),
                ...(options.sourceRole ? { sourceRole: options.sourceRole } : {}) } : item),
        });
      }
    }
    if (hasHiddenPathSegment(options.path)) {
      throw new Error("Hidden path segments are not allowed");
    }
    const proposal =
      options.diff && options.title
        ? {
            assistantMessageId: options.assistantMessageId,
            createdAt: options.createdAt ?? nowIso(),
            diff: options.diff,
            id: options.proposalId ?? randomUUID(),
            newText: options.newText,
            oldText: options.oldText,
            operation: options.operation ?? "edit",
            path: options.path,
            ...(options.sourceRole ? { sourceRole: options.sourceRole } : {}),
            status: options.status ?? ("pending" as const),
            title: options.title,
            ...(options.undoSnapshot ? { undoSnapshot: options.undoSnapshot } : {}),
            updatedAt: options.updatedAt ?? options.createdAt ?? nowIso(),
          }
        : {
            ...(await createEditProposalForWorkspace({
              newText: options.newText,
              oldText: options.oldText,
              path: options.path,
              workspaceRoot: options.workspaceRoot,
            })),
            assistantMessageId: options.assistantMessageId,
            id: options.proposalId ?? randomUUID(),
            ...(options.sourceRole ? { sourceRole: options.sourceRole } : {}),
          };
    const updated: Conversation = {
      ...conversation,
      editProposals: [...conversation.editProposals, proposal],
      updatedAt: proposal.updatedAt,
    };

    return writeConversationFile(options.dataRoot, updated);
  });
}

function updateProposal(
  conversation: Conversation,
  proposalId: string,
  updater: (proposal: EditProposal) => Promise<EditProposal> | EditProposal,
): Promise<Conversation> | Conversation {
  const proposalIndex = conversation.editProposals.findIndex((proposal) => proposal.id === proposalId);
  if (proposalIndex === -1) {
    throw new Error("Edit proposal was not found");
  }

  const updatedProposal = updater(conversation.editProposals[proposalIndex]);
  if (updatedProposal instanceof Promise) {
    return updatedProposal.then((proposal) => ({
      ...conversation,
      editProposals: conversation.editProposals.map((item, index) =>
        index === proposalIndex ? proposal : item,
      ),
      updatedAt: proposal.updatedAt,
    }));
  }

  return {
    ...conversation,
    editProposals: conversation.editProposals.map((item, index) =>
      index === proposalIndex ? updatedProposal : item,
    ),
    updatedAt: updatedProposal.updatedAt,
  };
}

function latestUndoableProposalId(conversation: Conversation): string | undefined {
  return latestUndoableProposalIdFromProposals(conversation.editProposals);
}

export async function applyConversationEditProposal(
  options: ApplyEditProposalOptions,
): Promise<Conversation> {
  return accessConversation(options, async (conversation) => {
    const updated = await updateProposal(conversation, options.proposalId, (proposal) =>
      proposal.status !== "pending" ? proposal : applyEditProposal({
        beforeMutation: async (intendedProposal) => {
          await writeConversationFile(options.dataRoot, { ...conversation, editRecovery: intendedProposal });
        },
        dirtyPaths: options.dirtyPaths,
        proposal,
        workspaceRoot: options.workspaceRoot,
      }),
    );

    return writeConversationFile(options.dataRoot, updated);
  });
}

export async function rejectConversationEditProposal(
  options: RejectEditProposalOptions,
): Promise<Conversation> {
  return accessConversation(options, async (conversation) => {
    const updated = await updateProposal(conversation, options.proposalId, rejectEditProposal);

    return writeConversationFile(options.dataRoot, updated);
  });
}

export async function undoConversationEditProposal(
  options: UndoEditProposalOptions,
): Promise<Conversation> {
  return accessConversation(options, async (conversation) => {
    if (conversation.editProposals.find((item) => item.id === options.proposalId)?.status === "undone") return conversation;
    if (latestUndoableProposalId(conversation) !== options.proposalId) {
      throw new Error("Only the latest applied edit proposal can be undone");
    }
    const updated = await updateProposal(conversation, options.proposalId, (proposal) =>
      undoEditProposal({
        beforeMutation: async (intendedProposal) => {
          await writeConversationFile(options.dataRoot, { ...conversation, editRecovery: intendedProposal });
        },
        proposal,
        workspaceRoot: options.workspaceRoot,
      }),
    );

    return writeConversationFile(options.dataRoot, updated);
  });
}

export async function appendConversationToolActivities(
  options: UpdateToolActivitiesOptions,
): Promise<Conversation> {
  return accessConversation(options, async (conversation) => {
    if (options.toolActivities.length === 0) {
      return conversation;
    }
    const updated: Conversation = {
      ...conversation,
      toolActivities: [...conversation.toolActivities, ...options.toolActivities],
      updatedAt: nowIso(),
    };

    return writeConversationFile(options.dataRoot, updated);
  });
}

export async function appendConversationToolResultSummaries(
  options: AppendToolResultSummariesOptions,
): Promise<Conversation> {
  return accessConversation(options, async (conversation) => {
    if (options.toolResultSummaries.length === 0) {
      return conversation;
    }

    const existingByToolCallId = new Map(
      conversation.toolResultSummaries.map((summary) => [summary.toolCallId, summary]),
    );
    for (const summary of options.toolResultSummaries) {
      if (!existingByToolCallId.has(summary.toolCallId)) {
        existingByToolCallId.set(summary.toolCallId, summary);
      }
    }

    const updated: Conversation = {
      ...conversation,
      toolResultSummaries: [...existingByToolCallId.values()].sort(
        (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
      ),
      updatedAt: nowIso(),
    };

    return writeConversationFile(options.dataRoot, updated);
  });
}

export async function appendConversationCompaction(
  options: AppendConversationCompactionOptions,
): Promise<Conversation> {
  return accessConversation(options, async (conversation) => {
    const compactedThroughMessage = conversation.messages.find(
      (message) => message.id === options.compactedThroughMessageId,
    );
    if (!compactedThroughMessage) {
      throw new Error("Compaction target message was not found");
    }

    const createdAt = nowIso();
    const compaction: ConversationCompaction = {
      compactedThroughCreatedAt: compactedThroughMessage.createdAt,
      compactedThroughMessageId: options.compactedThroughMessageId,
      createdAt,
      id: randomUUID(),
      sourceMessageIds: options.sourceMessageIds,
      summary: options.summary,
      ...(options.tokenUsage ? { tokenUsage: options.tokenUsage } : {}),
    };
    const updated: Conversation = {
      ...conversation,
      conversationCompactions: [...conversation.conversationCompactions, compaction],
      updatedAt: createdAt,
    };

    return writeConversationFile(options.dataRoot, updated);
  });
}

export async function appendConversationPlan(
  options: AppendConversationPlanOptions,
): Promise<Conversation> {
  return accessConversation(options, async (conversation) => {
    if (options.items.length === 0) {
      return conversation;
    }

    const now = nowIso();
    const plan: AgentPlan = {
      assistantMessageId: options.assistantMessageId,
      createdAt: now,
      id: randomUUID(),
      items: options.items,
      updatedAt: now,
    };
    const updated: Conversation = {
      ...conversation,
      plans: [...conversation.plans, plan],
      updatedAt: now,
    };

    return writeConversationFile(options.dataRoot, updated);
  });
}

export async function updateConversationCodexModel(
  options: ConversationHistoryOptions & {
    conversationId: string;
    selectedCodexModel: string | null;
  },
): Promise<Conversation> {
  return accessConversation(options, async (conversation) => {
    if (conversation.selectedCodexModel === options.selectedCodexModel) {
      return conversation;
    }

    const updatedAt = nowIso();
    const updated: Conversation = {
      ...conversation,
      selectedCodexModel: options.selectedCodexModel,
      updatedAt,
    };

    return writeConversationFile(options.dataRoot, updated);
  });
}

export async function updateConversationCodexThreadId(
  options: ConversationHistoryOptions & {
    codexThreadId: string;
    conversationId: string;
  },
): Promise<Conversation> {
  return accessConversation(options, async (conversation) => {
    if (conversation.codexThreadId === options.codexThreadId) {
      return conversation;
    }

    const updatedAt = nowIso();
    const updated: Conversation = {
      ...conversation,
      codexThreadId: options.codexThreadId,
      updatedAt,
    };

    return writeConversationFile(options.dataRoot, updated);
  });
}

export async function updateConversationCodexTurnState(
  options: ConversationHistoryOptions & {
    codexTurnState: CodexTurnState;
    conversationId: string;
  },
): Promise<Conversation> {
  return accessConversation(options, async (conversation) => {
    const updatedAt = nowIso();
    const updated: Conversation = {
      ...conversation,
      codexTurnState: options.codexTurnState,
      updatedAt,
    };

    return writeConversationFile(options.dataRoot, updated);
  });
}

export async function updateConversationCodexRuntimeMetadata(
  options: ConversationHistoryOptions & {
    codexRuntimeMetadata: CodexRuntimeMetadata;
    conversationId: string;
  },
): Promise<Conversation> {
  return accessConversation(options, async (conversation) => {
    const existing = conversation.codexRuntimeMetadata;
    if (
      existing?.model === options.codexRuntimeMetadata.model &&
      existing?.modelProvider === options.codexRuntimeMetadata.modelProvider &&
      existing?.protocolVersion === options.codexRuntimeMetadata.protocolVersion &&
      existing.userAgentOrCliVersion === options.codexRuntimeMetadata.userAgentOrCliVersion
    ) {
      return conversation;
    }

    const updatedAt = nowIso();
    const updated: Conversation = {
      ...conversation,
      codexRuntimeMetadata: options.codexRuntimeMetadata,
      updatedAt,
    };

    return writeConversationFile(options.dataRoot, updated);
  });
}

export type DeleteConversationResult = {
  codexThreadId?: string;
  conversationId: string;
};

export async function deleteConversation(
  options: ConversationHistoryOptions & { conversationId: string },
): Promise<DeleteConversationResult> {
  return accessConversation(options, async (conversation, filePath) => {
    await unlink(filePath);
    return {
      codexThreadId: conversation.codexThreadId,
      conversationId: conversation.id,
    };
  });
}

export async function touchConversation(
  options: ConversationHistoryOptions & { conversationId: string },
): Promise<Conversation> {
  return accessConversation(options, async (conversation) => {
    const lastOpenedAt = nowIso();
    return writeConversationFile(options.dataRoot, {
      ...conversation,
      lastOpenedAt,
    });
  });
}

export async function listConversations(
  options: ConversationHistoryOptions,
): Promise<{ conversations: Conversation[]; errors: ConversationHistoryError[] }> {
  const { directory } = await conversationDirectory(options);
  const fileNames = await readdir(directory).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  const conversations: Conversation[] = [];
  const errors: ConversationHistoryError[] = [];

  for (const fileName of fileNames.filter((name) => name.endsWith(".json")).sort()) {
    try {
      conversations.push(await getConversation({ ...options, conversationId: fileName.slice(0, -5) }));
    } catch (error) {
      errors.push({
        fileName,
        message: error instanceof Error ? error.message : "Invalid conversation history file",
      });
    }
  }

  conversations.sort((left, right) => {
    const rightTime = Date.parse(right.lastOpenedAt || right.updatedAt);
    const leftTime = Date.parse(left.lastOpenedAt || left.updatedAt);
    return rightTime - leftTime;
  });

  return { conversations, errors };
}

export async function bindConversationSiwc(options: ConversationHistoryOptions & { conversationId: string; accountId: string; modelId: string }): Promise<Conversation> {
  return accessConversation(options, async conversation => {
    const binding = siwcBindingSchema.parse(options);
    if (conversation.agentRuntime !== "vercel-ai" || (!conversation.siwc && conversation.messages.length > 0)) throw new Error("SIWCは新しい会話で開始してください。");
    if (conversation.siwc && conversation.siwc.accountId !== binding.accountId) throw new Error("account_changed");
    return writeConversationFile(options.dataRoot, { ...conversation, siwc: binding });
  });
}
