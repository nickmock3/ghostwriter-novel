import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  llmProfilesResponseSchema,
  readLlmProfileSettings,
  writeLlmProfileSettings,
  type LlmProfileSettings,
} from "./profiles/llmProfileStorage";
import type { LlmProfile } from "./profiles/llmProfiles";
import { normalizeUserSettings, type UserSettings } from "../settings/settingsStorage";
import {
  llmSecretListResponseSchema,
  llmProviderListResponseSchema,
  type LlmSecretStatus,
  type LlmProviderChoice,
} from "./selection/llmSelection";
import { apiFetch } from "../../shared/client/apiTransport";

export function useLlmSettings(
  workspaceRoot: string | null,
  settings: UserSettings,
  setSettings: Dispatch<SetStateAction<UserSettings>>,
) {
  const [llmProviders, setLlmProviders] = useState<LlmProviderChoice[]>([]);
  const [llmProfiles, setLlmProfiles] = useState<
    Array<LlmProfile & { available: boolean; unavailableReason?: string }>
  >([]);
  const [llmProfileSettings, setLlmProfileSettings] = useState<LlmProfileSettings | null>(null);
  const [llmSecrets, setLlmSecrets] = useState<LlmSecretStatus[]>([]);
  const [llmSecretErrors, setLlmSecretErrors] = useState<Record<string, string>>({});
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    if (llmProfileSettings) {
      writeLlmProfileSettings(llmProfileSettings);
    }
  }, [llmProfileSettings]);

  const refreshLlmProviders = useCallback(async () => {
    const response = await apiFetch("/api/llm/providers");
    if (!response.ok) {
      throw new Error("LLMモデル一覧の読み込みに失敗しました。");
    }
    const providers = llmProviderListResponseSchema.parse(await response.json()).providers;
    setLlmProviders(providers);
    setSettings((current) => normalizeUserSettings(current, providers));
    return providers;
  }, [setSettings]);

  const refreshLlmProfiles = useCallback(async (providers: LlmProviderChoice[]) => {
    const response = await apiFetch("/api/llm/profiles");
    if (!response.ok) {
      throw new Error("LLMプロフィール一覧の読み込みに失敗しました。");
    }
    const body = llmProfilesResponseSchema.parse(await response.json());
    setLlmProfiles(body.profiles);
    setLlmProfileSettings(readLlmProfileSettings(providers, body.roleAssignments));
  }, []);

  const refreshLlmSecrets = useCallback(async () => {
    const response = await apiFetch("/api/llm/secrets");
    if (!response.ok) {
      throw new Error("LLM APIキー設定状態の読み込みに失敗しました。");
    }
    setLlmSecrets(llmSecretListResponseSchema.parse(await response.json()).providers);
  }, []);

  const refreshLlmSettings = useCallback(async () => {
    const providers = await refreshLlmProviders();
    await Promise.all([refreshLlmSecrets(), refreshLlmProfiles(providers)]);
  }, [refreshLlmProfiles, refreshLlmProviders, refreshLlmSecrets]);

  useEffect(() => {
    let cancelled = false;
    setLlmProviders([]);
    setLlmProfiles([]);
    setLlmProfileSettings(null);
    setLlmSecrets([]);
    setSettingsError(null);

    if (!workspaceRoot) {
      setSettings((current) => normalizeUserSettings(current, []));
      return;
    }

    refreshLlmSettings()
      .then(() => {
        if (cancelled) {
          return;
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSettingsError(error instanceof Error ? error.message : "LLM設定の読み込みに失敗しました。");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshLlmSettings, setSettings, workspaceRoot]);

  const handleSaveLlmSecret = useCallback(
    async (providerId: string, apiKey: string) => {
      setLlmSecretErrors((current) => ({ ...current, [providerId]: "" }));
      const response = await apiFetch(`/api/llm/secrets/${providerId}`, {
        body: JSON.stringify({ apiKey }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        const message = body?.message ?? "LLM APIキーの保存に失敗しました。";
        setLlmSecretErrors((current) => ({ ...current, [providerId]: message }));
        throw new Error(message);
      }

      await refreshLlmSettings();
    },
    [refreshLlmSettings],
  );

  const handleDeleteLlmSecret = useCallback(
    async (providerId: string) => {
      setLlmSecretErrors((current) => ({ ...current, [providerId]: "" }));
      const response = await apiFetch(`/api/llm/secrets/${providerId}`, { method: "DELETE" });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        const message = body?.message ?? "LLM APIキーの削除に失敗しました。";
        setLlmSecretErrors((current) => ({ ...current, [providerId]: message }));
        throw new Error(message);
      }

      await refreshLlmSettings();
    },
    [refreshLlmSettings],
  );

  return {
    handleDeleteLlmSecret,
    handleSaveLlmSecret,
    llmProfileSettings,
    llmProfiles,
    llmProviders,
    llmSecretErrors,
    llmSecrets,
    refreshLlmSecrets,
    refreshLlmSettings,
    setLlmProfileSettings,
    settingsError,
  };
}
