import { SiwcSettingsSection } from "../siwc/SiwcSettingsSection";
import type { UserSettings } from "./settingsStorage";
import type {
  LlmProviderChoice,
  LlmSecretProviderId,
  LlmSecretStatus,
} from "../ai-agent/llmSelection";
import { AppInfoSettingsSection } from "./AppInfoSettingsSection";
import { ConversationCompactSettingsSection } from "./ConversationCompactSettingsSection";
import { LlmSecretSettingsSection } from "./LlmSecretSettingsSection";
import { UiSettingsSection } from "./UiSettingsSection";

type SettingsPageProps = {
  onSiwcChanged?: () => Promise<void>;
  errorMessage: string | null;
  isWorkspaceOpen: boolean;
  llmProviders: LlmProviderChoice[];
  llmSecretErrors?: Partial<Record<LlmSecretProviderId, string | null | undefined>>;
  llmSecrets?: LlmSecretStatus[];
  onDeleteLlmSecret?: (providerId: LlmSecretProviderId) => Promise<void> | void;
  onSaveLlmSecret?: (providerId: LlmSecretProviderId, apiKey: string) => Promise<void> | void;
  onSettingsChange: (settings: UserSettings) => void;
  settings: UserSettings;
};

export function SettingsPage({
  onSiwcChanged,
  errorMessage,
  llmProviders,
  llmSecretErrors,
  llmSecrets,
  onDeleteLlmSecret,
  onSaveLlmSecret,
  onSettingsChange,
  settings,
}: SettingsPageProps) {
  return (
    <section aria-label="設定" className="settings-page">
      <div className="settings-page-inner">
        <div className="settings-page-heading">
          <h2>設定</h2>
        </div>

        {errorMessage ? (
          <p className="pane-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <SiwcSettingsSection onChanged={onSiwcChanged} />

        {llmProviders.some(provider => provider.id === "openai-chatgpt") ? <h3>その他の接続方法</h3> : null}
        <LlmSecretSettingsSection
          llmProviders={llmProviders}
          llmSecretErrors={llmSecretErrors}
          llmSecrets={llmSecrets}
          onDeleteLlmSecret={onDeleteLlmSecret}
          onSaveLlmSecret={onSaveLlmSecret}
        />

        <ConversationCompactSettingsSection
          onSettingsChange={onSettingsChange}
          settings={settings}
        />

        <UiSettingsSection onSettingsChange={onSettingsChange} settings={settings} />

        <AppInfoSettingsSection />
      </div>
    </section>
  );
}
