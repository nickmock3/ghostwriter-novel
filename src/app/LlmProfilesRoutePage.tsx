import { useEffect } from "react";
import { LlmProfilesPage } from "../features/ai-agent/LlmProfilesPage";
import { createDefaultRoleAssignments } from "../features/ai-agent/llmProfiles";
import { useLlmSettingsContext } from "./LlmSettingsContext";
import { useWorkspaceContext } from "./WorkspaceContext";
import { availableProvidersFromChoices, displayLlmProfiles } from "./llmDisplay";

export function LlmProfilesRoutePage() {
  const { workspaceRoot } = useWorkspaceContext();
  const {
    llmProfileSettings,
    llmProviders,
    refreshLlmSettings,
    setLlmProfileSettings,
    settingsError,
  } = useLlmSettingsContext();

  useEffect(() => {
    if (workspaceRoot === null) {
      return;
    }

    refreshLlmSettings().catch((error: unknown) => {
      console.error(error);
    });
  }, [refreshLlmSettings, workspaceRoot]);

  return (
    <LlmProfilesPage
      errorMessage={settingsError}
      isWorkspaceOpen={workspaceRoot !== null}
      llmProviders={llmProviders}
      profiles={displayLlmProfiles(llmProviders, llmProfileSettings?.userProfiles)}
      roleAssignments={
        llmProfileSettings?.roleAssignments ??
        createDefaultRoleAssignments({ providers: availableProvidersFromChoices(llmProviders) })
      }
      onRoleAssignmentsChange={(roleAssignments) =>
        setLlmProfileSettings((current) => ({
          roleAssignments,
          userProfiles: current?.userProfiles ?? [],
        }))
      }
      onUserProfilesChange={(userProfiles) =>
        setLlmProfileSettings((current) => ({
          roleAssignments:
            current?.roleAssignments ??
            createDefaultRoleAssignments({ providers: availableProvidersFromChoices(llmProviders) }),
          userProfiles,
        }))
      }
      userProfiles={llmProfileSettings?.userProfiles ?? []}
    />
  );
}
