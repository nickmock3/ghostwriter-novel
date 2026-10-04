import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_DISPLAY_VERSION } from "../../shared/appVersion";
import { SettingsPage } from "./SettingsPage";
import type { LlmProviderChoice, LlmSecretStatus, UserSettings } from "./settingsStorage";

const providers: LlmProviderChoice[] = [
  {
    displayName: "Anthropic",
    id: "anthropic",
    models: [
      {
        available: true,
        displayName: "Claude Sonnet 4.6",
        id: "claude-sonnet-4-6",
        supportsTools: true,
      },
    ],
  },
  {
    displayName: "DeepSeek",
    id: "deepseek",
    models: [
      {
        available: true,
        displayName: "DeepSeek V4 Pro",
        id: "deepseek-v4-pro",
        supportsTools: true,
      },
    ],
  },
  {
    displayName: "Gemini",
    id: "gemini",
    models: [
      {
        available: true,
        displayName: "Gemini 3.1 Flash Lite",
        id: "gemini-3.1-flash-lite",
        supportsTools: true,
      },
    ],
  },
  {
    displayName: "OpenAI",
    id: "openai",
    models: [
      {
        available: true,
        displayName: "GPT 5.4 Mini",
        id: "gpt-5.4-mini",
        supportsTools: true,
      },
    ],
  },
];

const statuses: LlmSecretStatus[] = [
  {
    canDelete: false,
    canUpdate: true,
    isConfigured: false,
    providerId: "anthropic",
    source: "missing",
  },
  {
    canDelete: false,
    canUpdate: true,
    isConfigured: false,
    providerId: "deepseek",
    source: "missing",
  },
  {
    canDelete: true,
    canUpdate: true,
    isConfigured: true,
    maskedSuffix: "cret",
    providerId: "gemini",
    source: "system",
  },
  {
    canDelete: false,
    canUpdate: false,
    isConfigured: true,
    maskedSuffix: "cret",
    providerId: "openai",
    source: "env",
  },
];

