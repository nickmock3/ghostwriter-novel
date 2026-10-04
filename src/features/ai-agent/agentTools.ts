import type { EditProposal } from "../edit-proposals/editProposalSchemas";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  createProposalFromArtifact,
  normalizeWritingTargetPath,
  type WritingArtifactRegistry,
  type WritingArtifactRegistryEntry,
} from "./writingArtifactRegistry";
import {
  createDirectoryProposalForWorkspace,
  createFileProposalForWorkspace,
  createEditProposalForWorkspace,
  type CreateDirectoryProposalInput,
  type CreateFileProposalInput,
  type CreateEditProposalInput,
} from "../edit-proposals/editProposalService";
import {
  planItemSchema,
  type PlanItem,
} from "../ai-chat/conversationSchemas";
import {
  globToolInputSchema,
  grepToolInputSchema,
  readToolInputSchema,
  readWorkspaceFile,
  searchToolInputSchema,
  type ReadToolInput,
  type ReadToolOutput,
} from "../ai-tools/ripgrepTools";
import {
  localWorkspaceSearchStore,
  type WorkspaceSearchStore,
} from "../workspace/workspaceSearchStore";
import {
  activateSkill,
  createAgentSkillRegistry,
  type AgentSkillMetadata,
  type AgentSkillPlugin,
  type AgentSkillRegistry,
} from "./agentSkills";

export const editToolInputSchema = z.object({
  path: z.string().min(1),
  oldText: z.string(),
  newText: z.string(),
});

export const createToolInputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const createDirectoryToolInputSchema = z.object({
  path: z.string().min(1),
});

export const updatePlanToolInputSchema = z
  .object({
    items: z.array(planItemSchema).min(1),
  })
  .refine(
    (plan) => plan.items.filter((item) => item.status === "in_progress").length <= 1,
    "Only one plan item can be in_progress",
  );

export const spawnSubAgentToolInputSchema = z.object({
  profileId: z.enum(["read-only-sub-agent", "workspace-search-sub-agent"]),
  prompt: z.string().min(1).max(4000),
  purpose: z.string().min(1).max(500),
});

export const delegateWritingToolInputSchema = z.object({
  instruction: z.string().min(1),
  targetPath: z.string().min(1),
});

export const createWritingEditProposalToolInputSchema = z
  .object({
    artifactId: z.string().min(1),
  })
  .strict();

export const readDroppedTextFileToolInputSchema = z
  .object({
    droppedFileId: z.string().min(1),
  })
  .strict();

export const placeDroppedTextFileToolInputSchema = z
  .object({
    droppedFileId: z.string().min(1),
    targetPath: z.string().min(1),
  })
  .strict();

export const writingDelegationArtifactSchema = z.object({
  newText: z.string(),
  oldText: z.string(),
});

export const writingDelegationCreateArtifactSchema = z.object({
  content: z.string(),
});

export type WritingDelegationOperation = "create" | "edit";

export const useSkillToolInputSchema = z.object({
  skillId: z.string().min(1),
});

export type EditToolInput = z.infer<typeof editToolInputSchema>;
export type CreateToolInput = z.infer<typeof createToolInputSchema>;
export type CreateDirectoryToolInput = z.infer<typeof createDirectoryToolInputSchema>;
export type UpdatePlanToolInput = z.infer<typeof updatePlanToolInputSchema>;
export type UpdatePlanToolOutput = { items: PlanItem[] };
export type SpawnSubAgentToolInput = z.infer<typeof spawnSubAgentToolInputSchema>;
export type DelegateWritingToolInput = z.infer<typeof delegateWritingToolInputSchema>;
export type CreateWritingEditProposalToolInput = z.infer<
  typeof createWritingEditProposalToolInputSchema
