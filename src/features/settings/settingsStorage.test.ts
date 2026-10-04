import { beforeEach, describe, expect, it } from "vitest";
import {
  LEGACY_USER_SETTINGS_STORAGE_KEY,
  USER_SETTINGS_STORAGE_KEY,
  isLlmSecretProviderId,
  readUserSettings,
  normalizeUserSettings,
  writeUserSettings,
} from "./settingsStorage";

describe("settings storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("writes user settings to the Ghostwriter localStorage key", () => {
    writeUserSettings({
      autoCompactEnabled: false,
      autoCompactThresholdRatio: 0.8,
      modelSelection: null,
      restoreLastWorkspace: false,
      showEditorLineNumbers: true,
      showNoisyDirectories: true,
      wrapEditorLines: false,
    });

    expect(localStorage.getItem(USER_SETTINGS_STORAGE_KEY)).toContain('"restoreLastWorkspace":false');
    expect(localStorage.getItem(USER_SETTINGS_STORAGE_KEY)).toContain('"showEditorLineNumbers":true');
    expect(localStorage.getItem(USER_SETTINGS_STORAGE_KEY)).toContain('"autoCompactEnabled":false');
    expect(localStorage.getItem(USER_SETTINGS_STORAGE_KEY)).toContain('"autoCompactThresholdRatio":0.8');
    expect(localStorage.getItem(LEGACY_USER_SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it("defaults automatic compaction to enabled at 70 percent when settings are missing", () => {
    expect(readUserSettings()).toMatchObject({
      autoCompactEnabled: true,
      autoCompactThresholdRatio: 0.7,
    });
  });

  it("normalizes automatic compaction threshold to the safe range", () => {
    localStorage.setItem(
      USER_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        autoCompactEnabled: false,
        autoCompactThresholdRatio: 0.98,
      }),
    );

    expect(readUserSettings()).toMatchObject({
      autoCompactEnabled: false,
      autoCompactThresholdRatio: 0.7,
    });
  });

  it("reads legacy user settings when the Ghostwriter key is missing", () => {
    localStorage.setItem(
      LEGACY_USER_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        restoreLastWorkspace: false,
        showNoisyDirectories: true,
        wrapEditorLines: false,
      }),
    );

    expect(readUserSettings()).toMatchObject({
      restoreLastWorkspace: false,
      showEditorLineNumbers: false,
      showNoisyDirectories: true,
      wrapEditorLines: false,
    });
  });

  it("prefers Ghostwriter user settings over legacy user settings", () => {
    localStorage.setItem(
      LEGACY_USER_SETTINGS_STORAGE_KEY,
      JSON.stringify({ restoreLastWorkspace: false, showNoisyDirectories: true, wrapEditorLines: false }),
    );
    localStorage.setItem(
      USER_SETTINGS_STORAGE_KEY,
      JSON.stringify({ restoreLastWorkspace: true, showNoisyDirectories: false, wrapEditorLines: true }),
    );

    expect(readUserSettings()).toMatchObject({
      restoreLastWorkspace: true,
      showEditorLineNumbers: false,
      showNoisyDirectories: false,
      wrapEditorLines: true,
    });
  });

  it("defaults editor line numbers to hidden when the setting is missing", () => {
    localStorage.setItem(
      USER_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        restoreLastWorkspace: true,
        showNoisyDirectories: false,
        wrapEditorLines: true,
      }),
    );

    expect(readUserSettings()).toMatchObject({
      showEditorLineNumbers: false,
    });
  });

  it("narrows known LLM secret provider ids without casting", () => {
    expect(isLlmSecretProviderId("openai")).toBe(true);
    expect(isLlmSecretProviderId("anthropic")).toBe(true);
    expect(isLlmSecretProviderId("unknown-provider")).toBe(false);
  });
});

it("サインアウト後もSIWC選択をAPIキー接続へ自動変更しない", () => {
  const selected = { providerId: "openai-chatgpt", modelId: "test-model" };
  expect(normalizeUserSettings({ modelSelection: selected }, [{ id: "openai", displayName: "OpenAI", models: [{ id: "api-model", displayName: "API", supportsTools: true, available: true }] }]).modelSelection).toEqual(selected);
});

it("preserves an explicit API model while the catalog is loading", () => {
  expect(normalizeUserSettings({ modelSelection: { providerId: "openai", modelId: "saved-model" } }, []).modelSelection)
    .toEqual({ providerId: "openai", modelId: "saved-model" });
});
