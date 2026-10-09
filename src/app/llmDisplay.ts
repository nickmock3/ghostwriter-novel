import { listLlmProfiles, type LlmProfile } from "../features/llm/profiles/llmProfiles";
import type { AvailableLlmProvider, LlmProviderId } from "../features/llm/modelProvider";
import type { LlmProviderChoice } from "../features/llm/selection/llmSelection";

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
