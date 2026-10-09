import { z } from "zod";
import {
  firstAvailableModel,
  selectedModelSchema,
  type LlmProviderChoice,
  type SelectedModel,
} from "../ai-agent/llmSelection";

export const USER_SETTINGS_STORAGE_KEY = "ghostwriter:user-settings:v1";
export const LEGACY_USER_SETTINGS_STORAGE_KEY = "simple-ai-agent:user-settings:v1";

export type UserSettings = {
  autoCompactEnabled: boolean;
  autoCompactThresholdRatio: number;
  modelSelection: SelectedModel | null;
  restoreLastWorkspace: boolean;
  showEditorLineNumbers: boolean;
  showNoisyDirectories: boolean;
  wrapEditorLines: boolean;
};

export const AUTO_COMPACT_THRESHOLD_DEFAULT = 0.7;
export const AUTO_COMPACT_THRESHOLD_MIN = 0.5;
export const AUTO_COMPACT_THRESHOLD_MAX = 0.9;

export const defaultUserSettings: UserSettings = {
  autoCompactEnabled: true,
  autoCompactThresholdRatio: AUTO_COMPACT_THRESHOLD_DEFAULT,
  modelSelection: null,
  restoreLastWorkspace: true,
  showEditorLineNumbers: false,
  showNoisyDirectories: false,
  wrapEditorLines: true,
};

const autoCompactThresholdRatioSchema = z
  .number()
  .min(AUTO_COMPACT_THRESHOLD_MIN)
  .max(AUTO_COMPACT_THRESHOLD_MAX);

const persistedSettingsSchema = z.object({
  autoCompactEnabled: z.boolean().optional(),
  autoCompactThresholdRatio: z.number().optional(),
  modelSelection: selectedModelSchema.nullish(),
  restoreLastWorkspace: z.boolean().optional(),
  showEditorLineNumbers: z.boolean().optional(),
  showNoisyDirectories: z.boolean().optional(),
  wrapEditorLines: z.boolean().optional(),
});

function normalizeAutoCompactThresholdRatio(value: unknown): number {
  const parsed = autoCompactThresholdRatioSchema.safeParse(value);
  return parsed.success ? parsed.data : AUTO_COMPACT_THRESHOLD_DEFAULT;
}

export function normalizeUserSettings(
  value: unknown,
  providers: LlmProviderChoice[] = [],
): UserSettings {
  const parsed = persistedSettingsSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ...defaultUserSettings,
      modelSelection: firstAvailableModel(providers),
    };
  }

  const modelSelection = parsed.data.modelSelection ?? firstAvailableModel(providers);

  return {
    autoCompactEnabled: parsed.data.autoCompactEnabled ?? defaultUserSettings.autoCompactEnabled,
    autoCompactThresholdRatio: normalizeAutoCompactThresholdRatio(
      parsed.data.autoCompactThresholdRatio ?? defaultUserSettings.autoCompactThresholdRatio,
    ),
    modelSelection,
    restoreLastWorkspace: parsed.data.restoreLastWorkspace ?? defaultUserSettings.restoreLastWorkspace,
    showEditorLineNumbers:
      parsed.data.showEditorLineNumbers ?? defaultUserSettings.showEditorLineNumbers,
    showNoisyDirectories: parsed.data.showNoisyDirectories ?? defaultUserSettings.showNoisyDirectories,
    wrapEditorLines: parsed.data.wrapEditorLines ?? defaultUserSettings.wrapEditorLines,
  };
}

export function readUserSettings(providers: LlmProviderChoice[] = []): UserSettings {
  try {
    const storedValue =
      window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_USER_SETTINGS_STORAGE_KEY);
    if (!storedValue) {
      return normalizeUserSettings(defaultUserSettings, providers);
    }
    return normalizeUserSettings(JSON.parse(storedValue), providers);
  } catch {
    return normalizeUserSettings(defaultUserSettings, providers);
  }
}

export function writeUserSettings(settings: UserSettings) {
  try {
    window.localStorage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}
