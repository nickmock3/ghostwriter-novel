import type { SiwcService } from "../siwc/service";
import { withSiwcRuntime } from "../ai-agent/llm-providers/siwcRuntime";
import { generateObject as defaultGenerateObject } from "ai";
import { z } from "zod";

import { tokenUsageFromUnknown } from "../ai-agent/agentTokenUsage";
import {
  getLlmProfileTemperature,
  getDefaultMaxOutputTokens,
  listLlmProfiles,
  normalizeRoleAssignments,
  resolveLlmProfileForRole as resolveLlmProfileForRoleFromAssignments,
  writingProfileResolutionError,
  type LlmProfile,
  type LlmProfileRole,
  type ResolvedLlmProfile,
} from "../ai-agent/llmProfiles";
import { createLlmRuntime } from "../ai-agent/llmRuntime";
import {
  createLlmPluginModelProvider,
  listAvailableLlmProviders,
  type LlmProviderPlugin,
} from "../ai-agent/modelProvider";
import type { LlmSecretStore } from "../ai-agent/llmSecretStore";
import type { LlmProviderConfig } from "../ai-agent/runtimeEnv";
import { createEditProposalForWorkspace } from "../edit-proposals/editProposalService";
import type { EditProposal } from "../edit-proposals/editProposalSchemas";
import type { CreateEditProposalInput } from "../edit-proposals/editProposalService";
import {
  localWorkspaceFileStore,
  type WorkspaceFileStore,
} from "../workspace/workspaceFileStore";
import {
  aiAssistExecutionRunInputSchema,
  composeAiAssistTaskInstructions,
  standardAiAssistExecutionRunInputSchema,
  type AiAssistDefinition,
  type AiAssistTargetRange,
} from "./aiAssistContracts";
import {
  modelOverrideAssignment,
  type AiAssistStandardModelSelection,
} from "./aiAssistModelSelection";
import {
  prepareAiAssistExecution,
  type ReadSavedAiAssistFile,
  type ResolveAiAssist,
} from "./aiAssistExecutionShared";

export {
  aiAssistExecutionRunInputSchema,
  standardAiAssistExecutionRunInputSchema,
} from "./aiAssistContracts";

export type AiAssistExecutionRunInput = z.input<typeof aiAssistExecutionRunInputSchema>;
export type StandardAiAssistExecutionRunInput = z.input<
  typeof standardAiAssistExecutionRunInputSchema
>;

type ParsedAiAssistExecutionRunInput = z.infer<typeof aiAssistExecutionRunInputSchema>;
type ParsedStandardAiAssistExecutionRunInput = z.infer<
  typeof standardAiAssistExecutionRunInputSchema
>;

const aiAssistGeneratedTextSchema = z.object({
  newText: z.string(),
});

type GenerateObjectFunction = (options: {
  maxOutputTokens?: number;
  model: unknown;
  prompt: string;
  schema: typeof aiAssistGeneratedTextSchema;
  temperature?: number;
}) => Promise<{
  object: unknown;
  usage?: unknown;
}>;

type ResolveLlmProfileForRoleFunction = (
  role: LlmProfileRole,
) => Promise<ResolvedLlmProfile> | ResolvedLlmProfile;

type AiAssistModelProvider = {
  getLanguageModel(
    modelId: string,
    providerId?: string,
    profileId?: string,
  ): unknown;
};

type CreateEditProposalFunction = (
  input: CreateEditProposalInput,
) => Promise<EditProposal>;

type AiAssistExecutionProviderId = ResolvedLlmProfile["providerId"];

type AiAssistExecutionCompletedResult = {
  llmProfile: {
    id: string;
    llmProfileRole: "writing";
    modelId: string;
    providerId: AiAssistExecutionProviderId;
  };
  proposal: EditProposal;
  status: "completed";
  tokenUsage?: {
    inputTokens?: number;
    llmProfileId: string;
    llmProfileRole: "writing";
    modelId: string;
    outputTokens?: number;
    providerId: AiAssistExecutionProviderId;
    totalTokens?: number;
  };
};

