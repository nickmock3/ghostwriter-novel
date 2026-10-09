import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRouter } from "../router";
import { APP_DISPLAY_VERSION } from "../shared/appVersion";
import { defaultUserSettings, USER_SETTINGS_STORAGE_KEY, type UserSettings } from "../features/settings/settingsStorage";
import { IDEA_CONSULT_PROMPT } from "../features/workspace/StartGuideModal";

const useAiAssistDefinitionsMock = vi.hoisted(() =>
  vi.fn(() => ({
    assists: [
      {
        description: "文章表現を改善する編集案を作成します。",
        fixedInstruction: "対象テキストの文章表現を改善する編集案を作成してください。",
        id: "polish",
        isBuiltIn: true,
        name: "推敲",
        resultType: "edit-proposal",
        targetType: "text",
      },
    ],
    deleteAssist: vi.fn(),
    error: null,
    isLoading: false,
    reload: vi.fn(),
    saveAssist: vi.fn(),
  })),
);

vi.mock("../features/workspace/WorkspaceBar", () => ({
  WorkspaceBar: ({
    isRestoring,
    onWorkspaceSelected,
    workspaceRoot,
  }: {
    isRestoring?: boolean;
    onWorkspaceSelected: (workspaceRoot: string) => void;
    workspaceRoot: string | null;
  }) => (
    <div>
      <span>workspace {workspaceRoot ?? "none"}</span>
      {isRestoring ? <span>workspace restoring</span> : null}
      <button type="button" onClick={() => onWorkspaceSelected("/tmp/workspace")}>
        ワークスペースを開く
      </button>
    </div>
  ),
}));

vi.mock("../features/file-tree/FileTreePane", () => ({
  FileTreePane: ({
    collapseControl,
    footer,
    refreshKey,
    showNoisyDirectories,
  }: {
    collapseControl?: ReactNode;
    footer?: ReactNode;
    refreshKey: number;
    showNoisyDirectories?: boolean;
  }) => (
    <aside aria-label="ファイルツリー" className="file-tree-pane">
      <div className="pane-heading">
        <div className="pane-heading-leading">{collapseControl}</div>
        <span>file tree refresh {refreshKey}</span>
        <span>show noisy {showNoisyDirectories ? "yes" : "no"}</span>
        {footer}
      </div>
    </aside>
  ),
}));

vi.mock("../features/editor/EditorPane", () => ({
  EditorPane: ({
    aiAssistPaneRestoreControl,
    fileTreeRestoreControl,
    selectedPath,
    showLineNumbers,
    wrapLines,
  }: {
    aiAssistPaneRestoreControl?: ReactNode;
    fileTreeRestoreControl?: ReactNode;
    selectedPath?: string | null;
    showLineNumbers?: boolean;
    wrapLines?: boolean;
  }) => (
    <section aria-label="テキストエディター">
      <div className="editor-tabs">
        <div className="editor-tabs-leading">{fileTreeRestoreControl}</div>
        <span>line numbers {showLineNumbers ? "yes" : "no"}</span>
        <span>wrap lines {wrapLines ? "yes" : "no"}</span>
        <span>selected path {selectedPath ?? "none"}</span>
        <div className="editor-tabs-trailing">{aiAssistPaneRestoreControl}</div>
      </div>
    </section>
  ),
}));

vi.mock("../features/ai-assist/useAiAssistExecutionOptions", () => ({
  useAiAssistExecutionOptions: () => ({
    executionOptions: [{ id: "standard", label: "標準モデル", runtime: "vercel-ai" }],
    isLoading: false,
  }),
}));

vi.mock("../features/ai-assist/useAiAssistDefinitions", () => ({
  useAiAssistDefinitions: useAiAssistDefinitionsMock,
}));

vi.mock("../features/ai-assist/aiAssistClient", () => ({
  applyAiAssistProposal: vi.fn(async (input: { proposal: { operation: string; path: string } }) => ({
    ...input.proposal,
    status: "applied",
  })),
  deleteAiAssistDefinition: vi.fn(),
  executeAiAssist: vi.fn(),
  fetchAiAssistDefinitions: vi.fn(async () => []),
  rejectAiAssistProposal: vi.fn(),
  saveAiAssistDefinition: vi.fn(),
}));

vi.mock("../features/ai-assist/AiAssistPane", () => ({
  AiAssistPane: ({
    onApply,
    paneControls: { paneCollapseControl, paneLayoutResetControl } = {},
  }: {
    onApply?: (proposal: {
      createdAt: string;
      diff: string;
      id: string;
      newText: string;
      oldText: string;
      operation: "create";
      path: string;
      status: "pending";
      title: string;
      updatedAt: string;
    }) => Promise<unknown>;
    paneControls?: {
      paneCollapseControl?: ReactNode;
      paneLayoutResetControl?: ReactNode;
    };
  }) => (
    <aside aria-label="AIアシスト" className="chat-pane ai-assist-pane" role="complementary">
      <div className="pane-heading">
        <h2>AIアシスト</h2>
        <div className="pane-heading-actions">
          {paneLayoutResetControl}
          {paneCollapseControl}
        </div>
      </div>
      <button
        type="button"
        onClick={() =>
          void onApply?.({
            createdAt: "2026-07-14T00:00:00.000Z",
            diff: "diff",
            id: "proposal-create",
            newText: "created",
            oldText: "",
            operation: "create",
            path: "docs/new.md",
            status: "pending",
            title: "Create docs/new.md",
            updatedAt: "2026-07-14T00:00:00.000Z",
          })
        }
      >
        apply create
      </button>
    </aside>
  ),
}));

