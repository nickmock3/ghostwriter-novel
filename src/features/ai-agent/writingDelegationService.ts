import {
  delegateWritingToolInputSchema,
  writingDelegationArtifactSchema,
  writingDelegationCreateArtifactSchema,
  type DelegateWritingInternalOutput,
  type DelegateWritingToolInput,
} from "./agentTools";
import {
  extractDelegateWritingDiagnostic,
  safeNotifyDelegateWritingDiagnostic,
  type DelegateWritingDiagnosticObserver,
} from "./delegateWritingDiagnostics";
import {
  getLlmProfileTemperature,
  writingProfileResolutionError,
  type LlmProfileRole,
  type ResolvedLlmProfile,
} from "./llmProfiles";
import type { ModelProvider } from "./modelProvider";
import { normalizeWritingTargetPath } from "./writingArtifactRegistry";
import type { ResolvedWritingDelegationTarget } from "./writingDelegationTarget";
import { tokenUsageFromUnknown } from "./agentTokenUsage";
import type { GenerateWritingObject } from "./streamWritingObject";

type ResolveLlmProfileForRoleFunction = (
  role: LlmProfileRole,
) => Promise<ResolvedLlmProfile> | ResolvedLlmProfile;

export type CreateWritingDelegationServiceOptions = {
  generateObject: GenerateWritingObject;
  modelProvider: ModelProvider;
  onDelegateWritingDiagnostic?: DelegateWritingDiagnosticObserver;
  readContentsByPath: Map<string, string>;
  resolveLlmProfileForRole: ResolveLlmProfileForRoleFunction;
  resolveWritingDelegationTarget: (
    workspaceRoot: string,
    targetPath: string,
  ) => Promise<ResolvedWritingDelegationTarget>;
  workspaceRoot: string;
};

function buildDelegateWritingCreatePrompt(input: {
  instruction: string;
  targetPath: string;
}): string {
  return [
    "You are a manuscript writing model for a local workspace text editor.",
    `Target new file: ${input.targetPath}`,
    "The target file does not exist yet. Write new manuscript prose for this new file.",
    "Return structured content with the full new file text only.",
    "Do not invent existing file content or add commentary outside the structured field.",
    "新規ファイルの本文を生成してください。",
    "",
    "Writing instruction:",
    input.instruction,
  ].join("\n");
}

function buildDelegateWritingPrompt(input: {
  fileContent: string;
  instruction: string;
  targetPath: string;
}): string {
  return [
    "You are a manuscript writing model for a local workspace text editor.",
    `Target file: ${input.targetPath}`,
    "Return structured oldText and newText for a single exact text replacement edit proposal.",
    "oldText must match the exact substring in the current file content that should be replaced.",
    "newText must be the replacement prose. Do not add commentary outside the structured fields.",
    "",
    "Writing instruction:",
    input.instruction,
    "",
    "Current file content:",
    input.fileContent,
  ].join("\n");
}

