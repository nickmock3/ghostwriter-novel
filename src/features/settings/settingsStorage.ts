import { z } from "zod";

export const USER_SETTINGS_STORAGE_KEY = "ghostwriter:user-settings:v1";
export const LEGACY_USER_SETTINGS_STORAGE_KEY = "simple-ai-agent:user-settings:v1";

export type SelectedModel = {
  modelId: string;
  providerId: string;
};

export const llmSecretProviderIds = [
  "anthropic",
  "deepseek",
  "gemini",
  "openai",
  "openai-compatible",
] as const;

export type LlmSecretProviderId = (typeof llmSecretProviderIds)[number];

export function isLlmSecretProviderId(value: string): value is LlmSecretProviderId {
  return (llmSecretProviderIds as readonly string[]).includes(value);
}

export type LlmSecretStatus = {
  canDelete: boolean;
  canUpdate: boolean;
  isConfigured: boolean;
  maskedSuffix?: string;
  providerId: LlmSecretProviderId;
  source: "env" | "missing" | "system";
};

export const llmSecretStatusSchema = z.object({
  canDelete: z.boolean(),
  canUpdate: z.boolean(),
  isConfigured: z.boolean(),
  maskedSuffix: z.string().optional(),
  providerId: z.enum(llmSecretProviderIds),
  source: z.enum(["env", "missing", "system"]),
});

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

const selectedModelSchema = z.object({
  modelId: z.string().min(1),
  providerId: z.string().min(1),
});

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

export type LlmModelChoice = {
  available: boolean;
  displayName: string;
  id: string;
  supportsTools: boolean;
  unavailableReason?: string;
};

export type LlmProviderChoice = {
  displayName: string;
  id: string;
  models: LlmModelChoice[];
};

export const llmProviderListResponseSchema = z.object({
  providers: z.array(
    z.object({
      displayName: z.string(),
      id: z.string(),
      models: z.array(
        z.object({
          available: z.boolean(),
          displayName: z.string(),
          id: z.string(),
          supportsTools: z.boolean(),
          unavailableReason: z.string().optional(),
        }),
      ),
    }),
  ),
});

export const llmSecretStatusesResponseSchema = z.object({
  providers: z.array(llmSecretStatusSchema),
});

export const llmSecretListResponseSchema = llmSecretStatusesResponseSchema;

export function modelSelectionValue(modelSelection: SelectedModel | null) {
  return modelSelection ? `${modelSelection.providerId}:${modelSelection.modelId}` : "";
}

export function modelSelectionFromValue(value: string): SelectedModel | null {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return null;
  }
  return {
    modelId: value.slice(separatorIndex + 1),
    providerId: value.slice(0, separatorIndex),
  };
}

export function firstAvailableModel(providers: LlmProviderChoice[]): SelectedModel | null {
  for (const provider of providers) {
    for (const model of provider.models) {
      if (model.available) {
        return { modelId: model.id, providerId: provider.id };
      }
    }
  }
  return null;
}

export function isModelAvailable(providers: LlmProviderChoice[], modelSelection: SelectedModel | null) {
  if (!modelSelection) {
    return false;
  }
  return providers.some(
    (provider) =>
      provider.id === modelSelection.providerId &&
      provider.models.some((model) => model.id === modelSelection.modelId && model.available),
  );
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