type AiAssistExecutionErrorResult = {
  message: string;
  status: "error";
};

export type AiAssistExecutionResult =
  | AiAssistExecutionCompletedResult
  | AiAssistExecutionErrorResult;

export type CreateAiAssistExecutionServiceDeps = {
  createEditProposal: CreateEditProposalFunction;
  generateObject: GenerateObjectFunction;
  modelProvider: AiAssistModelProvider;
  readSavedFile: ReadSavedAiAssistFile;
  resolveAiAssist?: ResolveAiAssist;
  resolveLlmProfileForRole: ResolveLlmProfileForRoleFunction;
};

export type CreateStandardAiAssistExecutionServiceOptions = {
  siwcService?: SiwcService;
  createEditProposal?: CreateEditProposalFunction;
  fileStore?: WorkspaceFileStore;
  generateObject?: GenerateObjectFunction;
  llmProviderConfig?: LlmProviderConfig;
  llmProviderPlugins?: LlmProviderPlugin[];
  resolveAiAssist?: ResolveAiAssist;
  secretStore?: LlmSecretStore;
};

function buildProposalNewText(input: {
  generatedText: string;
  savedContent: string;
  targetRange: AiAssistTargetRange;
}): string {
  if (input.targetRange.start === input.targetRange.end) {
    return input.generatedText;
  }

  return `${input.savedContent.slice(0, input.targetRange.start)}${input.generatedText}${input.savedContent.slice(input.targetRange.end)}`;
}

function buildAiAssistPrompt(input: {
  assist: AiAssistDefinition;
  additionalInstruction?: string;
  targetText: string;
}): string {
  const instructions = composeAiAssistTaskInstructions(
    input.assist,
    input.additionalInstruction,
  );
  const lines = [
    "You are a manuscript editing assistant for a local workspace text editor.",
    "Return structured newText with the improved target text only.",
    "Do not add commentary outside the structured field.",
    "",
    "Task instruction:",
    instructions.fixedInstruction,
  ];

  if (instructions.additionalInstruction !== undefined) {
    lines.push("", "Additional instruction:", instructions.additionalInstruction);
  }

  lines.push("", "Target text:", input.targetText);
  return lines.join("\n");
}

function buildTokenUsage(
  writingProfile: ResolvedLlmProfile,
  usage: ReturnType<typeof tokenUsageFromUnknown>,
): AiAssistExecutionCompletedResult["tokenUsage"] | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
    llmProfileId: writingProfile.id,
    llmProfileRole: "writing",
    modelId: writingProfile.modelId,
    ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
    providerId: writingProfile.providerId,
    ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
  };
}

export function resolveAiAssistWritingProfile(options: {
  providers: Parameters<typeof resolveLlmProfileForRoleFromAssignments>[0]["providers"];
  roleAssignments: unknown;
  standardModelSelection?: AiAssistStandardModelSelection;
  userProfiles: LlmProfile[];
}): ResolvedLlmProfile {
  const selection = options.standardModelSelection ?? { kind: "default-writing" };
  const assignments = normalizeRoleAssignments({
    assignments: options.roleAssignments,
    providers: options.providers,
    userProfiles: options.userProfiles,
  });

  if (selection.kind === "default-writing") {
    return resolveLlmProfileForRoleFromAssignments({
      assignments,
      providers: options.providers,
      role: "writing",
      userProfiles: options.userProfiles,
    });
  }

  if (selection.kind === "profile") {
    const profiles = listLlmProfiles({
      providers: options.providers,
      userProfiles: options.userProfiles,
    });
    const profile = profiles.find((candidate) => candidate.id === selection.profileId);
    if (!profile) {
      throw new Error(`Unknown LLM profile: ${selection.profileId}`);
    }
    if (!profile.available) {
      throw new Error(profile.unavailableReason ?? `LLM profile "${selection.profileId}" is unavailable`);
    }

    return resolveLlmProfileForRoleFromAssignments({
      assignments: {
        ...assignments,
        writing: { kind: "profile", profileId: selection.profileId },
      },
      providers: options.providers,
      role: "writing",
      userProfiles: options.userProfiles,
    });
  }

  const writingDefaults = selection.providerId === "openai-chatgpt" ? { maxOutputTokens: getDefaultMaxOutputTokens("writing"), temperature: 0 } : resolveLlmProfileForRoleFromAssignments({
    assignments,
    providers: options.providers,
    role: "writing",
    userProfiles: options.userProfiles,
  });
  const provider = options.providers.find((candidate) => candidate.id === selection.providerId);
  if (!provider) {
    throw new Error(`Unknown LLM provider: ${selection.providerId}`);
  }
  const model = provider.models.find((candidate) => candidate.id === selection.modelId);
  if (!model?.available) {
    throw new Error(model?.unavailableReason ?? `LLM model "${selection.modelId}" is unavailable`);
  }

  return resolveLlmProfileForRoleFromAssignments({
    assignments: {
      ...assignments,
      writing: modelOverrideAssignment(selection, {
        maxOutputTokens: writingDefaults.maxOutputTokens,
        temperature: writingDefaults.temperature,
      }),
    },
    providers: options.providers,
    role: "writing",
    userProfiles: options.userProfiles,
  });
}