>;
export type ReadDroppedTextFileToolInput = z.infer<typeof readDroppedTextFileToolInputSchema>;
export type PlaceDroppedTextFileToolInput = z.infer<typeof placeDroppedTextFileToolInputSchema>;
export type WritingDelegationArtifact = z.infer<typeof writingDelegationArtifactSchema>;
export type UseSkillToolInput = z.infer<typeof useSkillToolInputSchema>;
export type ListSkillsToolOutput = { skills: AgentSkillMetadata[] };
export type UseSkillToolOutput = {
  displayName: string;
  skillId: string;
  status: "activated";
};
export type SpawnSubAgentToolOutput =
  | {
      profileId: string;
      status: "completed";
      summary: string;
      tokenUsage?: {
        inputTokens?: number;
        llmProfileId?: string;
        llmProfileRole?: string;
        modelId?: string;
        outputTokens?: number;
        providerId?: string;
        totalTokens?: number;
      };
    }
  | { message: string; profileId: string; status: "error" };

export type DelegateWritingCompletedTokenUsage = {
  inputTokens?: number;
  llmProfileId?: string;
  llmProfileRole: "writing";
  modelId: string;
  outputTokens?: number;
  providerId: string;
  totalTokens?: number;
};

export type DelegateWritingToolOutput =
  | {
      artifactId: string;
      latencyMs: number;
      operation: WritingDelegationOperation;
      status: "completed";
      targetPath: string;
      tokenUsage: DelegateWritingCompletedTokenUsage;
    }
  | { message: string; status: "error"; targetPath: string };

export type DelegateWritingInternalCompletedOutput = {
  artifact: WritingDelegationArtifact;
  latencyMs: number;
  operation: WritingDelegationOperation;
  status: "completed";
  targetPath: string;
  tokenUsage: DelegateWritingCompletedTokenUsage;
};

export type DelegateWritingInternalOutput =
  | DelegateWritingInternalCompletedOutput
  | { message: string; status: "error"; targetPath: string };

export type { WritingArtifactRegistry, WritingArtifactRegistryEntry };

export type AgentToolServices = {
  createDirectoryProposal?: (input: CreateDirectoryProposalInput) => Promise<EditProposal> | EditProposal;
  createEditProposal?: (input: CreateEditProposalInput) => Promise<EditProposal> | EditProposal;
  createFileProposal?: (input: CreateFileProposalInput) => Promise<EditProposal> | EditProposal;
  delegateWriting?: (
    input: DelegateWritingToolInput,
    context?: { toolCallId: string },
  ) => Promise<DelegateWritingToolOutput> | DelegateWritingToolOutput;
  placeDroppedTextFile?: (input: PlaceDroppedTextFileToolInput) => Promise<unknown> | unknown;
  readDroppedTextFile?: (input: ReadDroppedTextFileToolInput) => Promise<unknown> | unknown;
  readWorkspaceFile?: (input: ReadToolInput) => Promise<ReadToolOutput>;
  workspaceSearchStore?: WorkspaceSearchStore;
  spawnSubAgent?: (
    input: SpawnSubAgentToolInput,
  ) => Promise<SpawnSubAgentToolOutput> | SpawnSubAgentToolOutput;
};

export type RunAgentLoopToolServiceOverrides = Omit<AgentToolServices, "delegateWriting"> & {
  delegateWriting?: (
    input: DelegateWritingToolInput,
  ) => Promise<DelegateWritingInternalOutput> | DelegateWritingInternalOutput;
};

type ResolvedAgentToolServices = Required<
  Omit<
    AgentToolServices,
    "delegateWriting" | "placeDroppedTextFile" | "readDroppedTextFile" | "spawnSubAgent"
  >
> &
  Pick<
    AgentToolServices,
    "delegateWriting" | "placeDroppedTextFile" | "readDroppedTextFile" | "spawnSubAgent"
  >;

export type AgentToolPluginContext = ResolvedAgentToolServices & {
  workspaceRoot: string;
};

export type AgentToolPlugin = {
  createTools: (context: AgentToolPluginContext) => ToolSet;
  displayName: string;
  id: string;
  kind: "agent-tool";
};

