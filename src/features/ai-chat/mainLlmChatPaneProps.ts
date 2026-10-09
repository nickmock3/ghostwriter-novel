import type { LlmProfileSettings } from "../llm/profiles/llmProfileStorage";
import type { LlmProfileRoleAssignments } from "../llm/profiles/llmProfiles";
import type { LlmProfileWithAvailability } from "../llm/selection/llmModelSelection";
import type { LlmProviderChoice, SelectedModel } from "../llm/selection/llmSelection";
import { chatModelSelection, updateMainLlmModelSelection, updateMainLlmProfileId } from "../llm/llmMainRoleAssignment";

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
  settingsModelSelection: SelectedModel | null;
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
