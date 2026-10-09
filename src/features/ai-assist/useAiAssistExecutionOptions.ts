import { useEffect, useState } from "react";
import type { LlmProfileSettings } from "../ai-agent/llmProfileStorage";
import { resolveLlmProfileForRole } from "../ai-agent/llmProfiles";
import type { AvailableLlmProvider } from "../ai-agent/modelProvider";
import type { LlmProfileWithAvailability } from "../ai-agent/llmModelSelection";
import type { AiAssistExecutionOption } from "./aiAssistContracts";

export type UseAiAssistExecutionOptionsInput = {
  llmProfileSettings: LlmProfileSettings | null | undefined;
  llmProfiles: LlmProfileWithAvailability[];
  llmProviders: AvailableLlmProvider[];
};

export type UseAiAssistExecutionOptionsResult = {
  executionOptions: AiAssistExecutionOption[];
  isLoading: boolean;
};

function resolveStandardExecutionOption(input: UseAiAssistExecutionOptionsInput): AiAssistExecutionOption | null {
  if (!input.llmProfileSettings) {
    return null;
  }

  try {
    resolveLlmProfileForRole({
      assignments: input.llmProfileSettings.roleAssignments,
      providers: input.llmProviders,
      role: "writing",
      userProfiles: input.llmProfileSettings.userProfiles,
    });
    return {
      id: "standard",
      label: "APIキー接続",
      runtime: "vercel-ai",
    };
  } catch {
    return null;
  }
}

export function useAiAssistExecutionOptions(
  input: UseAiAssistExecutionOptionsInput,
): UseAiAssistExecutionOptionsResult {
  const [executionOptions, setExecutionOptions] = useState<AiAssistExecutionOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      setIsLoading(true);
      let options: AiAssistExecutionOption[] = [];

      try {
        if (input.llmProviders.some(provider => provider.id === "openai-chatgpt")) {
          options.push({ id: "chatgpt", label: "ChatGPTプラン", runtime: "vercel-ai" });
          options.push({ id: "standard", label: "APIキー接続", runtime: "vercel-ai" });
        }
        const standardOption = resolveStandardExecutionOption(input);
        if (standardOption && !options.some(option => option.id === "standard")) {
          options.push(standardOption);
        }

      } catch {
        options = [];
      } finally {
        if (!cancelled) {
          setExecutionOptions(options);
          setIsLoading(false);
        }
      }
    }

    void loadOptions();

    return () => {
      cancelled = true;
    };
  }, [
    input.llmProfileSettings,
    input.llmProfiles,
    input.llmProviders,
  ]);

  return { executionOptions, isLoading };
}