vi.mock("../features/ai-chat/ChatPane", () => ({
  ChatPane: ({
    fileContext: { workspaceRoot, appendedTextRequest },
    llm: {
      roleAssignments: llmProfileRoleAssignments,
      providers: llmProviders,
      modelSelection,
      onMainLlmModelSelectionChange,
      onMainLlmProfileIdChange,
      onModelSelectionChange,
    } = {},
    editActions: { onAppliedEdit } = {},
    paneControls: { paneCollapseControl, paneLayoutResetControl } = {},
  }: {
    fileContext: {
      workspaceRoot: string | null;
      appendedTextRequest?: { id: number; text: string } | null;
    };
    llm?: {
      providers?: Array<{
        displayName: string;
        id: string;
        models: Array<{ available: boolean; displayName: string; id: string }>;
      }>;
      roleAssignments?: {
        main?: { kind: "model"; modelId: string; providerId: string } | { kind: "profile"; profileId: string };
      } | null;
      modelSelection?: { modelId: string; providerId: string } | null;
      onMainLlmModelSelectionChange?: (modelSelection: { modelId: string; providerId: string } | null) => void;
      onMainLlmProfileIdChange?: (profileId: string | null) => void;
      onModelSelectionChange?: (modelSelection: { modelId: string; providerId: string } | null) => void;
    };
    editActions?: {
      onAppliedEdit?: (proposal: { operation: "create" | "createDirectory" | "edit"; path: string }) => void;
    };
    paneControls?: {
      paneCollapseControl?: ReactNode;
      paneLayoutResetControl?: ReactNode;
    };
  }) => (
    <aside aria-label="AIチャット" className="chat-pane">
      <div className="pane-heading">
        <h2>AI Chat</h2>
        <div className="pane-heading-actions">
          {paneLayoutResetControl}
          {paneCollapseControl}
        </div>
      </div>
      <span>appended text {appendedTextRequest?.text ?? "none"}</span>
      <span>chat workspace {workspaceRoot ?? "none"}</span>
      <span>chat model {modelSelection ? `${modelSelection.providerId}/${modelSelection.modelId}` : "none"}</span>
      <span>
        chat main assignment{" "}
        {llmProfileRoleAssignments?.main?.kind === "profile"
          ? llmProfileRoleAssignments.main.profileId
          : "none"}
      </span>
      <select
        aria-label="mock chat model"
        onChange={(event) => {
          const [providerId, modelId] = event.target.value.split(":");
          if (providerId === "profile") {
            onMainLlmProfileIdChange?.(modelId ?? null);
            onMainLlmModelSelectionChange?.(null);
            onModelSelectionChange?.(null);
            return;
          }

          const nextSelection = providerId && modelId ? { modelId, providerId } : null;
          onMainLlmModelSelectionChange?.(nextSelection);
          onModelSelectionChange?.(nextSelection);
        }}
        value={modelSelection ? `${modelSelection.providerId}:${modelSelection.modelId}` : ""}
      >
        {llmProviders?.flatMap((provider) =>
          provider.models.map((model) => (
            <option disabled={!model.available} key={`${provider.id}:${model.id}`} value={`${provider.id}:${model.id}`}>
              {provider.displayName} / {model.displayName}
            </option>
          )),
        )}
      </select>
      <button
        type="button"
        onClick={() => onAppliedEdit?.({ operation: "create", path: "docs/new.md" })}
      >
        apply create
      </button>
    </aside>
  ),
}));

function providerResponse() {
  return new Response(
    JSON.stringify({
      providers: [
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
        {
          displayName: "Gemini",
          id: "gemini",
          models: [
            {
              available: false,
              displayName: "Gemini 3.1 Flash Lite",
              id: "gemini-3.1-flash-lite",
              supportsTools: true,
              unavailableReason: "Gemini のAPIキーが未設定です。",
            },
          ],
        },
      ],
    }),
    { headers: { "Content-Type": "application/json" }, status: 200 },
  );
}

function secretResponse() {
  return new Response(
    JSON.stringify({
      providers: [
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
      ],
    }),
    { headers: { "Content-Type": "application/json" }, status: 200 },
  );
}

