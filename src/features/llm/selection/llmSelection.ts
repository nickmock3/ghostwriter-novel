import { z } from "zod";

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

export const selectedModelSchema = z.object({
  modelId: z.string().min(1),
  providerId: z.string().min(1),
});

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

export function resolveModelSelection(
  selection: SelectedModel | null,
  providers: LlmProviderChoice[],
): SelectedModel | null {
  return selection ?? firstAvailableModel(providers);
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