export function createAiAssistExecutionService(
  deps: CreateAiAssistExecutionServiceDeps,
): { run: (input: AiAssistExecutionRunInput) => Promise<AiAssistExecutionResult> } {
  return {
    run: async (input: AiAssistExecutionRunInput): Promise<AiAssistExecutionResult> => {
      const parsedInput: ParsedAiAssistExecutionRunInput =
        aiAssistExecutionRunInputSchema.parse(input);

      const { assist, savedFile, targetText } = await prepareAiAssistExecution(parsedInput, {
        readSavedFile: deps.readSavedFile,
        resolveAiAssist: deps.resolveAiAssist,
      });

      let writingProfile: ResolvedLlmProfile;
      try {
        writingProfile = await deps.resolveLlmProfileForRole("writing");
      } catch (error) {
        return {
          message: error instanceof Error ? error.message : "AI assist execution failed",
          status: "error",
        };
      }

      const profileError = writingProfileResolutionError(writingProfile);
      if (profileError) {
        return {
          message: profileError,
          status: "error",
        };
      }

      let model: unknown;
      try {
        model = deps.modelProvider.getLanguageModel(
          writingProfile.modelId,
          writingProfile.providerId,
          writingProfile.id,
        );
      } catch (error) {
        return {
          message: error instanceof Error ? error.message : "AI assist execution failed",
          status: "error",
        };
      }

      let generatedText: string;
      let tokenUsage: AiAssistExecutionCompletedResult["tokenUsage"];

      try {
        const result = await deps.generateObject({
          maxOutputTokens: writingProfile.maxOutputTokens,
          model,
          prompt: buildAiAssistPrompt({
            additionalInstruction: parsedInput.additionalInstruction,
            assist,
            targetText,
          }),
          schema: aiAssistGeneratedTextSchema,
          ...(getLlmProfileTemperature(writingProfile) !== undefined
            ? { temperature: getLlmProfileTemperature(writingProfile) }
            : {}),
        });
        const parsed = aiAssistGeneratedTextSchema.parse(result.object);
        generatedText = parsed.newText;
        tokenUsage = buildTokenUsage(writingProfile, tokenUsageFromUnknown(result.usage));
      } catch (error) {
        return {
          message: error instanceof Error ? error.message : "AI assist execution failed",
          status: "error",
        };
      }

      try {
        const proposal = await deps.createEditProposal({
          newText: buildProposalNewText({
            generatedText,
            savedContent: savedFile.content,
            targetRange: parsedInput.targetRange,
          }),
          oldText: savedFile.content,
          path: savedFile.path,
          workspaceRoot: parsedInput.workspaceRoot,
        });

        return {
          llmProfile: {
            id: writingProfile.id,
            llmProfileRole: "writing",
            modelId: writingProfile.modelId,
            providerId: writingProfile.providerId,
          },
          proposal,
          status: "completed",
          ...(tokenUsage !== undefined ? { tokenUsage } : {}),
        };
      } catch (error) {
        return {
          message: error instanceof Error ? error.message : "AI assist execution failed",
          status: "error",
        };
      }
    },
  };
}

