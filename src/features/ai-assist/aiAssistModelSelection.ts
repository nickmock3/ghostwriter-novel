import { z } from "zod";
import type { LlmProfile, LlmProfileRoleAssignment } from "../llm/profiles/llmProfiles";
import type { LlmProviderId } from "../llm/modelProvider";
import {
  profileIdFromRoleAssignment,
  selectedModelFromRoleAssignment,
  type LlmProfileWithAvailability,
} from "../llm/selection/llmModelSelection";
import {
  modelSelectionFromValue,
  modelSelectionValue,
  type LlmProviderChoice,
  type SelectedModel,
} from "../llm/selection/llmSelection";

export const aiAssistStandardModelSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("default-writing") }),
  z.object({ kind: z.literal("profile"), profileId: z.string().min(1) }),
  z.object({
    kind: z.literal("model"),
    modelId: z.string().min(1),
    providerId: z.string().min(1),
  }),
]);

export type AiAssistStandardModelSelection = z.infer<typeof aiAssistStandardModelSelectionSchema>;

export function aiAssistModelSelectValue(options: {
  profiles: LlmProfile[];
  standardModelSelection: AiAssistStandardModelSelection;
  writingAssignment: LlmProfileRoleAssignment | undefined;
}): string {
  if (options.standardModelSelection.kind === "profile") {
    return `profile:${options.standardModelSelection.profileId}`;
  }

  if (options.standardModelSelection.kind === "model") {
    return `${options.standardModelSelection.providerId}:${options.standardModelSelection.modelId}`;
  }

  const writingAssignment = options.writingAssignment;
  const profileId = profileIdFromRoleAssignment(writingAssignment);
  if (profileId) {
    const profile = options.profiles.find((candidate) => candidate.id === profileId);
    if (profile?.source === "user") {
      return `profile:${profileId}`;
    }
  }

  return modelSelectionValue(selectedModelFromRoleAssignment(writingAssignment, options.profiles));
}

export function standardSelectionFromModelValue(value: string): AiAssistStandardModelSelection {
  if (value.startsWith("profile:")) {
    return { kind: "profile", profileId: value.slice("profile:".length) };
  }

  const selectedModel = modelSelectionFromValue(value);
  if (selectedModel) {
    return {
      kind: "model",
      modelId: selectedModel.modelId,
      providerId: selectedModel.providerId,
    };
  }

  return { kind: "default-writing" };
}

export function isDefaultWritingModelValue(options: {
  profiles: LlmProfile[];
  value: string;
  writingAssignment: LlmProfileRoleAssignment | undefined;
}): boolean {
  return options.value === aiAssistModelSelectValue({
    profiles: options.profiles,
    standardModelSelection: { kind: "default-writing" },
    writingAssignment: options.writingAssignment,
  });
}

export function unavailableReasonForAiAssistModelSelection(options: {
  llmProfiles: LlmProfileWithAvailability[];
  llmProviders: LlmProviderChoice[];
  standardModelSelection: AiAssistStandardModelSelection;
}): Array<{ id: string; reason: string }> {
  if (options.standardModelSelection.kind === "profile") {
    const { profileId } = options.standardModelSelection;
    const profile = options.llmProfiles.find(
      (candidate) => candidate.id === profileId,
    );
    return profile && !profile.available && profile.unavailableReason
      ? [{ id: profile.id, reason: profile.unavailableReason }]
      : [];
  }

  if (options.standardModelSelection.kind === "model") {
    const { modelId, providerId } = options.standardModelSelection;
    const provider = options.llmProviders.find((candidate) => candidate.id === providerId);
    if (!provider) {
      return [{ id: `${providerId}:${modelId}`, reason: "選択したモデルは利用できません。" }];
    }

    const model = provider.models.find((candidate) => candidate.id === modelId);
    return model && !model.available && model.unavailableReason
      ? [{ id: `${provider.id}:${model.id}`, reason: model.unavailableReason }]
      : [];
  }

  return [];
}

export function resolvedStandardModelSelection(
  selection: AiAssistStandardModelSelection,
  profiles: LlmProfile[],
  writingAssignment: LlmProfileRoleAssignment | undefined,
): SelectedModel | null {
  if (selection.kind === "model") {
    return { modelId: selection.modelId, providerId: selection.providerId };
  }

  if (selection.kind === "profile") {
    const profile = profiles.find((candidate) => candidate.id === selection.profileId);
    return profile ? { modelId: profile.modelId, providerId: profile.providerId } : null;
  }

  return selectedModelFromRoleAssignment(writingAssignment, profiles);
}

export function modelOverrideAssignment(
  selection: Extract<AiAssistStandardModelSelection, { kind: "model" }>,
  writingDefaults: { maxOutputTokens: number; temperature: number },
) {
  return {
    kind: "model" as const,
    maxOutputTokens: writingDefaults.maxOutputTokens,
    modelId: selection.modelId,
    providerId: selection.providerId as LlmProviderId,
    temperature: writingDefaults.temperature,
  };
}
