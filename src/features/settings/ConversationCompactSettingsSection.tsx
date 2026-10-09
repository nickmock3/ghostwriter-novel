import {
  AUTO_COMPACT_THRESHOLD_MAX,
  AUTO_COMPACT_THRESHOLD_MIN,
  type UserSettings,
} from "./settingsStorage";

export type ConversationCompactSettingsSectionProps = {
  onSettingsChange: (settings: UserSettings) => void;
  settings: UserSettings;
};

export function ConversationCompactSettingsSection({
  onSettingsChange,
  settings,
}: ConversationCompactSettingsSectionProps) {
  return (
    <section className="settings-section" aria-label="会話圧縮">
      <h3>会話圧縮</h3>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={settings.autoCompactEnabled}
          onChange={(event) =>
            onSettingsChange({ ...settings, autoCompactEnabled: event.target.checked })
          }
        />
        <span>会話を自動圧縮する</span>
      </label>
      <div className="settings-field">
        <span className="settings-range-label">
          <label htmlFor="auto-compact-threshold">自動圧縮のコンテキスト使用率</label>
          <output htmlFor="auto-compact-threshold">{Math.round(settings.autoCompactThresholdRatio * 100)}%</output>
        </span>
        <input
          id="auto-compact-threshold"
          disabled={!settings.autoCompactEnabled}
          max={Math.round(AUTO_COMPACT_THRESHOLD_MAX * 100)}
          min={Math.round(AUTO_COMPACT_THRESHOLD_MIN * 100)}
          onChange={(event) => {
            const percent = Number.parseInt(event.target.value, 10);
            if (!Number.isFinite(percent)) {
              return;
            }
            onSettingsChange({
              ...settings,
              autoCompactThresholdRatio: percent / 100,
            });
          }}
          step={5}
          type="range"
          value={Math.round(settings.autoCompactThresholdRatio * 100)}
        />
      </div>
    </section>
  );
}