export type CreateAgentToolsOptions = AgentToolServices & {
  activeSkillIds?: Set<string>;
  onReadSuccess?: (path: string, content: string) => void;
  plugins?: AgentToolPlugin[];
  skillPlugins?: AgentSkillPlugin[];
  skillRegistry?: AgentSkillRegistry;
  workspaceRoot: string;
  writingArtifactRegistry?: WritingArtifactRegistry;
};

function resolveAgentToolServices(options: AgentToolServices): ResolvedAgentToolServices {
  return {
    createDirectoryProposal: options.createDirectoryProposal ?? createDirectoryProposalForWorkspace,
    createEditProposal: options.createEditProposal ?? createEditProposalForWorkspace,
    createFileProposal: options.createFileProposal ?? createFileProposalForWorkspace,
    delegateWriting: options.delegateWriting,
    placeDroppedTextFile: options.placeDroppedTextFile,
    readDroppedTextFile: options.readDroppedTextFile,
    readWorkspaceFile: options.readWorkspaceFile ?? readWorkspaceFile,
    workspaceSearchStore: options.workspaceSearchStore ?? localWorkspaceSearchStore,
    spawnSubAgent: options.spawnSubAgent,
  };
}

function assertWritingDelegationFallbackAllowed(
  writingArtifactRegistry: WritingArtifactRegistry | undefined,
  targetPath: string,
  toolName: "Create" | "Edit",
): void {
  const normalizedPath = normalizeWritingTargetPath(targetPath);
  if (writingArtifactRegistry?.delegateWritingFailedPaths.has(normalizedPath)) {
    throw new Error(
      `${toolName} is not allowed for ${normalizedPath} after DelegateWriting failed in this run`,
    );
  }
}