export function createStandardAiAssistExecutionService(
  options: CreateStandardAiAssistExecutionServiceOptions = {},
): { run: (input: StandardAiAssistExecutionRunInput) => Promise<AiAssistExecutionResult> } {
  const runtime = createLlmRuntime({
    config: options.llmProviderConfig,
    llmProviderPlugins: options.llmProviderPlugins,
    secretStore: options.secretStore,
  });
  const generateObject =
    options.generateObject ?? (defaultGenerateObject as GenerateObjectFunction);
  const fileStore = options.fileStore ?? localWorkspaceFileStore;
  const createEditProposal = options.createEditProposal ?? createEditProposalForWorkspace;

  return {
    run: async (
      input: StandardAiAssistExecutionRunInput,
    ): Promise<AiAssistExecutionResult> => {
      const parsedInput: ParsedStandardAiAssistExecutionRunInput =
        standardAiAssistExecutionRunInputSchema.parse(input);
      const userProfiles: LlmProfile[] = parsedInput.userProfiles ?? [];
      const selection = parsedInput.standardModelSelection;
      const assignment = selection?.kind === "model" || selection?.kind === "profile" ? selection : parsedInput.roleAssignments?.writing;
      const selected = assignment?.kind === "model" ? assignment : assignment?.kind === "profile" ? userProfiles.find(profile => profile.id === assignment.profileId) : undefined;
      if (selected?.providerId === "openai-chatgpt" && !options.llmProviderPlugins?.some(plugin => plugin.id === "openai-chatgpt")) {
        if (!options.siwcService) return { status: "error", message: "ChatGPT接続は有効になっていません。" };
        try {
          return await withSiwcRuntime({ service: options.siwcService, modelId: selected.modelId, execute: ({ config, plugins }) => createStandardAiAssistExecutionService({ ...options, siwcService: undefined, llmProviderConfig: config, llmProviderPlugins: plugins }).run(parsedInput) });
        } catch (error: unknown) { return { status: "error", message: error instanceof Error ? error.message : "ChatGPT接続に失敗しました。" }; }
      }

      const { config, plugins } = await runtime.resolve({ userProfiles });
      const availableProviders = listAvailableLlmProviders({
        config,
        plugins,
        requireTools: false,
      });
      const modelProvider = createLlmPluginModelProvider(plugins);
      let resolvedWritingProfile: ResolvedLlmProfile;
      try {
        resolvedWritingProfile = resolveAiAssistWritingProfile({
          providers: availableProviders,
          roleAssignments: parsedInput.roleAssignments,
          standardModelSelection: parsedInput.standardModelSelection,
          userProfiles,
        });
      } catch (error) {
        return {
          message: error instanceof Error ? error.message : "AI assist execution failed",
          status: "error",
        };
      }
      const service = createAiAssistExecutionService({
        createEditProposal,
        generateObject,
        modelProvider,
        readSavedFile: async ({ path, workspaceRoot }) => {
          const context = await fileStore.createContext(workspaceRoot);
          const file = await fileStore.readTextFile(context, path);
          return {
            content: file.content,
            path: file.path,
          };
        },
        resolveAiAssist: options.resolveAiAssist,
        resolveLlmProfileForRole: () => resolvedWritingProfile,
      });

      return service.run({
        additionalInstruction: parsedInput.additionalInstruction,
        assistId: parsedInput.assistId,
        editorContent: parsedInput.editorContent,
        targetRange: parsedInput.targetRange,
        workspaceRelativePath: parsedInput.workspaceRelativePath,
        workspaceRoot: parsedInput.workspaceRoot,
      });
    },
  };
}
