import { useEffect } from "react";
import { SettingsPage } from "../features/settings/SettingsPage";
import { useUserSettingsContext } from "./UserSettingsContext";
import { useLlmSettingsContext } from "../features/llm/LlmSettingsContext";
import { useWorkspaceContext } from "./WorkspaceContext";

export function SettingsRoutePage() {
  const { settings, setSettings } = useUserSettingsContext();
  const { workspaceRoot } = useWorkspaceContext();
  const {
    handleDeleteLlmSecret,
    handleSaveLlmSecret,
    llmProviders,
    llmSecretErrors,
    llmSecrets,
    refreshLlmSecrets,
    refreshLlmSettings,
    settingsError,
  } = useLlmSettingsContext();
  useEffect(() => {
    if (workspaceRoot === null) {
      return;
    }

    refreshLlmSecrets().catch((error: unknown) => {
      // Secret status is secondary to the settings page; provider/model settings remain usable.
      console.error(error);
    });
  }, [refreshLlmSecrets, workspaceRoot]);

  return (
    <SettingsPage
      onSiwcChanged={refreshLlmSettings}
      errorMessage={settingsError}
      isWorkspaceOpen={workspaceRoot !== null}
      llmProviders={llmProviders}
      llmSecretErrors={llmSecretErrors}
      llmSecrets={llmSecrets}
      onDeleteLlmSecret={handleDeleteLlmSecret}
      onSaveLlmSecret={handleSaveLlmSecret}
      onSettingsChange={setSettings}
      settings={settings}
    />
  );
}