export function createCoreAgentTools(options: {
  activeSkillIds?: Set<string>;
  onReadSuccess?: (path: string, content: string) => void;
  skillRegistry: AgentSkillRegistry;
  services: ResolvedAgentToolServices;
  workspaceRoot: string;
  writingArtifactRegistry?: WritingArtifactRegistry;
}): ToolSet {
  let workspaceSearchContext: ReturnType<WorkspaceSearchStore["createContext"]> | undefined;
  const getWorkspaceSearchContext = (): ReturnType<WorkspaceSearchStore["createContext"]> => {
    if (!workspaceSearchContext) {
      workspaceSearchContext = options.services.workspaceSearchStore.createContext(
        options.workspaceRoot,
      );
    }
    return workspaceSearchContext!;
  };

  return {
    Read: tool({
      description: "Read a text file from the active local workspace.",
      inputSchema: readToolInputSchema.omit({ workspaceRoot: true }),
      execute: async (input) => {
        const result = await options.services.readWorkspaceFile({
          ...input,
          workspaceRoot: options.workspaceRoot,
        });
        options.onReadSuccess?.(result.path, result.content);
        return result;
      },
    }),
    Glob: tool({
      description: "Find workspace files by glob pattern.",
      inputSchema: globToolInputSchema.omit({ workspaceRoot: true }),
      execute: async (input) =>
        options.services.workspaceSearchStore.glob(await getWorkspaceSearchContext(), input),
    }),
    Grep: tool({
      description: "Search exact text in workspace files.",
      inputSchema: grepToolInputSchema.omit({ workspaceRoot: true }),
      execute: async (input) =>
        options.services.workspaceSearchStore.grep(await getWorkspaceSearchContext(), input),
    }),
    Search: tool({
      description: "Search the local workspace for files and snippets relevant to a natural-language query.",
      inputSchema: searchToolInputSchema.omit({ workspaceRoot: true }),
      execute: async (input) =>
        options.services.workspaceSearchStore.search(await getWorkspaceSearchContext(), input),
    }),
    ReadDroppedTextFile: tool({
      description:
        "Read one text file dropped with the current chat message. Use only its opaque droppedFileId; the temporary path is never exposed.",
      inputSchema: readDroppedTextFileToolInputSchema,
      execute: (input) => {
        if (!options.services.readDroppedTextFile) {
          throw new Error("No dropped text file is available for this request");
        }
        return options.services.readDroppedTextFile(input);
      },
    }),
    PlaceDroppedTextFile: tool({
      description:
        "Place one text file dropped with the current chat message at a new workspace-relative target path without reproducing its content. Existing targets are never overwritten.",
      inputSchema: placeDroppedTextFileToolInputSchema,
      execute: (input) => {
        if (!options.services.placeDroppedTextFile) {
          throw new Error("No dropped text file is available for this request");
        }
        return options.services.placeDroppedTextFile(input);
      },
    }),
    ListSkills: tool({
      description:
        "List trusted agent skills that can add focused instructions for the current run. Returns metadata only, not full skill instructions.",
      inputSchema: z.object({}),
      execute: (): ListSkillsToolOutput => ({
        skills: options.skillRegistry.listMetadata(),
      }),
    }),
    UseSkill: tool({
      description:
        "Activate one trusted agent skill for the current run. This only affects future system prompt instructions and does not grant tools or write files.",
      inputSchema: useSkillToolInputSchema,
      execute: async (input): Promise<UseSkillToolOutput> => {
        const parsedInput = useSkillToolInputSchema.parse(input);
        return activateSkill({
          activeSkillIds: options.activeSkillIds,
          skillId: parsedInput.skillId,
          skillRegistry: options.skillRegistry,
        });
      },
    }),
    Edit: tool({
      description:
        "Create a pending edit proposal for a single exact text replacement. This does not write files.",
      inputSchema: editToolInputSchema,
      execute: async (input) => {
        assertWritingDelegationFallbackAllowed(options.writingArtifactRegistry, input.path, "Edit");
        return options.services.createEditProposal({
          ...input,
          workspaceRoot: options.workspaceRoot,
        });
      },
    }),
    Create: tool({
      description:
        "Create a pending proposal for a new text file. This does not write files until the user applies it.",
      inputSchema: createToolInputSchema,
      execute: async (input) => {
        assertWritingDelegationFallbackAllowed(options.writingArtifactRegistry, input.path, "Create");
        return options.services.createFileProposal({ ...input, workspaceRoot: options.workspaceRoot });
      },
    }),
    CreateDirectory: tool({
      description:
        "Create a pending proposal for a new directory. This does not create the directory until the user applies it.",
      inputSchema: createDirectoryToolInputSchema,
      execute: (input) =>
        options.services.createDirectoryProposal({ ...input, workspaceRoot: options.workspaceRoot }),
    }),
    UpdatePlan: tool({
      description:
        "Update the short-lived plan shown in the chat for the current response only. This only changes display state and never reads, writes, edits, applies, or rejects files.",
      inputSchema: updatePlanToolInputSchema,
      execute: (input): UpdatePlanToolOutput => updatePlanToolInputSchema.parse(input),
    }),
    ...(options.services.delegateWriting
      ? {
          DelegateWriting: tool({
            description:
              "Delegate manuscript prose generation to the writing model for a target file path. For existing files, the target must already have been read in this run. For new files that do not exist yet, Read is not required. Returns an opaque artifactId for CreateWritingEditProposal.",
            inputSchema: delegateWritingToolInputSchema,
            execute: (input, context) => {
              if (!options.services.delegateWriting) {
                throw new Error("DelegateWriting is not available in this agent context");
              }
              return options.services.delegateWriting(input, context ? { toolCallId: context.toolCallId } : undefined);
            },
          }),
        }
      : {}),
    ...(options.writingArtifactRegistry
      ? {
          CreateWritingEditProposal: tool({
            description:
              "Create a pending edit or new-file proposal from a completed DelegateWriting artifact using only its opaque artifactId. This does not write files.",
            inputSchema: createWritingEditProposalToolInputSchema,
            execute: async (input) => {
              const parsedInput = createWritingEditProposalToolInputSchema.parse(input);
              return createProposalFromArtifact({
                artifactId: parsedInput.artifactId,
                createEditProposal: options.services.createEditProposal,
                createFileProposal: options.services.createFileProposal,
                registry: options.writingArtifactRegistry!,
                workspaceRoot: options.workspaceRoot,
              });
            },
          }),
        }
      : {}),
    ...(options.services.spawnSubAgent
      ? {
          SpawnSubAgent: tool({
            description:
              "Delegate a bounded read-only investigation to a sub-agent and return its summarized result. Sub-agents cannot spawn other sub-agents.",
            inputSchema: spawnSubAgentToolInputSchema,
            execute: (input) => {
              if (!options.services.spawnSubAgent) {
                throw new Error("SpawnSubAgent is not available in this agent context");
              }
              return options.services.spawnSubAgent(input);
            },
          }),
        }
      : {}),
  };
}

