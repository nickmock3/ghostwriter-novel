import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRouter } from "../../router";

const { selectDesktopWorkspaceDirectoryMock } = vi.hoisted(() => ({
  selectDesktopWorkspaceDirectoryMock: vi.fn(),
}));

vi.mock("../../shared/client/desktopWorkspaceDialog", () => ({
  selectDesktopWorkspaceDirectory: selectDesktopWorkspaceDirectoryMock,
}));

vi.mock("../ai-assist/useAiAssistExecutionOptions", () => ({
  useAiAssistExecutionOptions: () => ({ executionOptions: [], isLoading: false }),
}));

vi.mock("../ai-assist/useAiAssistDefinitions", () => ({
  useAiAssistDefinitions: () => ({
    assists: [],
    deleteAssist: vi.fn(),
    error: null,
    isLoading: false,
    reload: vi.fn(),
    saveAssist: vi.fn(),
  }),
}));

async function renderApp(initialEntry = "/editor") {
  const router = getRouter({
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });

  await act(async () => {
    await router.load();
  });

  return render(<RouterProvider router={router} />);
}

describe("WorkspaceBar", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    localStorage.clear();
    selectDesktopWorkspaceDirectoryMock.mockReset();
    vi.restoreAllMocks();
  });

  it("starts without an active workspace", async () => {
    const { container } = await renderApp();

    expect(screen.getByText("未選択")).toBeInTheDocument();
    expect(screen.getByText("ワークスペースを選択してください。")).toBeInTheDocument();
    expect(container.querySelector(".workspace-brand-mark")).toMatchObject({
      alt: "",
      src: expect.stringMatching(/\/favicon\.png$/),
      tagName: "IMG",
    });
  });

  it("keeps only meaningful header actions available", async () => {
    await renderApp();

    expect(screen.getByRole("button", { name: "新規ワークスペース" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ワークスペースを開く" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "テンプレートを適用" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("保存状態")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "ペイン表示を切り替え" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "表示設定" })).not.toBeInTheDocument();
  });

  it("defaults the first-run create flow to the standard novel template", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
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
              {
                id: "user:notes",
                items: [{ content: "# Notes\n", kind: "file", path: "notes.md" }],
                name: "Notes",
                source: "user",
              },
            ],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }

      return new Response(JSON.stringify({ providers: [] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });

    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "新しい小説ワークスペースを作成" }));

    const dialog = await screen.findByRole("dialog", { name: "新しい小説ワークスペースを作成" });
    expect(screen.queryByLabelText("作品名またはワークスペース名")).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "テンプレートを選択してから、次に開くフォルダ選択で作品名のフォルダを作成または選択してください。",
    );
    expect(await screen.findByRole("button", { name: "標準の小説テンプレートで始める" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "空のワークスペースで始める" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "フォルダを選んで作成" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("AGENTS.md");
    expect(dialog).toHaveTextContent("小説/第001章/本文.txt");
  });

  it("does not apply a template when the first-run flow opens an existing folder", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ workspaceRoot: "/Users/example/project" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "既存のフォルダを開く" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "project" })).toHaveAttribute(
        "title",
        "/Users/example/project",
      );
    });
    expect(fetchSpy).toHaveBeenCalledWith("/api/workspace/select", { method: "POST" });
    expect(fetchSpy).not.toHaveBeenCalledWith("/api/workspace/template", expect.anything());
  });

  it("shows template selection before the header new workspace flow opens the folder picker", async () => {
    localStorage.setItem("ghostwriter:last-workspace-root", "/Users/example/current");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (url === "/api/workspace/validate" && init?.method === "POST") {
        return new Response(JSON.stringify({ workspaceRoot: "/Users/example/current" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }

      if (url === "/api/workspace/templates" && (!init?.method || init.method === "GET")) {
        return new Response(
          JSON.stringify({
            templates: [
              {
                id: "built-in/basic-workspace",
                items: [
                  { content: "# AGENTS.md\n", kind: "file", path: "AGENTS.md" },
                  { kind: "directory", path: "小説" },
                ],
                name: "小説ワークスペース",
                source: "built-in",
              },
            ],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }

      if (url === "/api/workspace/select" && init?.method === "POST") {
        return new Response(JSON.stringify({ workspaceRoot: "/Users/example/new-novel" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }

      if (url === "/api/workspace/template" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            createdDirectories: ["小説"],
            createdFiles: ["AGENTS.md"],
            skippedExisting: [],
            workspaceRoot: "/Users/example/new-novel",
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }

      if (url.includes("/api/files/tree")) {
        return new Response(JSON.stringify({ items: [], limit: 100, truncated: false }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }

      return new Response(JSON.stringify({ providers: [] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });

    await renderApp();

    await screen.findByRole("heading", { name: "current" });
    fireEvent.click(screen.getByRole("button", { name: "新規ワークスペース" }));

    const dialog = await screen.findByRole("dialog", { name: "新しい小説ワークスペースを作成" });
    expect(dialog).toHaveTextContent("テンプレートを選択してから");
    expect(screen.getByRole("button", { name: "標準の小説テンプレートで始める" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(fetchSpy).not.toHaveBeenCalledWith("/api/workspace/select", expect.anything());
    expect(fetchSpy).not.toHaveBeenCalledWith("/api/workspace/template", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "フォルダを選んで作成" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("/api/workspace/template", {
        body: JSON.stringify({
          templateId: "built-in/basic-workspace",
          workspaceRoot: "/Users/example/new-novel",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    });
    expect(screen.getByRole("heading", { name: "new-novel" })).toHaveAttribute(
      "title",
      "/Users/example/new-novel",
    );
  });

  it("starts a new novel from chat mode without showing template selection", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (url === "/api/workspace/select" && init?.method === "POST") {
        return new Response(JSON.stringify({ workspaceRoot: "/Users/example/chat-novel" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }

      if (url === "/api/workspace/template" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            createdDirectories: ["小説", "小説/第001章", "設定", "プロット", "資料", "メモ"],
            createdFiles: [
              "AGENTS.md",
              "小説/第001章/本文.txt",
              "小説/第001章/章内プロット.md",
              "設定/登場人物.md",
              "設定/世界観.md",
              "設定/用語集.md",
              "プロット/全体構成.md",
            ],
            skippedExisting: [],
            workspaceRoot: "/Users/example/chat-novel",
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }

      return new Response(JSON.stringify({ providers: [] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });

    await renderApp("/chat");

    expect(screen.getByRole("button", { name: "新しい小説を始める" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新規ワークスペース" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "新しい小説を始める" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("/api/workspace/template", {
        body: JSON.stringify({
          templateId: "built-in/chat-mode-novel",
          workspaceRoot: "/Users/example/chat-novel",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    });
    expect(fetchSpy).not.toHaveBeenCalledWith("/api/workspace/templates", expect.anything());
    expect(screen.queryByRole("dialog", { name: "新しい小説ワークスペースを作成" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "標準の小説テンプレートで始める" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "chat-novel" })).toHaveAttribute(
      "title",
      "/Users/example/chat-novel",
    );
  });

  it("shows a friendly chat start error when template application fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (url === "/api/workspace/select" && init?.method === "POST") {
        return new Response(JSON.stringify({ workspaceRoot: "/Users/example/chat-novel" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }

      if (url === "/api/workspace/template" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            code: "workspace_selection_failed",
            message: "Template target already exists: AGENTS.md",
          }),
          { headers: { "content-type": "application/json" }, status: 409 },
        );
      }

      return new Response(JSON.stringify({ providers: [] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });

    await renderApp("/chat");
    fireEvent.click(screen.getByRole("button", { name: "新しい小説を始める" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "新しい小説を始められませんでした。空のフォルダを選ぶか、別のフォルダを選び直してください。",
      );
    });
    expect(screen.queryByText("Template target already exists: AGENTS.md")).not.toBeInTheDocument();
  });

  it("lets chat mode start a new novel from the manual path fallback", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (url === "/api/workspace/select" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            code: "workspace_selection_failed",
            message: "Native picker unavailable",
          }),
          { headers: { "content-type": "application/json" }, status: 500 },
        );
      }

      if (url === "/api/workspace/validate" && init?.method === "POST") {
        return new Response(JSON.stringify({ workspaceRoot: "/Users/example/manual-chat-novel" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }

      if (url === "/api/workspace/template" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            createdDirectories: ["小説", "小説/第001章"],
            createdFiles: ["AGENTS.md", "小説/第001章/本文.txt"],
            skippedExisting: [],
            workspaceRoot: "/Users/example/manual-chat-novel",
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }

      return new Response(JSON.stringify({ providers: [] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });

    await renderApp("/chat");
    fireEvent.click(screen.getByRole("button", { name: "新しい小説を始める" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "新しい小説を始められませんでした。空のフォルダを選ぶか、別のフォルダを選び直してください。",
      );
    });

    fireEvent.change(screen.getByLabelText("ワークスペースの絶対パス"), {
      target: { value: "/Users/example/manual-chat-novel" },
    });
    fireEvent.click(screen.getByRole("button", { name: "このパスで小説を始める" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("/api/workspace/template", {
        body: JSON.stringify({
          templateId: "built-in/chat-mode-novel",
          workspaceRoot: "/Users/example/manual-chat-novel",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    });
    expect(screen.getByRole("heading", { name: "manual-chat-novel" })).toHaveAttribute(
      "title",
      "/Users/example/manual-chat-novel",
    );
  });

  it("shows the selected workspace returned by the API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ workspaceRoot: "/Users/example/project" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "project" })).toHaveAttribute(
        "title",
        "/Users/example/project",
      );
    });
    expect(screen.queryByText("/Users/example/project")).not.toBeInTheDocument();
  });

  it("validates a directory selected by the Tauri desktop dialog", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    selectDesktopWorkspaceDirectoryMock.mockResolvedValue("/Users/example/project");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ workspaceRoot: "/Users/example/project" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "project" })).toHaveAttribute(
        "title",
        "/Users/example/project",
      );
    });
    expect(selectDesktopWorkspaceDirectoryMock).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith("/api/workspace/validate", {
      body: JSON.stringify({ workspaceRoot: "/Users/example/project" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(fetchSpy).not.toHaveBeenCalledWith("/api/workspace/select", expect.anything());
  });

  it("returns to the current screen without an error when the Tauri dialog is cancelled", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    selectDesktopWorkspaceDirectoryMock.mockResolvedValue(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));

    await waitFor(() => {
      expect(selectDesktopWorkspaceDirectoryMock).toHaveBeenCalledOnce();
    });
    expect(screen.getByText("未選択")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalledWith("/api/workspace/validate", expect.anything());
    expect(fetchSpy).not.toHaveBeenCalledWith("/api/workspace/select", expect.anything());
  });

  it("shows a fallback error when native workspace selection fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "workspace_selection_failed",
          message: "Native picker unavailable",
        }),
        { headers: { "content-type": "application/json" }, status: 500 },
      ),
    );

    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "ワークスペースを開けませんでした。絶対パスを確認してください。",
      );
    });
    expect(screen.getByLabelText("ワークスペースの絶対パス")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "パスを指定して開く" })).toBeInTheDocument();
  });

  it("does not show PowerShell or .NET details when native selection fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "workspace_selection_failed",
          message: "Add-Type : Cannot add type. powershell.exe System.Windows.Forms stack",
        }),
        { headers: { "content-type": "application/json" }, status: 500 },
      ),
    );

    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "ワークスペースを開けませんでした。絶対パスを確認してください。",
      );
    });
    expect(screen.queryByText(/PowerShell|powershell|Add-Type|System\.Windows\.Forms/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("ワークスペースの絶対パス")).toBeInTheDocument();
  });

  it("opens a validated workspace from the manual path fallback", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (url === "/api/workspace/select") {
        return new Response(
          JSON.stringify({
            code: "workspace_selection_failed",
            message: "spawn osascript ENOENT",
          }),
          { headers: { "content-type": "application/json" }, status: 500 },
        );
      }

      if (url === "/api/workspace/validate" && init?.method === "POST") {
        return new Response(JSON.stringify({ workspaceRoot: "/Users/example/project" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }

      return new Response(JSON.stringify({ providerId: "deepseek", providers: [] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });

    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "ワークスペースを開く" }));
    fireEvent.change(await screen.findByLabelText("ワークスペースの絶対パス"), {
      target: { value: "/Users/example/project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "パスを指定して開く" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "project" })).toHaveAttribute(
        "title",
        "/Users/example/project",
      );
    });
    expect(fetchSpy).toHaveBeenCalledWith("/api/workspace/validate", {
      body: JSON.stringify({ workspaceRoot: "/Users/example/project" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  });

  it("shows a generic message when manual workspace validation fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url === "/api/workspace/validate") {
        return new Response(
          JSON.stringify({
            code: "workspace_selection_failed",
            message: "Workspace path must be a directory",
          }),
          { headers: { "content-type": "application/json" }, status: 400 },
        );
      }

      return new Response(JSON.stringify({ providerId: "deepseek", providers: [] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });

    await renderApp();
    fireEvent.change(screen.getByLabelText("ワークスペースの絶対パス"), {
      target: { value: "/Users/example/not-a-directory.txt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "パスを指定して開く" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "ワークスペースを開けませんでした。絶対パスを確認してください。",
      );
    });
    expect(screen.getByText("Workspace path must be a directory")).toBeInTheDocument();
  });

});
