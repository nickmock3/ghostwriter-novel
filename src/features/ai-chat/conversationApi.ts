import { cleanupDroppedTextFilesForConversation } from "./droppedTextFiles";
import type { SiwcService } from "../siwc/service";
import { withSiwcRuntime } from "../ai-agent/llm-providers/siwcRuntime";
import { z } from "zod";
import {
  createLlmPluginModelProvider,
  listAvailableLlmProviders,
  type LlmProviderPlugin,
  type ModelProvider,
} from "../ai-agent/modelProvider";
import {
  createDefaultRoleAssignments,
  resolveLlmProfileForRole,
} from "../ai-agent/llmProfiles";
import { createLlmRuntime } from "../ai-agent/llmRuntime";
import type { LlmSecretStore } from "../ai-agent/llmSecretStore";
import type { LlmProviderConfig } from "../ai-agent/runtimeEnv";
import {
  applicationStorageUnavailableBody,
  isApplicationStorageError,
} from "../../shared/server/applicationStorage";
import {
  compactConversation as defaultCompactConversation,
  toCompactConversationModelSelection,
  type CompactConversationResult,
} from "./conversationCompaction";
import {
  appendConversationEditProposal,
  appendConversationMessage,
  applyConversationEditProposal,
  createConversation,
  defaultConversationDataRoot,
  deleteConversation,
  getConversation,
  listConversations,
  rejectConversationEditProposal,
  touchConversation,
  undoConversationEditProposal,
} from "./conversationHistory";
import { conversationListResponseSchema, type Conversation } from "./conversationSchemas";
const conversationQuerySchema = z.object({
  workspaceRoot: z.string().min(1),
});

const createConversationBodySchema = z.object({
  agentRuntime: z.literal("vercel-ai").optional(),
  workspaceRoot: z.string().min(1),
});

const appendMessageBodySchema = z.object({
  content: z.string().min(1),
  conversationId: z.string().min(1),
  role: z.enum(["user", "assistant", "system", "tool"]).default("user"),
  workspaceRoot: z.string().min(1),
});

const touchConversationBodySchema = z.object({
  conversationId: z.string().min(1),
  workspaceRoot: z.string().min(1),
});

const appendEditProposalBodySchema = z.object({
  conversationId: z.string().min(1),
  newText: z.string(),
  oldText: z.string(),
  path: z.string().min(1),
  workspaceRoot: z.string().min(1),
});

const applyEditProposalBodySchema = z.object({
  conversationId: z.string().min(1),
  dirtyPaths: z.array(z.string()).default([]),
  proposalId: z.string().min(1),
  workspaceRoot: z.string().min(1),
});

const rejectEditProposalBodySchema = z.object({
  conversationId: z.string().min(1),
  proposalId: z.string().min(1),
  workspaceRoot: z.string().min(1),
});

const undoEditProposalBodySchema = z.object({
  conversationId: z.string().min(1),
  proposalId: z.string().min(1),
  workspaceRoot: z.string().min(1),
});

const compactConversationBodySchema = z.object({
  action: z.literal("compactConversation"),
  conversationId: z.string().min(1),
  workspaceRoot: z.string().min(1),
});

const deleteConversationBodySchema = z.object({
  action: z.literal("deleteConversation"),
  conversationId: z.string().min(1),
  workspaceRoot: z.string().min(1),
});

export type CompactConversationHandler = (options: {
  conversationId: string;
  dataRoot: string;
  workspaceRoot: string;
}) => Promise<CompactConversationResult>;

export type DeleteConversationApiResult = { conversationId: string };

export type ConversationApiOptions = {
  siwcService?: SiwcService;
  compactConversation?: CompactConversationHandler;
  dataRoot?: string;
  llmProviderConfig?: LlmProviderConfig;
  llmProviderPlugins?: LlmProviderPlugin[];
  modelProvider?: ModelProvider;
  secretStore?: LlmSecretStore;
};

function lastCompactionTargetMessageId(conversation: Conversation): string | undefined {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    if (message.role === "user" || message.role === "assistant" || message.role === "system") {
      return message.id;
    }
  }
  return undefined;
}