const settings: UserSettings = {
  autoCompactEnabled: true,
  autoCompactThresholdRatio: 0.7,
  modelSelection: null,
  restoreLastWorkspace: true,
  showEditorLineNumbers: false,
  showNoisyDirectories: false,
  wrapEditorLines: true,
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("SettingsPage", () => {
  it("shows the current application version in app information", () => {
    render(
      <SettingsPage
        errorMessage={null}
        isWorkspaceOpen
        llmProviders={providers}
        onSettingsChange={vi.fn()}
        settings={settings}
      />,
    );

    expect(screen.getByRole("region", { name: "アプリ情報" })).toHaveTextContent(APP_DISPLAY_VERSION);
  });

  it("updates the editor line number preference", () => {
    const onSettingsChange = vi.fn();

    render(
      <SettingsPage
        errorMessage={null}
        isWorkspaceOpen
        llmProviders={providers}
        onSettingsChange={onSettingsChange}
        settings={settings}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "エディターに行番号を表示する" }));

    expect(onSettingsChange).toHaveBeenCalledWith({
      ...settings,
      showEditorLineNumbers: true,
    });
  });

  it("updates automatic conversation compaction settings", () => {
    const onSettingsChange = vi.fn();

    render(
      <SettingsPage
        errorMessage={null}
        isWorkspaceOpen
        llmProviders={providers}
        onSettingsChange={onSettingsChange}
        settings={settings}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "会話を自動圧縮する" }));
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...settings,
      autoCompactEnabled: false,
    });

    fireEvent.change(screen.getByLabelText("自動圧縮のコンテキスト使用率"), {
      target: { value: "80" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      ...settings,
      autoCompactThresholdRatio: 0.8,
    });
    expect(screen.getByText("コンテキスト使用率 70%")).toBeInTheDocument();
  });

  it("keeps API key inputs collapsed until the user expands them", () => {
    render(
      <SettingsPage
        errorMessage={null}
        isWorkspaceOpen
        llmProviders={providers}
        llmSecrets={statuses}
        onSettingsChange={vi.fn()}
        settings={settings}
      />,
    );

    const disclosure = screen.getByRole("button", { name: "APIキー設定を表示" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Anthropic APIキー")).not.toBeInTheDocument();

    fireEvent.click(disclosure);

    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Anthropic APIキー")).toBeInTheDocument();

    fireEvent.click(disclosure);

    expect(screen.queryByLabelText("Anthropic APIキー")).not.toBeInTheDocument();
  });

  it("renders secret statuses and locks env configured providers", () => {
    render(
      <SettingsPage
        errorMessage={null}
        isWorkspaceOpen
        llmProviders={providers}
        llmSecrets={statuses}
        onSettingsChange={vi.fn()}
        settings={settings}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "APIキー設定を表示" }));

    expect(screen.getByText("DeepSeek: 未設定")).toBeInTheDocument();
    expect(screen.getByText("Anthropic: 未設定")).toBeInTheDocument();
    expect(screen.getByText("Gemini: アプリに保存済み (末尾 cret)")).toBeInTheDocument();
    expect(screen.getByText("OpenAI: 環境変数で設定済み (末尾 cret)")).toBeInTheDocument();
    expect(screen.getByLabelText("OpenAI APIキー")).toBeDisabled();
    expect(screen.getByRole("button", { name: "OpenAI APIキーを保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "OpenAI APIキーを削除" })).toBeDisabled();
    expect(screen.getByText("環境変数が優先されるため、アプリから変更できません。")).toBeInTheDocument();
  });

  it("saves a system secret and clears the input without leaking the body", async () => {
    const onSaveLlmSecret = vi.fn().mockResolvedValue(undefined);

    render(
      <SettingsPage
        errorMessage={null}
        isWorkspaceOpen
        llmProviders={providers}
        llmSecrets={statuses}
        onSaveLlmSecret={onSaveLlmSecret}
        onSettingsChange={vi.fn()}
        settings={settings}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "APIキー設定を表示" }));

    const input = screen.getByLabelText("Anthropic APIキー");
    fireEvent.change(input, { target: { value: "anthropic-secret-value" } });
    await waitFor(() => {
      expect(input).toHaveValue("anthropic-secret-value");
    });
    fireEvent.click(screen.getByRole("button", { name: "Anthropic APIキーを保存" }));

    await waitFor(() => {
      expect(onSaveLlmSecret).toHaveBeenCalledWith("anthropic", "anthropic-secret-value");
    });
    await waitFor(() => {
      expect(input).toHaveValue("");
    });
    expect(screen.queryByDisplayValue("anthropic-secret-value")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("anthropic-secret-value");
    expect(JSON.stringify(localStorage)).not.toContain("anthropic-secret-value");
  });

  it("shows provider errors and calls delete callbacks", async () => {
    const onDeleteLlmSecret = vi.fn().mockResolvedValue(undefined);
    const onSaveLlmSecret = vi.fn().mockRejectedValue(new Error("保存に失敗しました。"));

    render(
      <SettingsPage
        errorMessage={null}
        isWorkspaceOpen
        llmProviders={providers}
        llmSecrets={statuses}
        onDeleteLlmSecret={onDeleteLlmSecret}
        onSaveLlmSecret={onSaveLlmSecret}
        onSettingsChange={vi.fn()}
        settings={settings}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "APIキー設定を表示" }));

    fireEvent.change(screen.getByLabelText("DeepSeek APIキー"), {
      target: { value: "deepseek-secret-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "DeepSeek APIキーを保存" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("保存に失敗しました。");
    });

    fireEvent.click(screen.getByRole("button", { name: "Gemini APIキーを削除" }));

    await waitFor(() => {
      expect(onDeleteLlmSecret).toHaveBeenCalledWith("gemini");
    });
  });
});
