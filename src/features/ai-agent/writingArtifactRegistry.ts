import { editProposalSchema, type EditProposal } from "../edit-proposals/editProposalSchemas";
import { randomUUID } from "node:crypto";
import type {
  CreateEditProposalInput,
  CreateFileProposalInput,
} from "../edit-proposals/editProposalService";
import { normalizeWorkspaceRelativePath } from "../workspace/workspaceFilePaths";
import type {
  DelegateWritingCompletedTokenUsage,
  DelegateWritingInternalCompletedOutput,
  DelegateWritingInternalOutput,
  DelegateWritingToolOutput,
  WritingDelegationOperation,
} from "./agentTools";

export type WritingArtifactRegistryEntry = {
  latencyMs: number;
  newText: string;
  oldText: string;
  operation: WritingDelegationOperation;
  targetPath: string;
  tokenUsage: DelegateWritingCompletedTokenUsage;
};

export type WritingArtifactRegistry = {
  artifacts: Map<string, WritingArtifactRegistryEntry>;
  consumedArtifactIds: Set<string>;
  delegateWritingFailedPaths: Set<string>;
};

export function normalizeWritingTargetPath(targetPath: string): string {
  return normalizeWorkspaceRelativePath(targetPath);
}

export function createWritingArtifactRegistry(): WritingArtifactRegistry {
  return {
    artifacts: new Map<string, WritingArtifactRegistryEntry>(),
    consumedArtifactIds: new Set<string>(),
    delegateWritingFailedPaths: new Set<string>(),
  };
}

export async function createProposalFromArtifact(options: {
  artifactId: string;
  createEditProposal: (input: CreateEditProposalInput) => Promise<EditProposal> | EditProposal;
  createFileProposal: (input: CreateFileProposalInput) => Promise<EditProposal> | EditProposal;
  registry: WritingArtifactRegistry;
  workspaceRoot: string;
}): Promise<EditProposal> {
  const entry = options.registry.artifacts.get(options.artifactId);
  if (!entry) {
    throw new Error(`Unknown writing artifact: ${options.artifactId}`);
  }
  if (options.registry.consumedArtifactIds.has(options.artifactId)) {
    throw new Error(`Writing artifact already consumed: ${options.artifactId}`);
  }

  options.registry.consumedArtifactIds.add(options.artifactId);
  try {
    const proposal =
      entry.operation === "create"
        ? await options.createFileProposal({
            content: entry.newText,
            path: entry.targetPath,
            workspaceRoot: options.workspaceRoot,
          })
        : await options.createEditProposal({
            newText: entry.newText,
            oldText: entry.oldText,
            path: entry.targetPath,
            workspaceRoot: options.workspaceRoot,
          });
    return editProposalSchema.parse({
      ...proposal,
      sourceRole: "writing",
    });
  } catch (error) {
    options.registry.consumedArtifactIds.delete(options.artifactId);
    throw error;
  }
}

function registerCompletedWritingArtifact(
  registry: WritingArtifactRegistry,
  output: DelegateWritingInternalCompletedOutput,
): DelegateWritingToolOutput {
  const artifactId = randomUUID();
  const targetPath = normalizeWritingTargetPath(output.targetPath);
  const entry: WritingArtifactRegistryEntry = {
    newText: output.artifact.newText,
    oldText: output.operation === "create" ? "" : output.artifact.oldText,
    latencyMs: output.latencyMs,
    operation: output.operation,
    targetPath,
    tokenUsage: output.tokenUsage,
  };
  registry.artifacts.set(artifactId, entry);
  return {
    artifactId,
    latencyMs: output.latencyMs,
    operation: output.operation,
    status: "completed",
    targetPath,
    tokenUsage: output.tokenUsage,
  };
}

export function toPublicDelegateWritingOutput(
  registry: WritingArtifactRegistry,
  output: DelegateWritingInternalOutput,
): DelegateWritingToolOutput {
  if (output.status === "error") {
    registry.delegateWritingFailedPaths.add(normalizeWritingTargetPath(output.targetPath));
    return output;
  }
  return registerCompletedWritingArtifact(registry, output);
}