function llmSettingsFetchResponse(input: string | URL | Request) {
  const url = String(input);

  if (url === "/api/llm/secrets") {
    return secretResponse();
  }

  if (url === "/api/llm/profiles") {
    return new Response(
      JSON.stringify({
        profiles: [
          {
            available: true,
            id: "builtin:deepseek:main",
            maxOutputTokens: 4096,
            modelId: "deepseek-v4-pro",
            name: "DeepSeek 通常",
            providerId: "deepseek",
            source: "built-in",
            temperature: 0.3,
          },
          {
            available: true,
            id: "builtin:openai:main",
            maxOutputTokens: 4096,
            modelId: "gpt-5.4-mini",
            name: "OpenAI 通常",
            providerId: "openai",
            source: "built-in",
            temperature: 0.3,
          },
        ],
        roleAssignments: {
          main: "builtin:deepseek:main",
          search: "builtin:deepseek:main",
          simple: "builtin:deepseek:main",
          writing: "builtin:deepseek:main",
        },
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 },
    );
  }

  return providerResponse();
}

function startGuideFetchResponse(options?: {
  existingFiles?: Record<string, string>;
  treeItems?: Array<{ kind: "directory" | "file"; path: string }>;
}) {
  const existingFiles = options?.existingFiles ?? {};
  const treeItems = options?.treeItems ?? [];

  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin);

    if (url.pathname === "/api/files/tree") {
      return new Response(
        JSON.stringify({
          items: treeItems,
          limit: 100,
          truncated: false,
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    }

    if (url.pathname === "/api/files/content" && (!init?.method || init.method === "GET")) {
      const filePath = url.searchParams.get("path") ?? "";
      const content = existingFiles[filePath];
      if (content === undefined) {
        return new Response(JSON.stringify({ message: "not found" }), {
          headers: { "Content-Type": "application/json" },
          status: 404,
        });
      }

      return new Response(JSON.stringify({ content, path: filePath }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    return llmSettingsFetchResponse(input);
  };
}

async function renderApp(initialPath = "/editor") {
  const router = getRouter({
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });

  await act(async () => {
    await router.load();
  });

  return render(<RouterProvider router={router} />);
}

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    useAiAssistDefinitionsMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it.each([null, { providerId: "openai", modelId: "saved-model" }])(
    "fills a missing model after providers load and preserves saved selection %j",
    async (modelSelection) => {
      const saved: UserSettings = { ...defaultUserSettings, modelSelection };
      localStorage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(saved));
      let completeProviders!: (response: Response) => void;
      const providers = new Promise<Response>((resolve) => { completeProviders = resolve; });
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
        String(input) === "/api/llm/providers" ? providers : llmSettingsFetchResponse(input));
      await renderApp("/editor");
      fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));
      expect(JSON.parse(localStorage.getItem(USER_SETTINGS_STORAGE_KEY)!)).toEqual(saved);
      await act(async () => { completeProviders(providerResponse()); });
      await waitFor(() => {
        expect(JSON.parse(localStorage.getItem(USER_SETTINGS_STORAGE_KEY)!)).toEqual({
          ...saved,
          modelSelection: modelSelection ?? { providerId: "anthropic", modelId: "claude-sonnet-4-6" },
        });
      });
    },
  );

  it("preserves all user settings when provider loading fails", async () => {
    const saved: UserSettings = {
      ...defaultUserSettings,
      autoCompactEnabled: false,
      autoCompactThresholdRatio: 0.8,
      restoreLastWorkspace: false,
      showEditorLineNumbers: true,
      showNoisyDirectories: true,
      wrapEditorLines: false,
    };
    localStorage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(saved));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input) === "/api/llm/providers"
        ? new Response(null, { status: 500 }) : llmSettingsFetchResponse(input));
    await renderApp("/editor");
    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));
    fireEvent.click(screen.getByRole("link", { name: "設定ページ" }));
    expect(await screen.findByText("LLMモデル一覧の読み込みに失敗しました。")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(USER_SETTINGS_STORAGE_KEY)!)).toEqual(saved);
  });

  it("renders the three-pane editor shell", async () => {
    await renderApp("/editor");

    expect(screen.getByRole("main", { name: "Ghostwriter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ワークスペースを開く" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "ファイルツリー" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "テキストエディター" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "AIアシスト" })).toBeInTheDocument();
    expect(useAiAssistDefinitionsMock).toHaveBeenCalledWith();
  });

  it("renders a full-screen chat mode without editor panes and shares the workspace chat context", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => llmSettingsFetchResponse(input));
    await renderApp("/chat");

    expect(screen.getByRole("main", { name: "Ghostwriter" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "チャットモード" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getAllByRole("button", { name: "ワークスペースを開く" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("region", { name: "チャットモード" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "チャットモードを始める" })).toHaveTextContent(
      "ワークスペースを開くとAIチャットを始められます。",
    );
    expect(screen.getByRole("region", { name: "チャットモードを始める" })).toHaveTextContent(
      "原稿、設定、プロットを置いたフォルダを選ぶと、AIに相談しながら小説を書き進められます。",
    );
    expect(screen.queryByRole("complementary", { name: "AIアシスト" })).not.toBeInTheDocument();
    expect(screen.queryByText("chat workspace none")).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "ファイルツリー" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "テキストエディター" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "小説ワークスペースを準備する" })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "ワークスペースを開く" })[0]);

    await waitFor(() => {
      expect(screen.getByText("workspace /tmp/workspace")).toBeInTheDocument();
    });
    expect(screen.getByText("chat workspace /tmp/workspace")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "エディット画面" }));

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "エディターワークスペース" })).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "エディット画面" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("workspace /tmp/workspace")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "ファイルツリー" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "テキストエディター" })).toBeInTheDocument();
  });

  it("renders reader mode with numbered chapters, chapter paging, and copy action", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input), window.location.origin);

      if (url.pathname === "/api/files/tree") {
        return new Response(
          JSON.stringify({
            items: [
              { kind: "directory", path: "小説/第010章" },
              { kind: "file", path: "小説/第010章/本文.txt" },
              { kind: "directory", path: "小説/第001章" },
              { kind: "file", path: "小説/第001章/本文.txt" },
              { kind: "directory", path: "小説/第002章" },
              { kind: "file", path: "小説/第002章/本文.txt" },
            ],
            limit: 100,
            truncated: false,
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }

      if (url.pathname === "/api/files/content") {
        const path = url.searchParams.get("path");
        const contentByPath: Record<string, string> = {
          "小説/第001章/本文.txt":
            "\n第一章　星の港\n本文1\n｜山田太郎《やまだたろう》と|etc《えとせとら》と山田太郎《やまだたろう》\nこれは《《重要》》です。",
          "小説/第002章/本文.txt": "\n第二章　霧の街\n本文2",
          "小説/第010章/本文.txt": "   \n\t\n",
        };
        return new Response(JSON.stringify({ content: contentByPath[path ?? ""] ?? "", path }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }

      return llmSettingsFetchResponse(input);
    });

    const { unmount } = await renderApp("/chat");

    fireEvent.click(screen.getAllByRole("button", { name: "ワークスペースを開く" })[0]);
    await waitFor(() => {
      expect(localStorage.getItem("ghostwriter:last-work-mode:/tmp/workspace")).toBe("chat");
    });

    fireEvent.click(screen.getByRole("link", { name: "リーダーモード" }));

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "リーダーモード" })).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "リーダーモード" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("button", { name: "ワークスペースを開く" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "第一章　星の港" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "第二章　霧の街" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "第010章" })).toBeInTheDocument();
    expect(screen.getByText("本文1")).toBeInTheDocument();
    const manuscript = document.querySelector(".reader-mode-manuscript-inner");
    expect(manuscript?.querySelectorAll("ruby")).toHaveLength(3);
    expect(manuscript?.querySelector("ruby rt")).toHaveTextContent("やまだたろう");
    expect(manuscript?.querySelector(".reader-mode-emphasis")).toHaveTextContent("重要");
    expect(localStorage.getItem("ghostwriter:last-work-mode:/tmp/workspace")).toBe("chat");

    fireEvent.click(screen.getAllByRole("button", { name: "次の章" })[0]);
    await waitFor(() => {
      expect(screen.getByText("本文2")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "本文をコピー" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("\n第二章　霧の街\n本文2");
    });
    unmount();
  });

  it("shows reader mode guidance when no workspace or no readable chapters are available", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input), window.location.origin);

      if (url.pathname === "/api/files/tree") {
        return new Response(
          JSON.stringify({ items: [], limit: 100, truncated: false }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }

      return llmSettingsFetchResponse(input);
    });

    await renderApp("/reader");

    expect(screen.getByRole("region", { name: "リーダーモード" })).toHaveTextContent(
      "ワークスペースが開かれていません。",
    );
    expect(screen.getByRole("link", { name: "チャットモードへ移動" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "エディット画面へ移動" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "チャットモードへ移動" }));
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "チャットモード" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByRole("button", { name: "ワークスペースを開く" })[0]);
    await waitFor(() => {
      expect(screen.getByText("workspace /tmp/workspace")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("link", { name: "リーダーモード" }));
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "リーダーモード" })).toHaveTextContent(
        "まだ読める本文がありません。",
      );
    });
  });

  it("routes / to chat mode when no last work mode is stored", async () => {
    await renderApp("/");

    expect(screen.getByRole("link", { name: "チャットモード" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("region", { name: "チャットモード" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "エディターワークスペース" })).not.toBeInTheDocument();
  });

  it("routes / to the stored last work mode for the previous workspace", async () => {
    localStorage.setItem("ghostwriter:last-workspace-root", "/tmp/stored-workspace");
    localStorage.setItem("ghostwriter:last-work-mode:/tmp/stored-workspace", "editor");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ workspaceRoot: "/tmp/stored-workspace" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );

    await renderApp("/");

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "エディット画面" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });
    expect(await screen.findByRole("region", { name: "エディターワークスペース" })).toBeInTheDocument();
  });

  it("routes / to chat mode when the stored work mode value is invalid", async () => {
    localStorage.setItem("ghostwriter:last-workspace-root", "/tmp/stored-workspace");
    localStorage.setItem("ghostwriter:last-work-mode:/tmp/stored-workspace", "reader");

    await renderApp("/");

    expect(screen.getByRole("link", { name: "チャットモード" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("region", { name: "チャットモード" })).toBeInTheDocument();
  });

  it("records the last work mode only for chat and editor pages", async () => {
    const { unmount } = await renderApp("/chat");

    fireEvent.click(screen.getAllByRole("button", { name: "ワークスペースを開く" })[0]);

    await waitFor(() => {
      expect(localStorage.getItem("ghostwriter:last-work-mode:/tmp/workspace")).toBe("chat");
    });

    fireEvent.click(screen.getByRole("link", { name: "設定ページ" }));
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "設定" })).toBeInTheDocument();
    });
    expect(localStorage.getItem("ghostwriter:last-work-mode:/tmp/workspace")).toBe("chat");
    unmount();

    await renderApp("/editor");

    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));

    await waitFor(() => {
      expect(localStorage.getItem("ghostwriter:last-work-mode:/tmp/workspace")).toBe("editor");
    });
  });

  it("shows a blocking first-run workspace modal before the editor can be used", async () => {
    await renderApp("/editor");

    const dialog = screen.getByRole("dialog", { name: "小説ワークスペースを準備する" });
    expect(dialog).toHaveTextContent("Ghostwriterへようこそ。");
    expect(dialog).toHaveTextContent(
      "まず、小説を書くための作業フォルダを準備しましょう。",
    );
    expect(dialog).toHaveTextContent(
      "このアプリでは、小説ごとに1つのフォルダを作業場所として使い、原稿、設定、プロット、メモをまとめて保存できます。",
    );
    expect(dialog).toHaveTextContent(
      "初めて使う場合は、新しいフォルダを作って標準テンプレートで始めるのがおすすめです。",
    );
    expect(dialog).toHaveTextContent(
      "すでに原稿フォルダがある場合は、そのフォルダを開いてください。",
    );
    expect(dialog).not.toHaveTextContent(/閉じる|キャンセル|あとで設定/);
    expect(screen.getByRole("button", { name: "新しい小説ワークスペースを作成" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "既存のフォルダを開く" })).toBeInTheDocument();
    expect(document.querySelector(".app-sidebar")).toHaveAttribute("data-workspace-blocked", "true");
    expect(document.querySelector(".app-main-area")).toHaveAttribute("data-workspace-blocked", "true");
  });

  it("opens an empty new workspace without applying a template or showing the start guide", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input), window.location.origin);

      if (url.pathname === "/api/workspace/templates") {
        return new Response(JSON.stringify({ templates: [] }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }

      if (url.pathname === "/api/workspace/select" && init?.method === "POST") {
        return new Response(JSON.stringify({ workspaceRoot: "/tmp/empty-new-workspace" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }

      if (url.pathname === "/api/files/tree") {
        return new Response(
          JSON.stringify({
            items: [],
            limit: 100,
            truncated: false,
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }

      return llmSettingsFetchResponse(input);
    });

    await renderApp("/editor");

    fireEvent.click(screen.getByRole("button", { name: "新しい小説ワークスペースを作成" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "空のワークスペースで始める" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "空のワークスペースで始める" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "フォルダを選んで作成" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "フォルダを選んで作成" }));

    await waitFor(() => {
      expect(screen.getByText("workspace /tmp/empty-new-workspace")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "何から始めますか？" })).not.toBeInTheDocument();
    });
    expect(fetchSpy).not.toHaveBeenCalledWith("/api/workspace/template", expect.anything());
  });

  it("shows the start guide after creating a workspace with a template even when the tree is no longer nearly empty", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input), window.location.origin);

      if (url.pathname === "/api/workspace/templates") {
        return new Response(
          JSON.stringify({
            templates: [
              {
                id: "built-in/basic-workspace",
                items: [{ content: "# AGENTS.md\n", kind: "file", path: "AGENTS.md" }],
                name: "小説ワークスペース",
                source: "built-in",
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }

      if (url.pathname === "/api/workspace/select" && init?.method === "POST") {
        return new Response(JSON.stringify({ workspaceRoot: "/tmp/template-new-workspace" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }

      if (url.pathname === "/api/workspace/template" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            createdDirectories: ["小説", "設定", "プロット", "資料", "メモ"],
            createdFiles: ["AGENTS.md", "小説/第001章/本文.txt"],
            skippedExisting: [],
            workspaceRoot: "/tmp/template-new-workspace",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }

      if (url.pathname === "/api/files/tree") {
        return new Response(
          JSON.stringify({
            items: Array.from({ length: 20 }, (_, index) => ({
              kind: "file",
              path: `file-${index}.txt`,
            })),
            limit: 100,
            truncated: false,
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }

      return llmSettingsFetchResponse(input);
    });

    await renderApp("/editor");

    fireEvent.click(screen.getByRole("button", { name: "新しい小説ワークスペースを作成" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "フォルダを選んで作成" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "フォルダを選んで作成" }));

    expect(await screen.findByRole("dialog", { name: "何から始めますか？" })).toBeInTheDocument();
  });

  it("keeps the first-run modal open and shows the template error when new workspace templating fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input), window.location.origin);

      if (url.pathname === "/api/workspace/templates") {
        return new Response(
          JSON.stringify({
            templates: [
              {
                id: "built-in/basic-workspace",
                items: [{ content: "# AGENTS.md\n", kind: "file", path: "AGENTS.md" }],
                name: "小説ワークスペース",
                source: "built-in",
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }

      if (url.pathname === "/api/workspace/select" && init?.method === "POST") {
        return new Response(JSON.stringify({ workspaceRoot: "/tmp/colliding-workspace" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }

      if (url.pathname === "/api/workspace/template" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            code: "workspace_selection_failed",
            message: "Template target already exists: AGENTS.md",
          }),
          { headers: { "Content-Type": "application/json" }, status: 409 },
        );
      }

      return llmSettingsFetchResponse(input);
    });

    await renderApp("/editor");

    fireEvent.click(screen.getByRole("button", { name: "新しい小説ワークスペースを作成" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "フォルダを選んで作成" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "フォルダを選んで作成" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Template target already exists: AGENTS.md",
    );
    expect(screen.getByRole("dialog", { name: "新しい小説ワークスペースを作成" })).toBeInTheDocument();
    expect(screen.getByText("workspace none")).toBeInTheDocument();
  });

  it.each([
    ["/editor", "エディターワークスペース", true],
    ["/chat", "チャットモードを始める", true],
    ["/reader", "リーダーモード", false],
  ])("shows a loading state instead of the unselected UI while restoring the workspace on %s", async (
    path,
    readyRegionName,
    hasWorkspaceBar,
  ) => {
    localStorage.setItem("ghostwriter:last-workspace-root", "/tmp/stored-workspace");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      input === "/api/workspace/validate" ? new Promise<Response>(() => {}) : llmSettingsFetchResponse(input));

    await renderApp(path);
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("/api/workspace/validate", expect.anything());
    });

    expect(screen.getByRole("status")).toHaveTextContent("前回のワークスペースを開いています…");
    expect(screen.queryByText("workspace restoring") !== null).toBe(hasWorkspaceBar);
    expect(screen.queryByRole("dialog", { name: "小説ワークスペースを準備する" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: readyRegionName })).not.toBeInTheDocument();
    expect(screen.queryByText("ワークスペースが開かれていません。")).not.toBeInTheDocument();
  });

  it("shows a recovery modal when restoring the previous workspace fails", async () => {
    localStorage.setItem("ghostwriter:last-workspace-root", "/tmp/deleted-workspace");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "workspace_selection_failed",
          message: "spawn osascript ENOENT internal stack",
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 400,
        },
      ),
    );

    await renderApp("/editor");

    const dialog = await screen.findByRole("dialog", { name: "小説ワークスペースを開く" });
    expect(dialog).toHaveClass("first-run-workspace-modal--welcome");
    expect(dialog).toHaveTextContent(
      "前回のワークスペースを開けませんでした。別の場所に移動されたか、削除された可能性があります。",
    );
    expect(dialog).toHaveTextContent("前回の場所: /tmp/deleted-workspace");
    expect(dialog).not.toHaveTextContent(/spawn|osascript|ENOENT|stack/);
    expect(screen.getByRole("button", { name: "既存のフォルダを開く" })).toBeInTheDocument();
  });

  it("saves a selected workspace root to localStorage", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => llmSettingsFetchResponse(input));
    await renderApp("/editor");

    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));

    expect(localStorage.getItem("ghostwriter:last-workspace-root")).toBe("/tmp/workspace");
    expect(screen.getByText("workspace /tmp/workspace")).toBeInTheDocument();
  });

  it("restores a stored workspace root only after server validation succeeds", async () => {
    localStorage.setItem("ghostwriter:last-workspace-root", "/tmp/stored-workspace");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ workspaceRoot: "/private/tmp/stored-workspace" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );

    await renderApp("/editor");

    expect(screen.getByText("workspace none")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("workspace /private/tmp/stored-workspace")).toBeInTheDocument();
    });
    expect(screen.queryByText("前回のワークスペースを開いています…")).not.toBeInTheDocument();
    expect(screen.queryByText("workspace restoring")).not.toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith("/api/workspace/validate", {
      body: JSON.stringify({ workspaceRoot: "/tmp/stored-workspace" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(localStorage.getItem("ghostwriter:last-workspace-root")).toBe(
      "/private/tmp/stored-workspace",
    );
  });

  it.each([200, 400])("keeps a newly selected workspace when stale restoration finishes with HTTP %s", async (status) => {
    localStorage.setItem("ghostwriter:last-workspace-root", "/tmp/stored-workspace");
    let finishValidation!: (response: Response) => void;
    const validation = new Promise<Response>((resolve) => {
      finishValidation = resolve;
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (input === "/api/workspace/validate") {
        return validation;
      }
      return llmSettingsFetchResponse(input);
    });

    await renderApp("/editor");
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("/api/workspace/validate", expect.anything());
    });
    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));

    await act(async () => {
      finishValidation(new Response(JSON.stringify(
        status === 200
          ? { workspaceRoot: "/private/tmp/stored-workspace" }
          : { code: "workspace_selection_failed", message: "missing" },
      ), { headers: { "Content-Type": "application/json" }, status }));
      await validation;
    });

    expect(screen.getByText("workspace /tmp/workspace")).toBeInTheDocument();
    expect(localStorage.getItem("ghostwriter:last-workspace-root")).toBe("/tmp/workspace");
    expect(screen.queryByRole("dialog", { name: "小説ワークスペースを開く" })).not.toBeInTheDocument();
  });

  it("restores legacy workspace keys only when a ghostwriter key is not present", async () => {
    localStorage.setItem("ghostwriter:last-workspace-root", "/tmp/new-workspace");
    localStorage.setItem("simple-ai-agent:last-workspace-root", "/tmp/legacy-workspace");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ workspaceRoot: "/private/tmp/new-workspace" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );

    await renderApp("/editor");

    await waitFor(() => {
      expect(screen.getByText("workspace /private/tmp/new-workspace")).toBeInTheDocument();
    });
    expect(fetchSpy).toHaveBeenCalledWith("/api/workspace/validate", {
      body: JSON.stringify({ workspaceRoot: "/tmp/new-workspace" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  });

  it("removes a stored workspace root when server validation fails", async () => {
    localStorage.setItem("ghostwriter:last-workspace-root", "/tmp/deleted-workspace");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "workspace_selection_failed", message: "missing" }), {
        headers: { "Content-Type": "application/json" },
        status: 400,
      }),
    );

    await renderApp("/editor");

    await waitFor(() => {
      expect(localStorage.getItem("ghostwriter:last-workspace-root")).toBeNull();
    });
    expect(screen.getByText("workspace none")).toBeInTheDocument();
  });

  it("refreshes the file tree after an AI create proposal is applied", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => llmSettingsFetchResponse(input));
    await renderApp("/editor");

    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));
    expect(screen.getByText("file tree refresh 0")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "apply create" }));

    await waitFor(() => {
      expect(screen.getByText("file tree refresh 1")).toBeInTheDocument();
    });
  });

  it("shows a dismissible start guide modal for a nearly empty workspace", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      startGuideFetchResponse({
        treeItems: [{ kind: "file", path: "AGENTS.md" }],
      }),
    );

    await renderApp("/editor");

    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));

    const dialog = await screen.findByRole("dialog", { name: "何から始めますか？" });
    expect(dialog).toHaveTextContent("アイディア相談、プロット作成、本文執筆など、好きなところから始められます。");
    expect(screen.getByRole("button", { name: "アイディアをAIに相談する" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "プロットを作る" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "第1章の本文を書く" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "設定資料を整理する" })).toBeInTheDocument();
    expect(screen.getByText("まだ固まっていない構想を会話しながら広げます")).toBeInTheDocument();
    expect(screen.getByText("全体構成や章立てから整理します")).toBeInTheDocument();
    expect(screen.getByText("第1章の本文ファイルを開いて執筆します")).toBeInTheDocument();
    expect(screen.getByText("登場人物や世界観の資料から土台を作ります")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "開始ガイドを閉じる" }));

    expect(screen.queryByRole("dialog", { name: "何から始めますか？" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "テキストエディター" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "AIアシスト" })).toBeInTheDocument();
  });

  it("does not show the start guide again after it is dismissed for the workspace", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      startGuideFetchResponse({
        treeItems: [],
      }),
    );

    await renderApp("/editor");

    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));
    fireEvent.click(await screen.findByRole("button", { name: "開始ガイドを閉じる" }));
    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "何から始めますか？" })).not.toBeInTheDocument();
    });
    expect(localStorage.getItem("ghostwriter:start-guide-dismissed:/tmp/workspace")).toBe("true");
  });

  it("navigates to chat with an idea prompt without sending it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      startGuideFetchResponse({
        treeItems: [],
      }),
    );

    await renderApp("/editor");

    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));
    fireEvent.click(await screen.findByRole("button", { name: "アイディアをAIに相談する" }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "チャットモード" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });
    expect(screen.getByRole("region", { name: "チャットモード" })).toBeInTheDocument();
    expect(screen.getByText(`appended text ${IDEA_CONSULT_PROMPT}`)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "何から始めますか？" })).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([input]) => String(input).includes("/api/chat/messages"))).toBe(
      false,
    );
  });

  it("opens existing files from the start guide and closes the modal", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      startGuideFetchResponse({
        existingFiles: {
          "プロット/全体構成.md": "plot",
        },
        treeItems: [{ kind: "directory", path: "プロット" }],
      }),
    );

    await renderApp("/editor");

    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));
    fireEvent.click(await screen.findByRole("button", { name: "プロットを作る" }));

    await waitFor(() => {
      expect(screen.getByText("selected path プロット/全体構成.md")).toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog", { name: "何から始めますか？" })).not.toBeInTheDocument();
  });

  it("explains missing start guide files without creating or changing selection", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      startGuideFetchResponse({
        treeItems: [{ kind: "directory", path: "小説" }],
      }),
    );

    await renderApp("/editor");

    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));
    fireEvent.click(await screen.findByRole("button", { name: "第1章の本文を書く" }));

    expect(
      await screen.findByText(
        "標準テンプレートの第1章本文ファイルが見つかりません。ファイルツリーから作成するか、チャットで作成案を相談できます。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("selected path none")).toBeInTheDocument();
  });

  it("does not let a stale direct model selection override a main user profile assignment", async () => {
    localStorage.setItem(
      "ghostwriter:user-settings:v1",
      JSON.stringify({
        modelSelection: { modelId: "deepseek-v4-pro", providerId: "deepseek" },
        restoreLastWorkspace: true,
        showNoisyDirectories: false,
        wrapEditorLines: true,
      }),
    );
    localStorage.setItem(
      "ghostwriter:llm-profile-settings:v1",
      JSON.stringify({
        roleAssignments: {
          main: { kind: "profile", profileId: "user:lm-studio" },
          search: { kind: "profile", profileId: "builtin:deepseek:search" },
          simple: { kind: "profile", profileId: "builtin:deepseek:simple" },
          writing: { kind: "profile", profileId: "builtin:deepseek:writing" },
        },
        userProfiles: [
          {
            available: true,
            baseURL: "http://localhost:1234/v1",
            id: "user:lm-studio",
            maxOutputTokens: 4096,
            modelId: "gemma-3-12b-it",
            name: "LM Studio",
            providerId: "openai-compatible",
            source: "user",
            supportsToolsOverride: true,
            temperature: 0.3,
          },
        ],
      }),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/llm/providers") {
        return new Response(
          JSON.stringify({
            providers: [
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
                displayName: "OpenAI互換",
                id: "openai-compatible",
                models: [
                  {
                    available: false,
                    displayName: "local-model",
                    id: "local-model",
                    supportsTools: false,
                    unavailableReason: "このモデルはツール実行に対応していません。",
                  },
                ],
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }
      return llmSettingsFetchResponse(input);
    });

    await renderApp("/editor");
    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));

    fireEvent.click(screen.getByRole("link", { name: "チャットモード" }));

    await waitFor(() => {
      expect(screen.getByText("chat main assignment user:lm-studio")).toBeInTheDocument();
    });
    expect(screen.getByText("chat model none")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("mock chat model"), {
      target: { value: "deepseek:deepseek-v4-pro" },
    });

    expect(screen.getByText("chat main assignment none")).toBeInTheDocument();
    expect(screen.getByText("chat model deepseek/deepseek-v4-pro")).toBeInTheDocument();
  });

  it("switches between settings and LLM profile pages without rendering editor panes", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => llmSettingsFetchResponse(input));
    await renderApp("/editor");

    expect(screen.getByRole("navigation", { name: "画面切り替え" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "エディット画面" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "設定ページ" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "設定ページ" })).toHaveAttribute(
      "data-sidebar-placement",
      "bottom",
    );
    expect(
      screen.getByRole("link", { name: "設定ページ" }).querySelector("[data-icon='settings-gear']"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: `アプリバージョン ${APP_DISPLAY_VERSION}` })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.queryByRole("button", { name: "設定を開く" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));
    await screen.findByText("workspace /tmp/workspace");
    fireEvent.click(screen.getByRole("link", { name: "設定ページ" }));

    const settingsPage = await screen.findByRole("region", { name: "設定" });
    expect(screen.getByRole("link", { name: "設定ページ" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "エディット画面" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("region", { name: "エディターワークスペース" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "設定" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("エディターの行を折り返す"));
    fireEvent.click(screen.getByRole("checkbox", { name: "エディターに行番号を表示する" }));
    fireEvent.click(screen.getByLabelText("ノイズディレクトリを表示する"));

    expect(screen.queryByRole("complementary", { name: "ファイルツリー" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "テキストエディター" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "AIアシスト" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "LLMプロフィール管理" }));
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "LLMプロフィール管理" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });
    expect(await screen.findByRole("region", { name: "LLMプロフィール管理" })).toBeInTheDocument();
    expect(screen.getByLabelText("通常チャットモデル")).toHaveValue("deepseek:deepseek-v4-pro");
    fireEvent.change(screen.getByLabelText("通常チャットモデル"), {
      target: { value: "openai:gpt-5.4-mini" },
    });
    expect(localStorage.getItem("ghostwriter:llm-profile-settings:v1")).toContain(
      '"providerId":"openai"',
    );

    fireEvent.click(screen.getByRole("link", { name: "エディット画面" }));
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "エディターワークスペース" })).toBeInTheDocument();
    });
    expect(screen.getByText("wrap lines no")).toBeInTheDocument();
    expect(screen.getByText("line numbers yes")).toBeInTheDocument();
    expect(screen.getByText("show noisy yes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "設定ページ" }));
    expect(settingsPage).not.toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "設定" })).toBeInTheDocument();
  });

  it("manages LLM API keys without persisting or redisplaying key bodies", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (url === "/api/llm/providers") {
        return providerResponse();
      }

      if (url === "/api/llm/secrets" && (!init?.method || init.method === "GET")) {
        return secretResponse();
      }

      if (url === "/api/llm/profiles") {
        return llmSettingsFetchResponse(input);
      }

      if (url === "/api/llm/secrets/deepseek" && init?.method === "PUT") {
        expect(init.body).toBe(JSON.stringify({ apiKey: "deepseek-new-secret" }));
        return new Response(
          JSON.stringify({
            provider: {
              canDelete: true,
              canUpdate: true,
              isConfigured: true,
              maskedSuffix: "cret",
              providerId: "deepseek",
              source: "system",
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }

      if (url === "/api/llm/secrets/gemini" && init?.method === "DELETE") {
        return new Response(
          JSON.stringify({
            provider: {
              canDelete: false,
              canUpdate: true,
              isConfigured: false,
              providerId: "gemini",
              source: "missing",
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    });

    await renderApp("/editor");
    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));
    fireEvent.click(screen.getByRole("link", { name: "設定ページ" }));
    fireEvent.click(await screen.findByRole("button", { name: "APIキー設定を表示" }));

    const deepseekInput = await screen.findByLabelText("DeepSeek APIキー");
    expect(screen.getByText("Anthropic: 未設定")).toBeInTheDocument();
    expect(screen.getByLabelText("Anthropic APIキー")).toBeEnabled();
    expect(screen.getByText("DeepSeek: 未設定")).toBeInTheDocument();
    expect(await screen.findByText("Gemini: アプリに保存済み (末尾 cret)")).toBeInTheDocument();
    expect(screen.getByText("OpenAI: 環境変数で設定済み (末尾 cret)")).toBeInTheDocument();
    expect(screen.getByLabelText("OpenAI APIキー")).toBeDisabled();
    expect(screen.getByRole("button", { name: "OpenAI APIキーを保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "OpenAI APIキーを削除" })).toBeDisabled();
    expect(screen.getByText("環境変数が優先されるため、アプリから変更できません。")).toBeInTheDocument();

    fireEvent.change(deepseekInput, { target: { value: "deepseek-new-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "DeepSeek APIキーを保存" }));

    await waitFor(() => {
      expect(deepseekInput).toHaveValue("");
    });
    expect(screen.queryByDisplayValue("deepseek-new-secret")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("deepseek-new-secret");
    expect(JSON.stringify(localStorage)).not.toContain("deepseek-new-secret");

    fireEvent.click(screen.getByRole("button", { name: "Gemini APIキーを削除" }));
    await waitFor(() => {
      expect(fetchSpy.mock.calls.filter(([input]) => input === "/api/llm/providers")).toHaveLength(3);
    });
    expect(fetchSpy).toHaveBeenCalledWith("/api/llm/secrets/deepseek", {
      body: JSON.stringify({ apiKey: "deepseek-new-secret" }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });
    expect(fetchSpy).toHaveBeenCalledWith("/api/llm/secrets/gemini", { method: "DELETE" });
  });

  it("renders /settings as a normal routed page without the editor panes", async () => {
    await renderApp("/settings");

    expect(screen.getByRole("link", { name: "設定ページ" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("region", { name: "設定" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ワークスペースを開く" })).not.toBeInTheDocument();
    expect(screen.queryByText("workspace none")).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "ファイルツリー" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "テキストエディター" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "AIアシスト" })).not.toBeInTheDocument();
  });

  it("renders a router-level not found page for unknown routes", async () => {
    await renderApp("/missing-route");

    expect(screen.getByRole("region", { name: "ページが見つかりません" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ページが見つかりません" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "エディット画面へ戻る" })).toHaveAttribute("href", "/editor");
  });

  it("routes to the templates page and manages user workspace templates", async () => {
    let savedTemplate = {
      id: "notes-template",
      items: [
        { kind: "directory", path: "notes" },
        { content: "daily notes", kind: "file", path: "notes/today.md" },
      ],
      name: "Notes template",
      source: "user",
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (url === "/api/workspace/templates" && (!init?.method || init.method === "GET")) {
        return new Response(
          JSON.stringify({
            templates: [
              {
                id: "built-in/basic-workspace",
                items: [
                  { content: "# AGENTS.md\n", kind: "file", path: "AGENTS.md" },
                  { kind: "directory", path: "小説" },
                  { kind: "directory", path: "小説/第001章" },
                  { content: "第001章 仮タイトル\n\n", kind: "file", path: "小説/第001章/本文.txt" },
                ],
                name: "小説ワークスペース",
                source: "built-in",
              },
              savedTemplate,
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }

      if (url === "/api/workspace/templates/notes-template" && init?.method === "PUT") {
        expect(JSON.parse(String(init.body))).toEqual({
          items: [
            { kind: "directory", path: "docs" },
            { content: "updated notes", kind: "file", path: "docs/readme.md" },
          ],
          name: "Docs template",
        });
        savedTemplate = {
          id: "notes-template",
          items: [
            { kind: "directory", path: "docs" },
            { content: "updated notes", kind: "file", path: "docs/readme.md" },
          ],
          name: "Docs template",
          source: "user",
        };
        return new Response(JSON.stringify({ template: savedTemplate }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }

      if (url === "/api/workspace/templates/notes-template" && init?.method === "DELETE") {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch ${url}`);
    });

    await renderApp("/editor");

    fireEvent.click(screen.getByRole("link", { name: "テンプレート管理" }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "テンプレート管理" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });
    expect(screen.queryByRole("region", { name: "エディターワークスペース" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ワークスペースを開く" })).not.toBeInTheDocument();
    expect(screen.queryByText("workspace none")).not.toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "テンプレート管理" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "小説ワークスペース" })).toBeInTheDocument();
    expect(screen.getByText("アプリ内定義")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "内蔵テンプレートを複製" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "内蔵テンプレートを削除" })).not.toBeInTheDocument();
    expect(screen.getByText("AGENTS.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Notes template" }));
    fireEvent.change(screen.getByLabelText("テンプレート名"), { target: { value: "Docs template" } });
    fireEvent.change(screen.getByLabelText("ディレクトリ 1"), { target: { value: "docs" } });
    fireEvent.change(screen.getByLabelText("ファイルパス 2"), { target: { value: "docs/readme.md" } });
    fireEvent.change(screen.getByLabelText("ファイル本文 2"), { target: { value: "updated notes" } });

    expect(screen.getByText("検証OK")).toBeInTheDocument();
    expect(screen.getByText("docs/readme.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(screen.getByText("保存しました。")).toBeInTheDocument();
    });
    expect(fetchSpy).toHaveBeenCalledWith("/api/workspace/templates/notes-template", {
      body: JSON.stringify({
        items: [
          { kind: "directory", path: "docs" },
          { content: "updated notes", kind: "file", path: "docs/readme.md" },
        ],
        name: "Docs template",
      }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });

    fireEvent.change(screen.getByLabelText("ファイルパス 2"), { target: { value: "docs/deep/nested/readme.md" } });
    expect(screen.getByText("ファイルは三層まで作成できます。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("ファイルパス 2"), { target: { value: "docs/readme.md" } });
    fireEvent.click(screen.getByRole("button", { name: "項目を追加" }));
    fireEvent.click(screen.getByRole("button", { name: "項目 3 を削除" }));
    expect(screen.queryByLabelText("ディレクトリ 3")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "削除" }));

    await waitFor(() => {
      expect(screen.getByText("削除しました。")).toBeInTheDocument();
    });
    expect(fetchSpy).toHaveBeenCalledWith("/api/workspace/templates/notes-template", {
      method: "DELETE",
    });
  });

  it("does not restore the last workspace when the setting is disabled", async () => {
    localStorage.setItem("ghostwriter:last-workspace-root", "/tmp/stored-workspace");
    localStorage.setItem(
      "ghostwriter:user-settings:v1",
      JSON.stringify({
        restoreLastWorkspace: false,
        showNoisyDirectories: false,
        wrapEditorLines: true,
      }),
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(providerResponse());

    await renderApp("/editor");

    expect(screen.getByText("workspace none")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "小説ワークスペースを準備する" })).toBeInTheDocument();
    expect(screen.queryByText("前回のワークスペースを開いています…")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalledWith("/api/workspace/validate", expect.anything());
  });

  it("reads legacy user settings only when ghostwriter settings are missing", async () => {
    localStorage.setItem(
      "ghostwriter:user-settings:v1",
      JSON.stringify({
        restoreLastWorkspace: true,
        showNoisyDirectories: true,
        wrapEditorLines: false,
      }),
    );
    localStorage.setItem(
      "simple-ai-agent:user-settings:v1",
      JSON.stringify({
        restoreLastWorkspace: true,
        showNoisyDirectories: false,
        wrapEditorLines: true,
      }),
    );

    await renderApp("/editor");

    expect(screen.getByText("wrap lines no")).toBeInTheDocument();
    expect(screen.getByText("line numbers no")).toBeInTheDocument();
    expect(screen.getByText("show noisy yes")).toBeInTheDocument();
  });

  it("falls back to safe default settings when saved settings are invalid", async () => {
    localStorage.setItem("ghostwriter:user-settings:v1", "{bad json");

    await renderApp("/editor");

    expect(screen.getByText("wrap lines yes")).toBeInTheDocument();
    expect(screen.getByText("line numbers no")).toBeInTheDocument();
    expect(screen.getByText("show noisy no")).toBeInTheDocument();
  });

  it("resizes the editor and chat panes by dragging the divider and resets them", async () => {
    await renderApp("/editor");

    const layout = screen.getByRole("region", { name: "エディターワークスペース" });
    vi.spyOn(layout, "getBoundingClientRect").mockReturnValue({
      bottom: 700,
      height: 600,
      left: 0,
      right: 1200,
      toJSON: () => ({}),
      top: 100,
      width: 1200,
      x: 0,
      y: 100,
    });

    const divider = screen.getByRole("separator", { name: "中央ペインとAIアシストの幅を調整" });
    expect(screen.queryByRole("button", { name: "中央ペインとAIアシストの幅をリセット" })).not.toBeInTheDocument();

    fireEvent.pointerDown(divider, { clientX: 820, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 920, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    const resetButton = screen.getByRole("button", { name: "中央ペインとAIアシストの幅をリセット" });
    expect(resetButton.closest(".pane-heading-actions")).not.toBeNull();
    expect(resetButton.closest(".pane-resize-control")).toBeNull();

    fireEvent.click(resetButton);

    expect(layout).not.toHaveAttribute("style");
  });

  it("collapses the file tree from its heading and restores it from the editor tabs", async () => {
    await renderApp("/editor");

    const layout = screen.getByRole("region", { name: "エディターワークスペース" });
    const collapseButton = screen.getByRole("button", { name: "左ペインを折りたたむ" });

    expect(collapseButton.closest(".pane-heading-leading")).not.toBeNull();
    expect(screen.getByRole("complementary", { name: "ファイルツリー" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "左ペインを表示" }),
    ).not.toBeInTheDocument();

    fireEvent.click(collapseButton);

    expect(layout).toHaveAttribute("data-left-pane-collapsed", "true");
    expect(
      screen.queryByRole("complementary", { name: "ファイルツリー" }),
    ).not.toBeInTheDocument();
    const restoreButton = screen.getByRole("button", { name: "左ペインを表示" });
    expect(restoreButton.closest(".editor-tabs-leading")).not.toBeNull();

    fireEvent.click(restoreButton);

    expect(layout).not.toHaveAttribute("data-left-pane-collapsed");
    expect(screen.getByRole("complementary", { name: "ファイルツリー" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "左ペインを表示" }),
    ).not.toBeInTheDocument();
  });

  it("collapses the chat pane from its heading and restores it from the editor tabs", async () => {
    await renderApp("/editor");

    const layout = screen.getByRole("region", { name: "エディターワークスペース" });
    const collapseButton = screen.getByRole("button", { name: "右ペインを折りたたむ" });

    expect(collapseButton.closest(".pane-heading-actions")).not.toBeNull();
    expect(screen.getByRole("complementary", { name: "AIアシスト" })).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "中央ペインとAIアシストの幅を調整" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "右ペインを表示" })).not.toBeInTheDocument();

    fireEvent.click(collapseButton);

    expect(layout).toHaveAttribute("data-right-pane-collapsed", "true");
    expect(screen.queryByRole("complementary", { name: "AIアシスト" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("separator", { name: "中央ペインとAIアシストの幅を調整" }),
    ).not.toBeInTheDocument();
    const restoreButton = screen.getByRole("button", { name: "右ペインを表示" });
    expect(restoreButton.closest(".editor-tabs-trailing")).not.toBeNull();

    fireEvent.click(restoreButton);

    expect(layout).not.toHaveAttribute("data-right-pane-collapsed");
    expect(screen.getByRole("complementary", { name: "AIアシスト" })).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "中央ペインとAIアシストの幅を調整" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "右ペインを表示" })).not.toBeInTheDocument();
  });

  it("collapses both side panes independently and leaves only the editor pane visible", async () => {
    await renderApp("/editor");

    const layout = screen.getByRole("region", { name: "エディターワークスペース" });
    fireEvent.click(screen.getByRole("button", { name: "左ペインを折りたたむ" }));
    fireEvent.click(screen.getByRole("button", { name: "右ペインを折りたたむ" }));

    expect(layout).toHaveAttribute("data-left-pane-collapsed", "true");
    expect(layout).toHaveAttribute("data-right-pane-collapsed", "true");
    expect(screen.queryByRole("complementary", { name: "ファイルツリー" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "AIアシスト" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "テキストエディター" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "左ペインを表示" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "右ペインを表示" })).toBeInTheDocument();
  });
});
