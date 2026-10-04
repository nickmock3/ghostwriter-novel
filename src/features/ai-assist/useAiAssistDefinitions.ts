import { useCallback, useEffect, useState } from "react";
import {
  builtInAiAssists,
  type AiAssistDefinition,
  type AiAssistDefinitionInput,
  type CustomAiAssistDefinition,
} from "./aiAssistContracts";
import {
  deleteAiAssistDefinition,
  fetchAiAssistDefinitions,
  saveAiAssistDefinition,
} from "./aiAssistClient";

export type AiAssistSaveInput = AiAssistDefinitionInput & {
  id?: string;
};

export type UseAiAssistDefinitionsResult = {
  assists: readonly AiAssistDefinition[];
  deleteAssist: (assistId: string) => Promise<void>;
  error: string | null;
  isLoading: boolean;
  reload: () => Promise<void>;
  saveAssist: (input: AiAssistSaveInput) => Promise<CustomAiAssistDefinition>;
};

export type UseAiAssistDefinitionsOptions = {
  enabled?: boolean;
};

function createCustomAssistId(): string {
  return crypto.randomUUID();
}

export function useAiAssistDefinitions(
  options: UseAiAssistDefinitionsOptions = {},
): UseAiAssistDefinitionsResult {
  const enabled = options.enabled ?? true;
  const [assists, setAssists] = useState<readonly AiAssistDefinition[]>(builtInAiAssists);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!enabled) {
      return;
    }

    try {
      const nextAssists = await fetchAiAssistDefinitions();
      setAssists(nextAssists);
      setError(null);
    } catch (loadError) {
      setAssists(builtInAiAssists);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "AIアシスト一覧の読み込みに失敗しました。",
      );
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    setIsLoading(true);
    void reload()
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, reload]);

  const saveAssist = useCallback(
    async (input: AiAssistSaveInput): Promise<CustomAiAssistDefinition> => {
      const assistId = input.id ?? createCustomAssistId();
      const { id: _id, ...definitionInput } = input;
      const saved = await saveAiAssistDefinition({
        assistId,
        input: definitionInput,
      });
      await reload();
      return saved;
    },
    [reload],
  );

  const deleteAssist = useCallback(
    async (assistId: string): Promise<void> => {
      await deleteAiAssistDefinition(assistId);
      await reload();
    },
    [reload],
  );

  return {
    assists,
    deleteAssist,
    error,
    isLoading,
    reload,
    saveAssist,
  };
}
