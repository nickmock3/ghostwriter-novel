import type { LlmProfileSettings } from "../features/ai-agent/llmProfileStorage";
import type {
  LlmProfile,
  LlmProfileRoleAssignment,
  LlmProfileRoleAssignments,
} from "../features/ai-agent/llmProfiles";
import type { LlmProviderId } from "../features/ai-agent/modelProvider";
import type { LlmProfileWithAvailability } from "../features/ai-agent/llmModelSelection";
import type { UserSettings } from "../features/settings/settingsStorage";
import type { LlmProviderChoice, SelectedModel } from "../features/ai-agent/llmSelection";

export type BuildMainLlmChatPanePropsInput = {
  llmProfileSettings: LlmProfileSettings | null | undefined;
  llmProfiles: LlmProfileWithAvailability[];
  llmProviders: LlmProviderChoice[];
  setLlmProfileSettings: (
    value:
      | LlmProfileSettings
      | null
      | ((current: LlmProfileSettings | null) => LlmProfileSettings | null),
  ) => void;
  setSettingsModelSelection: (modelSelection: SelectedModel | null) => void;
  settingsModelSelection: UserSettings["modelSelection"];
};

export type MainLlmChatPaneProps = {
  modelSelection: SelectedModel | null;
  roleAssignments: LlmProfileRoleAssignments | null;
  providers: LlmProviderChoice[];
  profiles: LlmProfileWithAvailability[];
  onMainLlmProfileIdChange: (profileId: string | null) => void;
  onMainLlmModelSelectionChange: (modelSelection: SelectedModel | null) => void;
  onModelSelectionChange: (modelSelection: SelectedModel | null) => void;
};

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
  settingsModelSelection: UserSettings["modelSelection"],
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

export function buildMainLlmChatPaneProps(input: BuildMainLlmChatPanePropsInput): MainLlmChatPaneProps {
  const mainRoleAssignment = input.llmProfileSettings?.roleAssignments.main;

  return {
    modelSelection: chatModelSelection(
      input.settingsModelSelection,
      mainRoleAssignment,
      input.llmProfiles,
    ),
    roleAssignments: input.llmProfileSettings?.roleAssignments ?? null,
    providers: input.llmProviders,
    profiles: input.llmProfiles,
    onMainLlmProfileIdChange: (profileId) => {
      if (!profileId) {
        return;
      }

      input.setLlmProfileSettings((current) => {
        if (!current) {
          return current;
        }

        return updateMainLlmProfileId(current, profileId);
      });
    },
    onMainLlmModelSelectionChange: (modelSelection) => {
      if (!modelSelection) {
        return;
      }

      input.setLlmProfileSettings((current) => {
        if (!current) {
          return current;
        }

        return updateMainLlmModelSelection(current, modelSelection);
      });
      input.setSettingsModelSelection(modelSelection);
    },
    onModelSelectionChange: (modelSelection) => {
      input.setSettingsModelSelection(modelSelection);
    },
  };
}
