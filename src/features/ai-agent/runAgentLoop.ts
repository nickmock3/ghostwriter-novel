import {
  streamText as defaultStreamText,
  type ModelMessage,
  type ToolSet,
} from "ai";
import {
  createAgentTools,
  delegateWritingToolInputSchema,
  type AgentToolPlugin,
  type CreateAgentToolsOptions,
  type DelegateWritingInternalOutput,
  type DelegateWritingToolInput,
  type DelegateWritingToolOutput,
  type RunAgentLoopToolServiceOverrides,
} from "./agentTools";
import { resolveWritingDelegationTarget as defaultResolveWritingDelegationTarget } from "./writingDelegationTarget";
import type { ResolvedWritingDelegationTarget } from "./writingDelegationTarget";
import {
  createWritingArtifactRegistry,
  normalizeWritingTargetPath,
  toPublicDelegateWritingOutput,
} from "./writingArtifactRegistry";
import { createWritingDelegationService } from "./writingDelegationService";
import {
  createAgentSkillRegistry,
  type AgentSkill,
  type AgentSkillPlugin,
  type AgentSkillRegistry,
} from "./agentSkills";
import {
  getSubAgentProfile,
  selectProfileTools,
  type AgentProfile,
} from "./agentProfiles";
import { createSubAgentRuntime } from "./subAgentRuntime";
import type { DelegateWritingDiagnosticObserver } from "./delegateWritingDiagnostics";
import {
  getDefaultMaxOutputTokens,
  getLlmProfileTemperature,
  type LlmProfileRole,
  type ResolvedLlmProfile,
} from "./llmProfiles";
import type { ModelProvider } from "./modelProvider";
import {
  emptyTrustedAgentExtensionCatalog,
  type TrustedAgentExtensionCatalog,
} from "./trustedAgentExtensions";
import type { LoadRecentTextFilesContextOptions, RecentTextFilesContext } from "./recentTextFilesContext";
import type { LoadWorkspaceStructureContextOptions, WorkspaceStructureContext } from "./workspaceStructureContext";
import {
  composeAgentSystemPrompt,
  type AgentRuntimeContext,
  type ChapterCompletionSummaryContext,
  type ChapterReferenceContext,
  type LoadWorkspaceAgentsInstructionsOptions,
  type WorkspaceInstructions,
} from "./workspaceInstructions";
import { createAgentContextLoader } from "./agentContextLoader";
import { mapAgentStreamPart, type AgentLoopEvent } from "./agentStreamEvents";

import { streamWritingObject, type GenerateWritingObject } from "./streamWritingObject";

export type { AgentLoopEvent } from "./agentStreamEvents";

type StreamTextFunction = (options: {
  activeTools?: string[];
  maxOutputTokens?: number;
  messages: ModelMessage[];
  model: unknown;
  prepareStep?: (options: {
    experimental_context?: unknown;
    messages: ModelMessage[];
    model: unknown;
    stepNumber: number;
    steps: unknown[];
  }) =>
    | Promise<{
        system?: string;
      }>
    | {
        system?: string;
      };
  stopWhen?: AgentProfile["stopWhen"];
  system: string;
  temperature?: number;
  tools: ToolSet;
}) => {
  fullStream: AsyncIterable<unknown>;
  responseMessages?: PromiseLike<ModelMessage[]>;
};

type ResolveLlmProfileForRoleFunction = (
  role: LlmProfileRole,
) => Promise<ResolvedLlmProfile> | ResolvedLlmProfile;

export type RunAgentLoopOptions = {
  onResponseMessages?: (messages: ModelMessage[]) => void;
  createTools?: (options: CreateAgentToolsOptions) => ToolSet;
  currentFilePath?: string;
  loadWorkspaceInstructions?: (
    options: LoadWorkspaceAgentsInstructionsOptions,
  ) => Promise<WorkspaceInstructions>;
  loadWorkspaceStructureContext?: (
    options: LoadWorkspaceStructureContextOptions,
  ) => Promise<WorkspaceStructureContext>;
  loadRecentTextFilesContext?: (
    options: LoadRecentTextFilesContextOptions,
  ) => Promise<RecentTextFilesContext>;
  deriveChapterReferenceContext?: (
    currentFilePath: string | null | undefined,
  ) => ChapterReferenceContext | undefined;
  deriveChapterCompletionSummaryContext?: (
    currentFilePath: string | null | undefined,
  ) => ChapterCompletionSummaryContext | undefined;
  messages: ModelMessage[];
  modelProvider: ModelProvider;
  plugins?: AgentToolPlugin[];
  skillPlugins?: AgentSkillPlugin[];
  profile: AgentProfile;
  generateObject?: GenerateWritingObject;
  onToolProgress?: (event: Extract<AgentLoopEvent, { type: "tool-progress" }>) => void;
  resolveLlmProfileForRole?: ResolveLlmProfileForRoleFunction;
  runtimeContext?: AgentRuntimeContext;
  streamText?: StreamTextFunction;
  subAgentDepth?: number;
  maxSubAgentSpawns?: number;
  toolServices?: RunAgentLoopToolServiceOverrides;
  trustedAgentExtensions?: TrustedAgentExtensionCatalog;
  onDelegateWritingDiagnostic?: DelegateWritingDiagnosticObserver;
  resolveWritingDelegationTarget?: (
    workspaceRoot: string,
    targetPath: string,
  ) => Promise<ResolvedWritingDelegationTarget>;
  workspaceRoot: string;
};