export function composeAgentTools(options: {
  coreTools: ToolSet;
  plugins?: AgentToolPlugin[];
  pluginContext: AgentToolPluginContext;
}): ToolSet {
  const tools: ToolSet = { ...options.coreTools };
  const coreToolNames = new Set(Object.keys(options.coreTools));

  for (const plugin of options.plugins ?? []) {
    const pluginTools = plugin.createTools(options.pluginContext);
    if (typeof pluginTools !== "object" || pluginTools === null || Array.isArray(pluginTools)) {
      throw new Error(`AgentToolPlugin "${plugin.id}" createTools must return a ToolSet object.`);
    }
    for (const [toolName, pluginTool] of Object.entries(pluginTools)) {
      if (toolName.trim().length === 0) {
        throw new Error(`AgentToolPlugin "${plugin.id}" registered an empty tool name.`);
      }
      if (typeof pluginTool !== "object" || pluginTool === null || Array.isArray(pluginTool)) {
        throw new Error(
          `AgentToolPlugin "${plugin.id}" tool "${toolName}" must be an AI SDK tool object.`,
        );
      }
      const candidateTool = pluginTool as unknown as Record<string, unknown>;
      if (
        typeof candidateTool.description !== "string" ||
        candidateTool.description.trim().length === 0
      ) {
        throw new Error(
          `AgentToolPlugin "${plugin.id}" tool "${toolName}" must have a non-empty description.`,
        );
      }
      if (!("inputSchema" in candidateTool)) {
        throw new Error(
          `AgentToolPlugin "${plugin.id}" tool "${toolName}" must have an inputSchema.`,
        );
      }
      if (coreToolNames.has(toolName)) {
        throw new Error(
          `AgentToolPlugin "${plugin.id}" cannot register tool "${toolName}" because it collides with a core tool.`,
        );
      }
      if (Object.prototype.hasOwnProperty.call(tools, toolName)) {
        throw new Error(
          `AgentToolPlugin "${plugin.id}" cannot register duplicate tool "${toolName}".`,
        );
      }
      tools[toolName] = pluginTool;
    }
  }

  return tools;
}

export function createAgentTools(options: CreateAgentToolsOptions): ToolSet {
  const services = resolveAgentToolServices(options);
  const skillRegistry =
    options.skillRegistry ??
    createAgentSkillRegistry({
      plugins: options.skillPlugins,
      workspaceRoot: options.workspaceRoot,
    });
  const pluginContext: AgentToolPluginContext = {
    ...services,
    workspaceRoot: options.workspaceRoot,
  };
  const coreTools = createCoreAgentTools({
    activeSkillIds: options.activeSkillIds,
    onReadSuccess: options.onReadSuccess,
    skillRegistry,
    services,
    workspaceRoot: options.workspaceRoot,
    writingArtifactRegistry: options.writingArtifactRegistry,
  });

  return composeAgentTools({
    coreTools,
    pluginContext,
    plugins: options.plugins,
  });
}
