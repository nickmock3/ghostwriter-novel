import type { LlmProfileSettings } from "./profiles/llmProfileStorage";
import type {
  LlmProfile,
  LlmProfileRoleAssignment,
} from "./profiles/llmProfiles";
import type { LlmProviderId } from "./modelProvider";
import type { SelectedModel } from "./selection/llmSelection";

function selectedModelFromRoleAssignment(
  assignment: LlmProfileRoleAssignment | undefined,
  profiles: Array<LlmProfile & { available: boolean; unavailableReason?: string }>,
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

export function chatModelSelection(
  settingsModelSelection: SelectedModel | null,
  mainAssignment: LlmProfileRoleAssignment | undefined,
  profiles: Array<LlmProfile & { available: boolean; unavailableReason?: string }>,
) {
  if (mainAssignment?.kind === "profile") {
    return null;
  }

  return settingsModelSelection ?? selectedModelFromRoleAssignment(mainAssignment, profiles);
}

export function updateMainLlmProfileId(
  settings: LlmProfileSettings,
  profileId: string,
): LlmProfileSettings {
  return {
    ...settings,
    roleAssignments: {
      ...settings.roleAssignments,
      main: {
        kind: "profile",
        profileId,
      },
    },
  };
}

export function updateMainLlmModelSelection(
  settings: LlmProfileSettings,
  modelSelection: SelectedModel,
): LlmProfileSettings {
  return {
    ...settings,
    roleAssignments: {
      ...settings.roleAssignments,
      main: {
        kind: "model",
        modelId: modelSelection.modelId,
        providerId: modelSelection.providerId as LlmProviderId,
      },
    },
  };
}