export type { DelegateWritingDiagnostic, DelegateWritingDiagnosticObserver } from "./delegateWritingDiagnostics";


const DEFAULT_MAX_SUB_AGENT_SPAWNS = 2;

function defaultResolvedLlmProfile(role: LlmProfileRole): ResolvedLlmProfile {
  const modelId = role === "simple" || role === "search" ? "deepseek-v4-flash" : "deepseek-v4-pro";
  return {
    available: true,
    contextWindowTokens: 1_000_000,
    id: `builtin:deepseek:${role}`,
    llmProfileRole: role,
    maxOutputTokens: getDefaultMaxOutputTokens(role),
    modelId,
    name: `DeepSeek default ${role}`,
    providerId: "deepseek",
    source: "built-in",
    temperature: role === "writing" ? 0.7 : 0.2,
  };
}

function resolveActiveSkills(
  activeSkillIds: Set<string>,
  skillRegistry: AgentSkillRegistry,
): AgentSkill[] {
  const activeSkills: AgentSkill[] = [];
  for (const skillId of activeSkillIds) {
    const skill = skillRegistry.getSkill(skillId);
    if (skill) {
      activeSkills.push(skill);
    }
  }
  return activeSkills;
}

export async function* runAgentLoop(options: RunAgentLoopOptions): AsyncGenerator<AgentLoopEvent> {
  const streamText = options.streamText ?? (defaultStreamText as unknown as StreamTextFunction);
  const generateObject = options.generateObject ?? streamWritingObject;
  const createTools = options.createTools ?? createAgentTools;
  const subAgentDepth = options.subAgentDepth ?? 0;
  const maxSubAgentSpawns = options.maxSubAgentSpawns ?? DEFAULT_MAX_SUB_AGENT_SPAWNS;
  const trustedAgentExtensions =
    options.trustedAgentExtensions ?? emptyTrustedAgentExtensionCatalog;
  const toolPlugins = Array.from(
    new Set([...trustedAgentExtensions.toolPlugins, ...(options.plugins ?? [])]),
  );
  const skillPlugins = Array.from(
    new Set([...trustedAgentExtensions.skillPlugins, ...(options.skillPlugins ?? [])]),
  );
  const grantedTools = trustedAgentExtensions.profileToolGrants[options.profile.id] ?? [];
  const effectiveProfile: AgentProfile =
    grantedTools.length === 0
      ? options.profile
      : {
          ...options.profile,
          activeTools: [...options.profile.activeTools, ...grantedTools],
        };
  const activeSkillIds = new Set<string>();
  const skillRegistry = createAgentSkillRegistry({
    plugins: skillPlugins,
    workspaceRoot: options.workspaceRoot,
  });
  const resolveLlmProfileForRole =
    options.resolveLlmProfileForRole ?? ((role: LlmProfileRole) => defaultResolvedLlmProfile(role));
  const resolvedLlmProfile = await resolveLlmProfileForRole(effectiveProfile.llmProfileRole);
  const resolveWritingDelegationTarget =
    options.resolveWritingDelegationTarget ?? defaultResolveWritingDelegationTarget;
  const readContentsByPath = new Map<string, string>();
  const writingArtifactRegistry = createWritingArtifactRegistry();

  const executeDelegateWriting =
    subAgentDepth === 0
      ? createWritingDelegationService({
          generateObject,
          modelProvider: options.modelProvider,
          onDelegateWritingDiagnostic: options.onDelegateWritingDiagnostic,
          readContentsByPath,
          resolveLlmProfileForRole,
          resolveWritingDelegationTarget,
          workspaceRoot: options.workspaceRoot,
        })
      : undefined;
  const delegateWritingService =
    subAgentDepth === 0
      ? async (input: DelegateWritingToolInput, context?: { toolCallId: string }): Promise<DelegateWritingToolOutput> => {
          const parsedInput = delegateWritingToolInputSchema.parse(input);
          const normalizedTargetPath = normalizeWritingTargetPath(parsedInput.targetPath);
          const implementation =
            options.toolServices?.delegateWriting ?? executeDelegateWriting;
          if (!implementation) {
            throw new Error("DelegateWriting is not available in this agent context");
          }
          try {
            const output = await implementation(input, context && options.onToolProgress
                ? (generatedCharacters) => options.onToolProgress?.({
                    type: "tool-progress", toolName: "DelegateWriting", toolCallId: context.toolCallId,
                    generatedCharacters, targetPath: normalizedTargetPath,
                  })
                : undefined);
            return toPublicDelegateWritingOutput(writingArtifactRegistry, output);
          } catch (error) {
            writingArtifactRegistry.delegateWritingFailedPaths.add(normalizedTargetPath);
            throw error;
          }
        }
      : undefined;

  const subAgentRuntime =
    subAgentDepth === 0
      ? createSubAgentRuntime({
          executeSubAgent: async function* ({ messages, profile }) {
            for await (const event of runAgentLoop({
              createTools,
              generateObject,
              onDelegateWritingDiagnostic: options.onDelegateWritingDiagnostic,
              loadRecentTextFilesContext: options.loadRecentTextFilesContext,
              loadWorkspaceInstructions: options.loadWorkspaceInstructions,
              loadWorkspaceStructureContext: options.loadWorkspaceStructureContext,
              currentFilePath: options.currentFilePath,
              deriveChapterCompletionSummaryContext:
                options.deriveChapterCompletionSummaryContext,
              deriveChapterReferenceContext: options.deriveChapterReferenceContext,
              maxSubAgentSpawns: 0,
              messages,
              modelProvider: options.modelProvider,
              plugins: options.plugins,
              skillPlugins: options.skillPlugins,
              profile,
              resolveLlmProfileForRole,
              runtimeContext: options.runtimeContext,
              streamText,
              subAgentDepth: subAgentDepth + 1,
              toolServices: options.toolServices,
              trustedAgentExtensions,
              workspaceRoot: options.workspaceRoot,
            })) {
              if (event.type === "text-delta" || event.type === "finish") {
                yield event;
              }
            }
          },
          getProfile: getSubAgentProfile,
          maxSpawns: maxSubAgentSpawns,
          resolveLlmProfileForRole,
        })
      : undefined;
  const spawnSubAgentService =
    subAgentDepth === 0
      ? (options.toolServices?.spawnSubAgent ?? subAgentRuntime?.spawnSubAgent.bind(subAgentRuntime))
      : undefined;
  const context = await createAgentContextLoader({
    deriveChapterCompletionSummaryContext: options.deriveChapterCompletionSummaryContext,
    deriveChapterReferenceContext: options.deriveChapterReferenceContext,
    loadRecentTextFilesContext: options.loadRecentTextFilesContext,
    loadWorkspaceInstructions: options.loadWorkspaceInstructions,
    loadWorkspaceStructureContext: options.loadWorkspaceStructureContext,
    optionalContextFailuresAreIgnored: {
      recentTextFiles: options.loadRecentTextFilesContext === undefined,
      workspaceStructure: options.loadWorkspaceStructureContext === undefined,
    },
  }).load({ currentFilePath: options.currentFilePath, workspaceRoot: options.workspaceRoot });
  const tools = createTools({
    createDirectoryProposal: options.toolServices?.createDirectoryProposal,
    createEditProposal: options.toolServices?.createEditProposal,
    createFileProposal: options.toolServices?.createFileProposal,
    placeDroppedTextFile: options.toolServices?.placeDroppedTextFile,
    readDroppedTextFile: options.toolServices?.readDroppedTextFile,
    readWorkspaceFile: options.toolServices?.readWorkspaceFile,
    workspaceSearchStore: options.toolServices?.workspaceSearchStore,
    delegateWriting: delegateWritingService,
    onReadSuccess: (path, content) => {
      readContentsByPath.set(normalizeWritingTargetPath(path), content);
    },
    activeSkillIds,
    plugins: toolPlugins,
    skillPlugins,
    skillRegistry,
    spawnSubAgent: spawnSubAgentService,
    workspaceRoot: options.workspaceRoot,
    writingArtifactRegistry: subAgentDepth === 0 ? writingArtifactRegistry : undefined,
  });
  const profileTools = selectProfileTools(effectiveProfile, tools);
  const composeSystem = () =>
    composeAgentSystemPrompt({
      activeSkills: resolveActiveSkills(activeSkillIds, skillRegistry),
      chapterCompletionSummaryContext: context.chapterCompletionSummaryContext,
      chapterReferenceContext: context.chapterReferenceContext,
      profileSystemPrompt: effectiveProfile.systemPrompt,
      recentTextFilesContext: context.recentTextFilesContext,
      runtimeContext: options.runtimeContext,
      workspaceInstructions: context.workspaceInstructions,
      workspaceStructureContext: context.workspaceStructureContext,
    });
  const temperature = getLlmProfileTemperature(
    resolvedLlmProfile,
    effectiveProfile.temperature,
  );
  const result = streamText({
    activeTools: effectiveProfile.activeTools,
    maxOutputTokens: effectiveProfile.maxOutputTokens ?? resolvedLlmProfile.maxOutputTokens,
    messages: options.messages,
    model: options.modelProvider.getLanguageModel(
      resolvedLlmProfile.modelId,
      resolvedLlmProfile.providerId,
      resolvedLlmProfile.id,
    ),
    prepareStep: () => ({
      system: composeSystem(),
    }),
    stopWhen: effectiveProfile.stopWhen,
    system: composeSystem(),
    ...(temperature !== undefined ? { temperature } : {}),
    tools: profileTools,
  });

  for await (const part of result.fullStream) {
    const event = mapAgentStreamPart(part);
    if (event) {
      yield event;
    }
  }
  if (options.onResponseMessages && result.responseMessages) {
    options.onResponseMessages(await result.responseMessages);
  }
}
