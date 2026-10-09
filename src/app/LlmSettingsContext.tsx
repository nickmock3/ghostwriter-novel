import { createContext, useContext, type Dispatch, type SetStateAction } from "react";
import type { LlmProfileSettings } from "../features/ai-agent/llmProfileStorage";
import type { LlmProfile } from "../features/ai-agent/llmProfiles";
import type { UserSettings } from "../features/settings/settingsStorage";
import type { LlmProviderChoice, LlmSecretStatus } from "../features/ai-agent/llmSelection";

export type LlmSettingsContextValue = {
  handleDeleteLlmSecret: (providerId: string) => Promise<void>;
  handleSaveLlmSecret: (providerId: string, apiKey: string) => Promise<void>;
  llmProfileSettings: LlmProfileSettings | null;
  llmProfiles: Array<LlmProfile & { available: boolean; unavailableReason?: string }>;
  llmProviders: LlmProviderChoice[];
  llmSecretErrors: Record<string, string>;
  llmSecrets: LlmSecretStatus[];
  refreshLlmSecrets: () => Promise<void>;
  refreshLlmSettings: () => Promise<void>;
  setLlmProfileSettings: Dispatch<SetStateAction<LlmProfileSettings | null>>;
  setSettings: Dispatch<SetStateAction<UserSettings>>;
  settings: UserSettings;
  settingsError: string | null;
};

export const LlmSettingsContext = createContext<LlmSettingsContextValue | null>(null);

export function useLlmSettingsContext() {
  const value = useContext(LlmSettingsContext);

  if (!value) {
    throw new Error("useLlmSettingsContext must be used inside App.");
  }

  return value;
}
