import { z } from "zod";
import {
  llmProfileRoleAssignmentsSchema,
  llmProfileSchema,
  normalizeRoleAssignments,
  type LlmProfile,
  type LlmProfileRoleAssignments,
} from "./llmProfiles";
import type { AvailableLlmProvider, LlmProviderId } from "./modelProvider";
import type { LlmProviderChoice } from "./llmSelection";

export const LLM_PROFILE_SETTINGS_STORAGE_KEY = "ghostwriter:llm-profile-settings:v1";
export const LEGACY_LLM_PROFILE_SETTINGS_STORAGE_KEY =
  "simple-ai-agent:llm-profile-settings:v1";

export const llmProfilesResponseSchema = z.object({
  profiles: z.array(
    llmProfileSchema.extend({
      available: z.boolean(),
      unavailableReason: z.string().optional(),
    }),
  ),
  roleAssignments: llmProfileRoleAssignmentsSchema,
});

export type LlmProfileSettings = {
  roleAssignments: LlmProfileRoleAssignments;
  userProfiles: LlmProfile[];
};

const persistedLlmProfileSettingsSchema = z.object({
  roleAssignments: llmProfileRoleAssignmentsSchema.optional(),
  userProfiles: z.array(llmProfileSchema).optional(),
});

const knownProviderIds = new Set<string>([
  "anthropic",
  "deepseek",
  "gemini",
  "openai",
  "openai-compatible",
]);

function toAvailableLlmProviders(providers: LlmProviderChoice[]): AvailableLlmProvider[] {
  return providers
    .filter((provider) => knownProviderIds.has(provider.id))
    .map((provider) => ({
      ...provider,
      id: provider.id as LlmProviderId,
    }));
}

export function normalizeLlmProfileSettings(
  value: unknown,
  providers: LlmProviderChoice[],
  defaultAssignments: LlmProfileRoleAssignments,
): LlmProfileSettings {
  const parsed = persistedLlmProfileSettingsSchema.safeParse(value);
  const userProfiles = parsed.success ? parsed.data.userProfiles ?? [] : [];
  const availableProviders = toAvailableLlmProviders(providers);
  return {
    roleAssignments: normalizeRoleAssignments({
      assignments: parsed.success ? parsed.data.roleAssignments ?? defaultAssignments : defaultAssignments,
      providers: availableProviders,
      userProfiles,
    }),
    userProfiles,
  };
}

export function readLlmProfileSettings(
  providers: LlmProviderChoice[],
  defaultAssignments: LlmProfileRoleAssignments,
): LlmProfileSettings {
  try {
    const storedValue =
      window.localStorage.getItem(LLM_PROFILE_SETTINGS_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_LLM_PROFILE_SETTINGS_STORAGE_KEY);
    if (!storedValue) {
      return normalizeLlmProfileSettings({ roleAssignments: defaultAssignments }, providers, defaultAssignments);
    }
    return normalizeLlmProfileSettings(JSON.parse(storedValue), providers, defaultAssignments);
  } catch {
    return normalizeLlmProfileSettings({ roleAssignments: defaultAssignments }, providers, defaultAssignments);
  }
}

export function writeLlmProfileSettings(settings: LlmProfileSettings) {
  try {
    window.localStorage.setItem(LLM_PROFILE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}
