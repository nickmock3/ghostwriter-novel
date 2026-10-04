import { listLlmProfiles, type LlmProfile } from "../features/ai-agent/llmProfiles";
import type { AvailableLlmProvider, LlmProviderId } from "../features/ai-agent/modelProvider";
import type { LlmProviderChoice } from "../features/settings/settingsStorage";

const knownLlmProviderIds = new Set<string>([
  "anthropic",
  "deepseek",
  "gemini",
  "openai",
  "openai-compatible",
]);

export function availableProvidersFromChoices(providers: LlmProviderChoice[]): AvailableLlmProvider[] {
  return providers
    .filter((provider) => knownLlmProviderIds.has(provider.id))
    .map((provider) => ({
      ...provider,
      id: provider.id as LlmProviderId,
    }));
}

export function displayLlmProfiles(
  providers: LlmProviderChoice[],
  userProfiles: LlmProfile[] | undefined,
) {
  return listLlmProfiles({
    providers: availableProvidersFromChoices(providers),
    userProfiles,
  });
}
