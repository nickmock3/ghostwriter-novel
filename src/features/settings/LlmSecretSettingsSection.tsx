import { useId, useMemo, useState } from "react";
import {
  isLlmSecretProviderId,
  type LlmProviderChoice,
  type LlmSecretProviderId,
  type LlmSecretStatus,
} from "../llm/selection/llmSelection";

export type LlmSecretSettingsSectionProps = {
  llmProviders: LlmProviderChoice[];
  llmSecretErrors?: Partial<Record<LlmSecretProviderId, string | null | undefined>>;
  llmSecrets?: LlmSecretStatus[];
  onDeleteLlmSecret?: (providerId: LlmSecretProviderId) => Promise<void> | void;
  onSaveLlmSecret?: (providerId: LlmSecretProviderId, apiKey: string) => Promise<void> | void;
};

type DraftState = Partial<Record<LlmSecretProviderId, string>>;
type ErrorState = Partial<Record<LlmSecretProviderId, string | null>>;

const missingStatus = {
  canDelete: false,
  canUpdate: true,
  isConfigured: false,
  source: "missing" as const,
};

function getSecretStatus(
  statusesByProvider: Partial<Record<LlmSecretProviderId, LlmSecretStatus>>,
  providerId: LlmSecretProviderId,
): LlmSecretStatus {
  return statusesByProvider[providerId] ?? {
    ...missingStatus,
    providerId,
  };
}

function secretStatusText(providerName: string, status: LlmSecretStatus) {
  const suffix = status.maskedSuffix ? ` (末尾 ${status.maskedSuffix})` : "";

  if (status.source === "env") {
    return `${providerName}: 環境変数で設定済み${suffix}`;
  }

  if (status.source === "system") {
    return `${providerName}: アプリに保存済み${suffix}`;
  }

  return `${providerName}: 未設定`;
}

function secretStatusNote(status: LlmSecretStatus) {
  if (status.source === "env") {
    return "環境変数が優先されるため、アプリから変更できません。";
  }

  if (!status.canUpdate && !status.isConfigured) {
    return "この環境ではOS資格情報ストアに保存できません。";
  }

  if (status.source === "system") {
    return "OS資格情報ストアに保存されています。";
  }

  return "まだ設定されていません。";
}

function indexSecretStatuses(
  statuses: LlmSecretStatus[],
): Partial<Record<LlmSecretProviderId, LlmSecretStatus>> {
  const result: Partial<Record<LlmSecretProviderId, LlmSecretStatus>> = {};
  for (const status of statuses) {
    result[status.providerId] = status;
  }
  return result;
}

export function LlmSecretSettingsSection({
  llmProviders,
  llmSecretErrors,
  llmSecrets,
  onDeleteLlmSecret,
  onSaveLlmSecret,
}: LlmSecretSettingsSectionProps) {
  const [drafts, setDrafts] = useState<DraftState>({});
  const [actionErrors, setActionErrors] = useState<ErrorState>({});
  const [pendingProviderId, setPendingProviderId] = useState<LlmSecretProviderId | null>(null);
  const [apiKeySettingsExpanded, setApiKeySettingsExpanded] = useState(false);
  const apiKeySettingsId = useId();

  const secretStatuses = llmSecrets ?? [];
  const statusesByProvider = useMemo(
    () => indexSecretStatuses(secretStatuses),
    [secretStatuses],
  );

  const secretProviders = llmProviders.filter(
    (provider): provider is LlmProviderChoice & { id: LlmSecretProviderId } =>
      isLlmSecretProviderId(provider.id),
  );

  async function handleSave(providerId: LlmSecretProviderId) {
    const apiKey = drafts[providerId] ?? "";
    if (!apiKey || !onSaveLlmSecret) {
      return;
    }

    setPendingProviderId(providerId);
    setActionErrors((current) => ({ ...current, [providerId]: null }));

    try {
      await onSaveLlmSecret(providerId, apiKey);
      setDrafts((current) => ({ ...current, [providerId]: "" }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "APIキーの保存に失敗しました。";
      setActionErrors((current) => ({ ...current, [providerId]: message }));
    } finally {
      setPendingProviderId((current) => (current === providerId ? null : current));
    }
  }

  async function handleDelete(providerId: LlmSecretProviderId) {
    if (!onDeleteLlmSecret) {
      return;
    }

    setPendingProviderId(providerId);
    setActionErrors((current) => ({ ...current, [providerId]: null }));

    try {
      await onDeleteLlmSecret(providerId);
      setDrafts((current) => ({ ...current, [providerId]: "" }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "APIキーの削除に失敗しました。";
      setActionErrors((current) => ({ ...current, [providerId]: message }));
    } finally {
      setPendingProviderId((current) => (current === providerId ? null : current));
    }
  }

  return (
    <section className="settings-section" aria-label="APIキー" role="region">
      <h3>APIキー</h3>
      {llmProviders.length === 0 ? <p>利用可能なproviderがありません。</p> : null}
      <button
        type="button"
        aria-controls={apiKeySettingsId}
        aria-expanded={apiKeySettingsExpanded}
        onClick={() => setApiKeySettingsExpanded((current) => !current)}
      >
        {apiKeySettingsExpanded ? "APIキー設定を隠す" : "APIキー設定を表示"}
      </button>
      {apiKeySettingsExpanded ? (
        <div className="settings-provider-list" id={apiKeySettingsId}>
          {secretProviders.map((provider) => {
            const providerId = provider.id;
            const status = getSecretStatus(statusesByProvider, providerId);
            const draftValue = drafts[providerId] ?? "";
            const isPending = pendingProviderId === providerId;
            const canUpdate = status.canUpdate && status.source !== "env" && Boolean(onSaveLlmSecret);
            const canDelete = status.canDelete && status.source !== "env" && Boolean(onDeleteLlmSecret);
            const providerError = actionErrors[providerId] ?? llmSecretErrors?.[providerId] ?? null;

            return (
              <article
                aria-label={`${provider.displayName} APIキー設定`}
                className="settings-provider-card"
                key={providerId}
              >
                <div className="settings-provider-header">
                  <h4>{provider.displayName}</h4>
                  <p>{secretStatusText(provider.displayName, status)}</p>
                </div>

                <p>{secretStatusNote(status)}</p>

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSave(providerId);
                  }}
                >
                  <label className="settings-field">
                    <span>{provider.displayName} APIキー</span>
                    <input
                      aria-label={`${provider.displayName} APIキー`}
                      autoComplete="off"
                      disabled={!canUpdate || isPending}
                      onChange={(event) => {
                        const value = event.target.value;
                        setDrafts((current) => ({ ...current, [providerId]: value }));
                        setActionErrors((current) => ({ ...current, [providerId]: null }));
                      }}
                      spellCheck={false}
                      type="password"
                      value={draftValue}
                    />
                  </label>

                  <div className="settings-provider-actions">
                    <button
                      type="submit"
                      disabled={!canUpdate || isPending || draftValue.length === 0}
                    >
                      {provider.displayName} APIキーを保存
                    </button>
                    <button
                      type="button"
                      disabled={!canDelete || isPending}
                      onClick={() => {
                        void handleDelete(providerId);
                      }}
                    >
                      {provider.displayName} APIキーを削除
                    </button>
                  </div>
                </form>

                {providerError ? (
                  <p className="pane-error" role="alert">
                    {providerError}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
