import type { LlmProfile, LlmProfileRoleAssignment } from "../ai-agent/llmProfiles";
import {
  modelSelectionFromValue,
  modelSelectionValue,
  type LlmProviderChoice,
  type SelectedModel,
} from "../settings/settingsStorage";

export function selectedModelFromRoleAssignment(
  assignment: LlmProfileRoleAssignment | undefined,
  profiles: LlmProfile[],
): SelectedModel | null {
  if (!assignment) {
    return null;
  }

  if (assignment.kind === "model") {
    return {
      modelId: assignment.modelId,
      providerId: assignment.providerId,
    };
  }

  const profile = profiles.find((candidate) => candidate.id === assignment.profileId);
  return profile
    ? {
        modelId: profile.modelId,
        providerId: profile.providerId,
      }
    : null;
}

export function profileIdFromRoleAssignment(assignment: LlmProfileRoleAssignment | undefined) {
  return assignment?.kind === "profile" ? assignment.profileId : undefined;
}

export function chatModelSelectValue(options: {
  mainAssignment: LlmProfileRoleAssignment | undefined;
  modelSelection: SelectedModel | null;
  profiles: LlmProfile[];
}) {
  const profileId = profileIdFromRoleAssignment(options.mainAssignment);
  if (profileId) {
    const profile = options.profiles.find((candidate) => candidate.id === profileId);
    if (profile?.source === "user") {
      return `profile:${profileId}`;
    }
    return modelSelectionValue(selectedModelFromRoleAssignment(options.mainAssignment, options.profiles));
  }

  const selectedModel =
    options.modelSelection ?? selectedModelFromRoleAssignment(options.mainAssignment, options.profiles);
  return modelSelectionValue(selectedModel);
}

export type LlmProfileWithAvailability = LlmProfile & {
  available: boolean;
  unavailableReason?: string;
};

export function unavailableReasonForCurrentChatModelSelection(options: {
  chatModelValue: string;
  llmProfiles: LlmProfileWithAvailability[];
  llmProviders: LlmProviderChoice[];
}) {
  if (options.chatModelValue.startsWith("profile:")) {
    const profileId = options.chatModelValue.slice("profile:".length);
    const profile = options.llmProfiles.find((candidate) => candidate.id === profileId);
    return profile && !profile.available && profile.unavailableReason
      ? [
          {
            id: profile.id,
            reason: profile.unavailableReason,
          },
        ]
      : [];
  }

  const selectedModel = modelSelectionFromValue(options.chatModelValue);
  if (!selectedModel) {
    return [];
  }

  const provider = options.llmProviders.find((candidate) => candidate.id === selectedModel.providerId);
  if (!provider) {
    return [];
  }

  const model = provider.models.find((candidate) => candidate.id === selectedModel.modelId);
  return model && !model.available && model.unavailableReason
    ? [
        {
          id: `${provider.id}:${model.id}`,
          reason: model.unavailableReason,
        },
      ]
    : [];
}

export function requiresApiKeySetup(reasons: Array<{ reason: string }>) {
  return reasons.some((item) => item.reason.includes("APIキー"));
}

export function selectedModelLabel(selectedModel: SelectedModel | null, llmProviders: LlmProviderChoice[]) {
  if (!selectedModel) {
    return "モデル未選択";
  }

  const provider = llmProviders.find((candidate) => candidate.id === selectedModel.providerId);
  const model = provider?.models.find((candidate) => candidate.id === selectedModel.modelId);
  if (provider && model) {
    return model.displayName;
  }

  return selectedModel.modelId;
}