export function createWritingDelegationService(
  options: CreateWritingDelegationServiceOptions,
): (input: DelegateWritingToolInput, onProgress?: (characters: number) => void) => Promise<DelegateWritingInternalOutput> {
  return async (input, onProgress): Promise<DelegateWritingInternalOutput> => {
    const parsedInput = delegateWritingToolInputSchema.parse(input);
    let normalizedTargetPath: string;
    try {
      const resolvedTarget = await options.resolveWritingDelegationTarget(
        options.workspaceRoot,
        parsedInput.targetPath,
      );
      normalizedTargetPath = resolvedTarget.normalizedPath;
      if (resolvedTarget.state.kind === "unreadable") {
        return {
          message: resolvedTarget.state.reason,
          status: "error",
          targetPath: normalizedTargetPath,
        };
      }

      if (resolvedTarget.state.kind === "readable") {
        const unreadFileContent = options.readContentsByPath.get(normalizedTargetPath);
        if (unreadFileContent === undefined) {
          return {
            message: "DelegateWriting requires the target file to be read first",
            status: "error",
            targetPath: normalizedTargetPath,
          };
        }
      }

      const startedAt = Date.now();
      let writingProfile: ResolvedLlmProfile;
      try {
        writingProfile = await options.resolveLlmProfileForRole("writing");
      } catch (error) {
        return {
          message: error instanceof Error ? error.message : "Writing delegation failed",
          status: "error",
          targetPath: normalizedTargetPath,
        };
      }
      const profileError = writingProfileResolutionError(writingProfile);
      if (profileError) {
        return {
          message: profileError,
          status: "error",
          targetPath: normalizedTargetPath,
        };
      }

      let model: unknown;
      try {
        model = options.modelProvider.getLanguageModel(
          writingProfile.modelId,
          writingProfile.providerId,
          writingProfile.id,
        );
      } catch (error) {
        return {
          message: error instanceof Error ? error.message : "Writing delegation failed",
          status: "error",
          targetPath: normalizedTargetPath,
        };
      }

      if (resolvedTarget.state.kind === "missing") {
        try {
          const result = await options.generateObject({
            maxOutputTokens: writingProfile.maxOutputTokens,
            ...(onProgress ? { onProgress } : {}),
            model,
            prompt: buildDelegateWritingCreatePrompt({
              instruction: parsedInput.instruction,
              targetPath: normalizedTargetPath,
            }),
            schema: writingDelegationCreateArtifactSchema,
            ...(getLlmProfileTemperature(writingProfile) !== undefined
              ? { temperature: getLlmProfileTemperature(writingProfile) }
              : {}),
          });
          const createArtifact = writingDelegationCreateArtifactSchema.parse(result.object);
          const usage = tokenUsageFromUnknown(result.usage);

          return {
            artifact: {
              newText: createArtifact.content,
              oldText: "",
            },
            latencyMs: Date.now() - startedAt,
            operation: "create",
            status: "completed",
            targetPath: normalizedTargetPath,
            tokenUsage: {
              ...(usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
              llmProfileId: writingProfile.id,
              llmProfileRole: "writing",
              modelId: writingProfile.modelId,
              ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
              providerId: writingProfile.providerId,
              ...(usage?.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
            },
          };
        } catch (error) {
          if (options.onDelegateWritingDiagnostic) {
            await safeNotifyDelegateWritingDiagnostic(
              options.onDelegateWritingDiagnostic,
              extractDelegateWritingDiagnostic({
                error,
                targetPath: normalizedTargetPath,
                writingProfile,
              }),
            );
          }
          return {
            message: error instanceof Error ? error.message : "Writing delegation failed",
            status: "error",
            targetPath: normalizedTargetPath,
          };
        }
      }

      const fileContent = options.readContentsByPath.get(normalizedTargetPath)!;

      try {
        const result = await options.generateObject({
          maxOutputTokens: writingProfile.maxOutputTokens,
          ...(onProgress ? { onProgress } : {}),
          model,
          prompt: buildDelegateWritingPrompt({
            fileContent,
            instruction: parsedInput.instruction,
            targetPath: normalizedTargetPath,
          }),
          schema: writingDelegationArtifactSchema,
          ...(getLlmProfileTemperature(writingProfile) !== undefined
            ? { temperature: getLlmProfileTemperature(writingProfile) }
            : {}),
        });
        const artifact = writingDelegationArtifactSchema.parse(result.object);
        const usage = tokenUsageFromUnknown(result.usage);

        return {
          artifact,
          latencyMs: Date.now() - startedAt,
          operation: "edit",
          status: "completed",
          targetPath: normalizedTargetPath,
          tokenUsage: {
            ...(usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
            llmProfileId: writingProfile.id,
            llmProfileRole: "writing",
            modelId: writingProfile.modelId,
            ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
            providerId: writingProfile.providerId,
            ...(usage?.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
          },
        };
      } catch (error) {
        if (options.onDelegateWritingDiagnostic) {
          await safeNotifyDelegateWritingDiagnostic(
            options.onDelegateWritingDiagnostic,
            extractDelegateWritingDiagnostic({
              error,
              targetPath: normalizedTargetPath,
              writingProfile,
            }),
          );
        }
        return {
          message: error instanceof Error ? error.message : "Writing delegation failed",
          status: "error",
          targetPath: normalizedTargetPath,
        };
      }
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : "Writing delegation failed",
        status: "error",
        targetPath: normalizeWritingTargetPath(parsedInput.targetPath),
      };
    }
  };
}
