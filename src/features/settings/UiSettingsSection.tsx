import type { UserSettings } from "./settingsStorage";

export type UiSettingsSectionProps = {
  onSettingsChange: (settings: UserSettings) => void;
  settings: UserSettings;
};

export function UiSettingsSection({
  onSettingsChange,
  settings,
}: UiSettingsSectionProps) {
  return (
    <section className="settings-section">
      <h3>UI</h3>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={settings.wrapEditorLines}
          onChange={(event) =>
            onSettingsChange({ ...settings, wrapEditorLines: event.target.checked })
          }
        />
        <span>エディターの行を折り返す</span>
      </label>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={settings.showEditorLineNumbers}
          onChange={(event) =>
            onSettingsChange({ ...settings, showEditorLineNumbers: event.target.checked })
          }
        />
        <span>エディターに行番号を表示する</span>
      </label>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={settings.showNoisyDirectories}
          onChange={(event) =>
            onSettingsChange({ ...settings, showNoisyDirectories: event.target.checked })
          }
        />
        <span>ノイズディレクトリを表示する</span>
      </label>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={settings.restoreLastWorkspace}
          onChange={(event) =>
            onSettingsChange({ ...settings, restoreLastWorkspace: event.target.checked })
          }
        />
        <span>最後に開いたワークスペースを復元する</span>
      </label>
    </section>
  );
}