function createDefaultCompactConversationHandler(
  options: ConversationApiOptions & { dataRoot: string },
): CompactConversationHandler {
  const runtime = createLlmRuntime({
    config: options.llmProviderConfig,
    llmProviderPlugins: options.llmProviderPlugins,
    secretStore: options.secretStore,
  });

  return async function compactConversationHandler({
    conversationId,
    dataRoot,
    workspaceRoot,
  }) {
    const conversation = await getConversation({
      conversationId,
      dataRoot,
      workspaceRoot,
    });
    if (conversation.agentRuntime === "codex-app-server") {
      throw new Error("旧Codex連携は廃止されました。新しい会話で接続を選択してください。");
    }
    const compactedThroughMessageId = lastCompactionTargetMessageId(conversation);
    if (!compactedThroughMessageId) {
      return {
        conversation,
        reason: "Not enough eligible messages to compact",
        status: "skipped",
      };
    }

    if (conversation.siwc) {
      if (!options.siwcService) throw new Error("ChatGPT接続は有効になっていません。");
      return withSiwcRuntime({ service: options.siwcService, ...conversation.siwc, execute: ({ modelProvider }) => defaultCompactConversation({ compactedThroughMessageId, conversationId, dataRoot, workspaceRoot, modelProvider, modelSelection: { providerId: "openai-chatgpt", modelId: conversation.siwc!.modelId } }) });
    }
    const { config: llmProviderConfig, plugins: llmProviderPlugins } = await runtime.resolve();
    const availableProviders = listAvailableLlmProviders({
      config: llmProviderConfig,
      plugins: llmProviderPlugins,
      requireTools: false,
    });
    const roleAssignments = createDefaultRoleAssignments({
      defaultProviderId: llmProviderConfig.defaultProviderId,
      providers: availableProviders,
    });
    const mainProfile = resolveLlmProfileForRole({
      assignments: roleAssignments,
      defaultProviderId: llmProviderConfig.defaultProviderId,
      providers: availableProviders,
      role: "main",
    });
    const modelProvider =
      options.modelProvider ?? createLlmPluginModelProvider(llmProviderPlugins);

    return defaultCompactConversation({
      compactedThroughMessageId,
      conversationId,
      dataRoot,
      modelProvider,
      modelSelection: toCompactConversationModelSelection({
        modelId: mainProfile.modelId,
        profileId: mainProfile.id,
        providerId: mainProfile.providerId,
      }),
      workspaceRoot,
    });
  };
}

