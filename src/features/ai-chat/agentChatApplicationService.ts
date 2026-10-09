import { defaultServerDataRoot } from "../../shared/server/applicationStorage";
import {
  chatModeAgentProfile,
  mainAgentProfile,
} from "../ai-agent/agentProfiles";
import {
  createDefaultRoleAssignments,
  resolveLlmProfileForRole,
  type LlmProfile,
  type LlmProfileRoleAssignments,
} from "../ai-agent/llmProfiles";
import { createLlmRuntime } from "../ai-agent/llmRuntime";
import {
  createLlmPluginModelProvider,
  listAvailableLlmProviders,
  resolveChatModelSelection,
  type LlmProviderId,
  type ModelProvider,
  type ResolvedChatModelSelection,
} from "../ai-agent/modelProvider";
import { runAgentLoop as defaultRunAgentLoop } from "../ai-agent/runAgentLoop";
import {
  createTrustedAgentExtensionCatalog,
  emptyTrustedAgentExtensionCatalog,
} from "../ai-agent/trustedAgentExtensions";
import { normalizeWorkspaceRelativePath } from "../workspace/workspaceFilePaths";
import { cleanupDroppedTextFiles } from "./droppedTextFiles";
import { getConversation } from "./conversationHistory";
import { conversationSchema } from "./conversationSchemas";
import {
  compactConversation as defaultCompactConversation,
  toCompactConversationModelSelection,
} from "./conversationCompaction";
import { maybeAutoCompactConversation } from "./agentChatAutoCompact";
import { executeVercelAgentChat } from "./agentChatAgentExecution";
import {
  createDroppedTextFileStatusTracker,
  prepareAgentChatConversation,
} from "./agentChatConversationPrepare";
import { persistAgentChatRunResult } from "./agentChatRunPersistence";
import type {
  AgentChatApplicationEvent,
  AgentChatApplicationInput,
  AgentChatApplicationResult,
  AgentChatApplicationServiceOptions,
  AgentChatCompactConversationHandler,
  AgentChatExecutionContext,
} from "./agentChatApplicationTypes";

export type {
  AgentChatApplicationEvent,
  AgentChatApplicationInput,
  AgentChatApplicationResult,
  AgentChatApplicationServiceOptions,
  AgentChatCompactConversationHandler,
} from "./agentChatApplicationTypes";

function selectedProfile(mode: AgentChatApplicationInput["mode"]) {
  return mode === "chat" ? chatModeAgentProfile : mainAgentProfile;
}

function selectionFromUserProfile(
  llmProfileId: string | undefined,
  userProfiles: readonly LlmProfile[],
) {
  const profile = userProfiles.find((candidate) => candidate.id === llmProfileId);
  return profile
    ? {
        baseURL: profile.baseURL,
        modelId: profile.modelId,
        providerId: profile.providerId,
      }
    : undefined;
}

function resolveModelProvider(
  options: AgentChatApplicationServiceOptions,
  selection: ResolvedChatModelSelection,
  llmProviderPlugins: Parameters<typeof createLlmPluginModelProvider>[0],
): ModelProvider {
  if (options.modelProvider) return options.modelProvider;
  if (options.modelProviderFactory) return options.modelProviderFactory(selection);
  return createLlmPluginModelProvider(llmProviderPlugins);
}

function normalizeOptionalCurrentFilePath(currentFilePath: string | undefined): string | undefined {
  return currentFilePath ? normalizeWorkspaceRelativePath(currentFilePath) : undefined;
}

function createDefaultCompactConversationHandler(input: {
  llmProfileId: string | undefined;
  modelProvider: ModelProvider;
  selection: ResolvedChatModelSelection;
}): AgentChatCompactConversationHandler {
  return async function compactConversation(options) {
    return defaultCompactConversation({
      ...options,
      modelProvider: input.modelProvider,
      modelSelection: toCompactConversationModelSelection({
        modelId: input.selection.modelId,
        profileId: input.llmProfileId,
        providerId: input.selection.providerId,
      }),
    });
  };
}

