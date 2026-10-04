import { APP_DISPLAY_VERSION } from "../../shared/appVersion";

export function AppInfoSettingsSection() {
  return (
    <section className="settings-section settings-app-info" aria-label="アプリ情報">
      <h3>アプリ情報</h3>
      <p className="settings-app-version">{APP_DISPLAY_VERSION}</p>
    </section>
  );
}