function jsonResponse<TBody>(body: TBody, status: number): Response {
  return Response.json(body, { status });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function apiErrorResponse(error: unknown, fallback: string, status = 400): Response {
  if (isApplicationStorageError(error)) {
    return jsonResponse(applicationStorageUnavailableBody(), 500);
  }

  return jsonResponse({ message: errorMessage(error, fallback) }, status);
}

export function createConversationApiHandler(options: ConversationApiOptions = {}) {
  const dataRoot = options.dataRoot ?? defaultConversationDataRoot();
  const compactConversation =
    options.compactConversation ?? createDefaultCompactConversationHandler({ ...options, dataRoot });

  return async function conversationApiHandler(request: Request): Promise<Response> {
    if (request.method === "GET") {
      const parsedQuery = conversationQuerySchema.safeParse({
        workspaceRoot: new URL(request.url).searchParams.get("workspaceRoot") ?? "",
      });

      if (!parsedQuery.success) {
        return jsonResponse({ message: "Invalid conversation list request" }, 400);
      }

      try {
        const result = await listConversations({
          dataRoot,
          workspaceRoot: parsedQuery.data.workspaceRoot,
        });
        return jsonResponse(
          conversationListResponseSchema.parse({
            activeConversation: result.conversations[0] ?? null,
            conversations: result.conversations,
            errors: result.errors,
          }),
          200,
        );
      } catch (error) {
        return apiErrorResponse(error, "Conversation list failed");
      }
    }

    if (request.method === "POST") {
      try {
        const parsedBody = createConversationBodySchema.safeParse(await request.json());
        if (!parsedBody.success) {
          return jsonResponse({ message: "Invalid conversation create request" }, 400);
        }

        const conversation = await createConversation({
          ...(parsedBody.data.agentRuntime ? { agentRuntime: parsedBody.data.agentRuntime } : {}),
          dataRoot,
          workspaceRoot: parsedBody.data.workspaceRoot,
        });
        return jsonResponse({ conversation }, 201);
      } catch (error) {
        return apiErrorResponse(error, "Conversation create failed");
      }
    }

    if (request.method === "PATCH") {
      try {
        const body = await request.json();
        if (body?.action === "appendMessage") {
          const parsedBody = appendMessageBodySchema.safeParse(body);
          if (!parsedBody.success) {
            return jsonResponse({ message: "Invalid conversation message request" }, 400);
          }

          const conversation = await appendConversationMessage({
            content: parsedBody.data.content,
            conversationId: parsedBody.data.conversationId,
            dataRoot,
            role: parsedBody.data.role,
            workspaceRoot: parsedBody.data.workspaceRoot,
          });
          return jsonResponse({ conversation }, 200);
        }

        if (body?.action === "touch") {
          const parsedBody = touchConversationBodySchema.safeParse(body);
          if (!parsedBody.success) {
            return jsonResponse({ message: "Invalid conversation touch request" }, 400);
          }

          const conversation = await touchConversation({
            conversationId: parsedBody.data.conversationId,
            dataRoot,
            workspaceRoot: parsedBody.data.workspaceRoot,
          });
          return jsonResponse({ conversation }, 200);
        }

        if (body?.action === "appendEditProposal") {
          const parsedBody = appendEditProposalBodySchema.safeParse(body);
          if (!parsedBody.success) {
            return jsonResponse({ message: "Invalid edit proposal request" }, 400);
          }

          const conversation = await appendConversationEditProposal({
            conversationId: parsedBody.data.conversationId,
            dataRoot,
            newText: parsedBody.data.newText,
            oldText: parsedBody.data.oldText,
            path: parsedBody.data.path,
            workspaceRoot: parsedBody.data.workspaceRoot,
          });
          return jsonResponse({ conversation }, 200);
        }

        if (body?.action === "applyEditProposal") {
          const parsedBody = applyEditProposalBodySchema.safeParse(body);
          if (!parsedBody.success) {
            return jsonResponse({ message: "Invalid edit proposal apply request" }, 400);
          }

          const conversation = await applyConversationEditProposal({
            conversationId: parsedBody.data.conversationId,
            dataRoot,
            dirtyPaths: parsedBody.data.dirtyPaths,
            proposalId: parsedBody.data.proposalId,
            workspaceRoot: parsedBody.data.workspaceRoot,
          });
          return jsonResponse({ conversation }, 200);
        }

        if (body?.action === "rejectEditProposal") {
          const parsedBody = rejectEditProposalBodySchema.safeParse(body);
          if (!parsedBody.success) {
            return jsonResponse({ message: "Invalid edit proposal reject request" }, 400);
          }

          const conversation = await rejectConversationEditProposal({
            conversationId: parsedBody.data.conversationId,
            dataRoot,
            proposalId: parsedBody.data.proposalId,
            workspaceRoot: parsedBody.data.workspaceRoot,
          });
          return jsonResponse({ conversation }, 200);
        }

        if (body?.action === "undoEditProposal") {
          const parsedBody = undoEditProposalBodySchema.safeParse(body);
          if (!parsedBody.success) {
            return jsonResponse({ message: "Invalid edit proposal undo request" }, 400);
          }

          const conversation = await undoConversationEditProposal({
            conversationId: parsedBody.data.conversationId,
            dataRoot,
            proposalId: parsedBody.data.proposalId,
            workspaceRoot: parsedBody.data.workspaceRoot,
          });
          return jsonResponse({ conversation }, 200);
        }

        if (body?.action === "compactConversation") {
          const parsedBody = compactConversationBodySchema.safeParse(body);
          if (!parsedBody.success) {
            return jsonResponse({ message: "Invalid conversation compaction request" }, 400);
          }

          const result = await compactConversation({
            conversationId: parsedBody.data.conversationId,
            dataRoot,
            workspaceRoot: parsedBody.data.workspaceRoot,
          });
          return jsonResponse(result, 200);
        }

        if (body?.action === "deleteConversation") {
          const parsedBody = deleteConversationBodySchema.safeParse(body);
          if (!parsedBody.success) {
            return jsonResponse({ message: "Invalid conversation delete request" }, 400);
          }

          const conversation = await getConversation({
            conversationId: parsedBody.data.conversationId,
            dataRoot,
            workspaceRoot: parsedBody.data.workspaceRoot,
          });
          const deleted = await deleteConversation({
            conversationId: parsedBody.data.conversationId,
            dataRoot,
            workspaceRoot: parsedBody.data.workspaceRoot,
          });
          try {
            await cleanupDroppedTextFilesForConversation({
              conversationId: parsedBody.data.conversationId,
              dataRoot,
              workspaceRoot: parsedBody.data.workspaceRoot,
            });
          } catch {
            // Conversation deletion is authoritative. Expiry cleanup can remove
            // an orphaned dropped-file request if storage cleanup is unavailable.
          }
          const responseBody: DeleteConversationApiResult = {
            ...deleted,
          };
          return jsonResponse(responseBody, 200);
        }

        return jsonResponse({ message: "Invalid conversation action" }, 400);
      } catch (error) {
        return apiErrorResponse(error, "Conversation update failed");
      }
    }

    return jsonResponse({ message: "Method not allowed" }, 405);
  };
}