export function createAgentChatApplicationService(
  options: AgentChatApplicationServiceOptions = {},
) {
  const dataRoot = options.dataRoot ?? defaultServerDataRoot();
  const runtime = createLlmRuntime({
    config: options.llmProviderConfig,
    llmProviderPlugins: options.llmProviderPlugins,
    secretStore: options.secretStore,
  });
  const runAgentLoop = options.runAgentLoop ?? defaultRunAgentLoop;
  const trustedAgentExtensions = options.trustedAgentExtensions
    ? createTrustedAgentExtensionCatalog(options.trustedAgentExtensions)
    : emptyTrustedAgentExtensionCatalog;

  async function resolveExecutionContext(
    input: AgentChatApplicationInput,
  ): Promise<AgentChatExecutionContext> {
    const userProfiles = input.userProfiles ?? [];
    const { config, plugins } = await runtime.resolve({ userProfiles });
    const requestedSelection =
      input.modelSelection ?? selectionFromUserProfile(input.llmProfileId, userProfiles);
    const selection = resolveChatModelSelection({
      config,
      plugins,
      requestedSelection,
      requireTools: true,
    });
    const availableProviders = listAvailableLlmProviders({ config, plugins, requireTools: true });
    const modelProvider = resolveModelProvider(options, selection, plugins);
    const defaultRoleAssignments = createDefaultRoleAssignments({
      defaultProviderId: config.defaultProviderId,
      providers: availableProviders,
    });
    const roleAssignments: LlmProfileRoleAssignments = {
      ...defaultRoleAssignments,
      ...(input.llmProfileId
        ? { main: { kind: "profile", profileId: input.llmProfileId } }
        : input.modelSelection
          ? {
              main: {
                kind: "model",
                modelId: selection.modelId,
                providerId: selection.providerId as LlmProviderId,
              },
            }
          : {}),
    };

    return {
      compactConversation:
        options.compactConversation ??
        createDefaultCompactConversationHandler({
          llmProfileId: input.llmProfileId,
          modelProvider,
          selection,
        }),
      currentFilePath: normalizeOptionalCurrentFilePath(input.currentFilePath),
      modelProvider,
      profile: selectedProfile(input.mode),
      resolveRoleProfile: (role) =>
        resolveLlmProfileForRole({
          assignments: roleAssignments,
          providers: availableProviders,
          role,
          userProfiles,
        }),
    };
  }

  async function runAgentChat(
    input: AgentChatApplicationInput,
    onEvent?: (event: AgentChatApplicationEvent) => void,
  ): Promise<AgentChatApplicationResult> {
    const requested = input.modelSelection ?? selectionFromUserProfile(input.llmProfileId, input.userProfiles ?? []);
    const existing = input.conversationId ? await getConversation({ dataRoot, workspaceRoot: input.workspaceRoot, conversationId: input.conversationId }) : undefined;
    if (existing?.agentRuntime === "codex-app-server") throw new Error("旧Codex連携は廃止されました。新しい会話で接続を選択してください。");
    if ( !options.modelProvider?.siwc && (requested?.providerId === "openai-chatgpt" || existing?.siwc)) {
      if (!options.siwcService) throw new Error("ChatGPT接続はこの環境では有効になっていません。");
      const { runSiwcAgentChat } = await import("./siwcAgentChat");
      return runSiwcAgentChat({ dataRoot, service: options.siwcService, input, onEvent, trustedAgentExtensions: options.trustedAgentExtensions });
    }
    const prepared = await prepareAgentChatConversation({ applicationInput: input, dataRoot });
    const { droppedTextFiles, userConversation } = prepared;
    const statusTracker = createDroppedTextFileStatusTracker({
      droppedTextFiles,
      onEvent,
    });
    statusTracker.emitPending();

    try {
      const executionContext = await resolveExecutionContext(input);
      const conversationForAgent = await maybeAutoCompactConversation({
        applicationInput: input,
        compactConversation: executionContext.compactConversation,
        dataRoot,
        userConversation,
      });
      const runResult = await executeVercelAgentChat({
        applicationInput: input,
        conversationForAgent,
        dataRoot,
        ...(droppedTextFiles ? { droppedTextFiles } : {}),
        executionContext,
        onEvent,
        runAgentLoop,
        statusTracker,
        trustedAgentExtensions,
        userConversation,
      });
      statusTracker.finalizePending("unplaced");
      const conversation = conversationSchema.parse(
        await persistAgentChatRunResult({
          autoApplyProposals: input.mode === "chat",
          dataRoot,
          runResult,
          userConversation,
          workspaceRoot: input.workspaceRoot,
        }),
      );
      onEvent?.({ conversation, type: "conversation" });
      return { conversation };
    } catch (error) {
      statusTracker.finalizePending("failed");
      throw error;
    } finally {
      if (droppedTextFiles) {
        try {
          await cleanupDroppedTextFiles(droppedTextFiles.context);
        } catch {
          // Do not turn an already persisted chat result into a failure. The bounded
          // expiry sweep will retry cleanup for an orphaned request directory.
        }
      }
    }
  }

  return { runAgentChat };
}
