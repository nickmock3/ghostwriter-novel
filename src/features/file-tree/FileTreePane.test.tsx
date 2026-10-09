import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileTreePane } from "./FileTreePane";

const originalFetch = globalThis.fetch;
const originalConfirm = globalThis.confirm;
const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;

const fileTreeResponse = {
  items: [
    { kind: "file", path: "README.md" },
    { kind: "directory", path: "src" },
    { kind: "directory", path: "src/features" },
    { kind: "file", path: "src/features/App.tsx" },
    { kind: "file", path: "src/index.ts" },
  ],
  limit: 100,
  truncated: false,
};

function mockFileTreeFetch(body = fileTreeResponse) {
  const fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    ),
  );
  globalThis.fetch = fetchMock as typeof fetch;
  return fetchMock;
}

describe("FileTreePane", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.confirm = originalConfirm;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalInnerHeight,
    });
    vi.restoreAllMocks();
  });

  it("shows the workspace folder name as the novel title with the full path as a tooltip", async () => {
    mockFileTreeFetch();

    const { container } = render(
      <FileTreePane
        onFileSelected={vi.fn()}
        selectedPath={null}
        workspaceRoot={"C:\\Users\\example\\My Novel"}
      />,
    );

    await screen.findByRole("tree", { name: "ファイルツリー" });
    const novelTitle = container.querySelector(".workspace-tree-root > span");
    expect(novelTitle).toHaveTextContent("My Novel");
    expect(novelTitle).toHaveAttribute("title", "C:\\Users\\example\\My Novel");
    expect(screen.queryByText("MY NOVEL")).not.toBeInTheDocument();
    expect(screen.queryByText("C:\\Users\\example\\My Novel")).not.toBeInTheDocument();
  });

  it("renders workspace files as an expandable hierarchical tree", async () => {
    mockFileTreeFetch();

    render(
      <FileTreePane
        onFileSelected={vi.fn()}
        selectedPath={null}
        workspaceRoot="/tmp/workspace"
      />,
    );

    const tree = await screen.findByRole("tree", { name: "ファイルツリー" });
    expect(within(tree).getByRole("treeitem", { name: "README.md" })).toBeInTheDocument();
    expect(within(tree).getByRole("treeitem", { name: "src" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(within(tree).getByRole("treeitem", { name: "features" })).toHaveAttribute(
      "aria-level",
      "2",
    );
    expect(within(tree).getByRole("treeitem", { name: "App.tsx" })).toHaveAttribute(
      "aria-level",
      "3",
    );

    fireEvent.click(within(tree).getByRole("treeitem", { name: "src" }));

    expect(within(tree).queryByRole("treeitem", { name: "features" })).not.toBeInTheDocument();
    expect(within(tree).queryByRole("treeitem", { name: "index.ts" })).not.toBeInTheDocument();
    expect(within(tree).getByRole("treeitem", { name: "src" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("imports dropped UTF-8 files between siblings in DataTransfer order", async () => {
    const onFileSelected = vi.fn();
    const treeBody = {
      items: [
        { kind: "file", path: "A.txt" },
        { kind: "file", path: "B.txt" },
      ],
      limit: 100,
      truncated: false,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/files/tree")) {
        return Response.json(treeBody);
      }
      if (String(input) === "/api/files/import") {
        const body = JSON.parse(String(init?.body)) as {
          name: string;
          parentPath: string;
        };
        return Response.json({
          operation: "import",
          orderedFilePaths: ["A.txt", body.name, "B.txt"],
          parentPath: body.parentPath,
          path: body.name,
        });
      }
      return Response.json({ message: "unexpected request" }, { status: 500 });
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const droppedFiles = [
      {
        arrayBuffer: vi.fn(async () => new TextEncoder().encode("C本文").buffer),
        name: "C.txt",
      },
      {
        arrayBuffer: vi.fn(async () => new TextEncoder().encode("D本文").buffer),
        name: "D.txt",
      },
    ] as unknown as File[];

    render(
      <FileTreePane
        onFileSelected={onFileSelected}
        selectedPath={null}
        workspaceRoot="/tmp/workspace"
      />,
    );

    const dropTarget = await screen.findByLabelText(
      "A.txt と B.txt の間にファイルを追加",
    );
    fireEvent.dragEnter(dropTarget, {
      dataTransfer: { dropEffect: "none", files: droppedFiles, types: ["Files"] },
    });
    expect(dropTarget).toHaveClass("is-active");

    fireEvent.drop(dropTarget, {
      dataTransfer: { dropEffect: "copy", files: droppedFiles, types: ["Files"] },
    });

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([input]) => String(input) === "/api/files/import"),
      ).toHaveLength(2);
    });
    const importCalls = fetchMock.mock.calls.filter(
      ([input]) => String(input) === "/api/files/import",
    );
    expect(JSON.parse(String(importCalls[0]![1]?.body))).toEqual({
      contentBase64: Buffer.from("C本文").toString("base64"),
      insertBeforePath: "B.txt",
      name: "C.txt",
      parentPath: "",
      workspaceRoot: "/tmp/workspace",
    });
    expect(JSON.parse(String(importCalls[1]![1]?.body))).toMatchObject({
      insertBeforePath: "B.txt",
      name: "D.txt",
    });
    await waitFor(() => {
      expect(onFileSelected).toHaveBeenLastCalledWith("D.txt");
    });
  });

  it("does not expose file drop positions for a filtered or truncated tree", async () => {
    mockFileTreeFetch({
      items: [
        { kind: "file", path: "A.txt" },
        { kind: "file", path: "B.txt" },
      ],
      limit: 100,
      truncated: true,
    });
    const { unmount } = render(
      <FileTreePane
        onFileSelected={vi.fn()}
        selectedPath={null}
        workspaceRoot="/tmp/workspace"
      />,
    );
    await screen.findByRole("treeitem", { name: "B.txt" });
    expect(
      screen.queryByLabelText("A.txt と B.txt の間にファイルを追加"),
    ).not.toBeInTheDocument();
    unmount();

    mockFileTreeFetch({
      items: [
        { kind: "file", path: "A.txt" },
        { kind: "file", path: "B.txt" },
      ],
      limit: 100,
      truncated: false,
    });
    render(
      <FileTreePane
        onFileSelected={vi.fn()}
        selectedPath={null}
        workspaceRoot="/tmp/workspace"
      />,
    );
    await screen.findByRole("treeitem", { name: "B.txt" });
    fireEvent.click(screen.getByRole("button", { name: "ファイルフィルターを開く" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "ファイルを絞り込む" }), {
      target: { value: "txt" },
    });
    await waitFor(() => {
      expect(
        screen.queryByLabelText("A.txt と B.txt の間にファイルを追加"),
      ).not.toBeInTheDocument();
    });
  });

  it("rejects invalid UTF-8 before importing any dropped file", async () => {
    const treeBody = {
      items: [
        { kind: "file", path: "A.txt" },
        { kind: "file", path: "B.txt" },
      ],
      limit: 100,
      truncated: false,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/api/files/tree")
        ? Response.json(treeBody)
        : Response.json({ message: "unexpected import" }, { status: 500 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    const invalidFile = {
      arrayBuffer: vi.fn(async () => Uint8Array.from([0xff]).buffer),
      name: "invalid.txt",
    } as unknown as File;

    render(
      <FileTreePane
        onFileSelected={vi.fn()}
        selectedPath={null}
        workspaceRoot="/tmp/workspace"
      />,
    );
    fireEvent.drop(
      await screen.findByLabelText("A.txt と B.txt の間にファイルを追加"),
      {
        dataTransfer: {
          dropEffect: "copy",
          files: [invalidFile],
          types: ["Files"],
        },
      },
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "invalid.txt はUTF-8テキストではありません",
    );
    expect(
      fetchMock.mock.calls.some(([input]) => String(input) === "/api/files/import"),
    ).toBe(false);
  });

  it("keeps parent directories visible while filtering matching files", async () => {
    const fetchMock = mockFileTreeFetch();

    render(
      <FileTreePane
        onFileSelected={vi.fn()}
        selectedPath="src/features/App.tsx"
        workspaceRoot="/tmp/workspace"
      />,
    );

    await screen.findByRole("treeitem", { name: "App.tsx" });
    fireEvent.click(screen.getByRole("button", { name: "ファイルフィルターを開く" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "ファイルを絞り込む" }), {
      target: { value: "App" },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringContaining("filter=App"),
        expect.any(Object),
      );
    });

    expect(screen.getByRole("treeitem", { name: "src" })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "features" })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "App.tsx" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("expands the compact file filter and clears the active filter", async () => {
    const fetchMock = mockFileTreeFetch();

    render(
      <FileTreePane
        onFileSelected={vi.fn()}
        selectedPath={null}
        workspaceRoot="/tmp/workspace"
      />,
    );

    await screen.findByRole("treeitem", { name: "README.md" });
    expect(
      screen.queryByRole("searchbox", { name: "ファイルを絞り込む" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ファイルフィルターを開く" }));
    const searchbox = screen.getByRole("searchbox", { name: "ファイルを絞り込む" });
    expect(searchbox).toHaveFocus();

    fireEvent.change(searchbox, { target: { value: "README" } });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringContaining("filter=README"),
        expect.any(Object),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "ファイルフィルターをクリア" }));
    expect(screen.getByRole("searchbox", { name: "ファイルを絞り込む" })).toHaveValue("");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.not.stringContaining("filter="),
        expect.any(Object),
      );
    });
  });

  it("creates files from the left pane and refreshes the file tree", async () => {
    const fetchMock = mockFileTreeFetch();

    render(
      <FileTreePane
        dirtyPaths={[]}
        onFileOperation={vi.fn()}
        onFileSelected={vi.fn()}
        selectedPath={null}
        workspaceRoot="/tmp/workspace"
      />,
    );

    await screen.findByRole("treeitem", { name: "README.md" });
    fireEvent.click(screen.getByRole("button", { name: "ファイルを作成" }));
    const tree = screen.getByRole("tree", { name: "ファイルツリー" });
    const createNameInput = screen.getByLabelText("作成する名前");
    const rootOperationForm = createNameInput.closest("form");
    const firstTreeItem = within(tree).getByRole("treeitem", { name: "src" });

    expect(rootOperationForm).not.toBeNull();
    if (!rootOperationForm) {
      throw new Error("Expected the root operation form to be rendered");
    }
    expect(tree).toContainElement(rootOperationForm);
    expect(
      rootOperationForm.compareDocumentPosition(firstTreeItem) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.change(createNameInput, {
      target: { value: "new.md" },
    });
    fireEvent.click(screen.getByRole("button", { name: "作成する" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/files/operations",
        expect.objectContaining({
          body: JSON.stringify({
            kind: "file",
            operation: "create",
            path: "new.md",
            workspaceRoot: "/tmp/workspace",
          }),
          method: "POST",
        }),
      );
    });
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/files/tree"))).toHaveLength(2);
    });
  });

  it("creates directories from an accessible folder icon button", async () => {
    const fetchMock = mockFileTreeFetch();

    render(
      <FileTreePane
        dirtyPaths={[]}
        onFileOperation={vi.fn()}
        onFileSelected={vi.fn()}
        selectedPath={null}
        workspaceRoot="/tmp/workspace"
      />,
    );

    await screen.findByRole("treeitem", { name: "README.md" });
    const createFolderButton = screen.getByRole("button", { name: "フォルダを作成" });

    expect(createFolderButton.querySelector("svg")).toBeInTheDocument();

    fireEvent.click(createFolderButton);
    fireEvent.change(screen.getByLabelText("作成する名前"), {
      target: { value: "docs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "作成する" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/files/operations",
        expect.objectContaining({
          body: JSON.stringify({
            kind: "directory",
            operation: "create",
            path: "docs",
            workspaceRoot: "/tmp/workspace",
          }),
          method: "POST",
        }),
      );
    });
  });

  it("dismisses the operation form on outside click without blocking other controls", async () => {
    mockFileTreeFetch();

    render(
      <FileTreePane
        dirtyPaths={[]}
        onFileOperation={vi.fn()}
        onFileSelected={vi.fn()}
        selectedPath={null}
        workspaceRoot="/tmp/workspace"
      />,
    );

    await screen.findByRole("treeitem", { name: "README.md" });
    fireEvent.click(screen.getByRole("button", { name: "ファイルを作成" }));

    const createNameInput = screen.getByLabelText("作成する名前");
    fireEvent.click(createNameInput);
    expect(createNameInput).toBeInTheDocument();

    fireEvent.click(screen.getByRole("heading", { name: "ファイル" }));
    expect(screen.queryByLabelText("作成する名前")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ファイルを作成" }));
    expect(screen.getByLabelText("作成する名前")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "フォルダを作成" }));
    expect(screen.getByLabelText("作成する名前")).toBeInTheDocument();
    expect(screen.getAllByLabelText("作成する名前")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "src の操作" }));
    expect(screen.queryByLabelText("作成する名前")).not.toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "src の操作" })).toBeInTheDocument();
  });

  it("uses compact icon-only buttons for left pane file operations", async () => {
    mockFileTreeFetch();

    render(
      <FileTreePane
        dirtyPaths={[]}
        onFileOperation={vi.fn()}
        onFileSelected={vi.fn()}
        selectedPath={null}
        workspaceRoot="/tmp/workspace"
      />,
    );

    await screen.findByRole("treeitem", { name: "README.md" });

    for (const label of [
      "ファイルを作成",
      "フォルダを作成",
      "選択中の項目名を変更",
      "選択中の項目を削除",
    ]) {
      const button = screen.getByRole("button", { name: label });
      expect(button).toHaveClass("file-tree-toolbar-action");
    }

    expect(screen.getByRole("button", { name: "ファイルを作成" })).toHaveTextContent("+");
    expect(screen.getByRole("button", { name: "フォルダを作成" }).querySelector("svg")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "選択中の項目名を変更" }).querySelector("svg"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "選択中の項目を削除" }).querySelector("svg"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "選択中の項目名を変更" })).toHaveClass(
      "file-tree-rename-action",
    );
  });

  it("opens item action menus from file and directory rows", async () => {
    const fetchMock = mockFileTreeFetch();
    const onFileOperation = vi.fn();
    globalThis.confirm = vi.fn(() => true) as typeof confirm;

    render(
      <FileTreePane
        dirtyPaths={[]}
        onFileOperation={onFileOperation}
        onFileSelected={vi.fn()}
        selectedPath={null}
        workspaceRoot="/tmp/workspace"
      />,
    );

    await screen.findByRole("treeitem", { name: "README.md" });
    fireEvent.click(screen.getByRole("button", { name: "README.md の操作" }));

    const fileMenu = screen.getByRole("menu", { name: "README.md の操作" });
    expect(fileMenu).toBeInTheDocument();
    expect(fileMenu).toHaveStyle({ position: "fixed" });
    expect(screen.getByRole("tree", { name: "ファイルツリー" })).not.toContainElement(
      fileMenu,
    );
    expect(screen.getByRole("menuitem", { name: "名前を変更" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "削除" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "ファイルを作成" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "名前を変更" }));
    const renameInput = screen.getByLabelText("名前");
    expect(renameInput).toHaveValue("README.md");
    expect(screen.getByRole("treeitem", { name: "README.md" })).toContainElement(
      renameInput,
    );

    fireEvent.keyDown(renameInput, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "src の操作" }));

    expect(screen.getByRole("menu", { name: "src の操作" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "ファイルを作成" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "ディレクトリを作成" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "名前を変更" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "削除" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "ファイルを作成" }));
    const nestedCreateInput = screen.getByLabelText("作成する名前");
    expect(nestedCreateInput).toHaveValue("");
    expect(
      screen.getByRole("treeitem", { name: "src" }).closest("li"),
    ).toContainElement(nestedCreateInput.closest("form"));

    fireEvent.change(nestedCreateInput, {
      target: { value: "new-file.ts" },
    });
    fireEvent.click(screen.getByRole("button", { name: "作成する" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/files/operations",
        expect.objectContaining({
          body: JSON.stringify({
            kind: "file",
            operation: "create",
            path: "src/new-file.ts",
            workspaceRoot: "/tmp/workspace",
          }),
          method: "POST",
        }),
      );
    });
  });

  it("supports context menu and keyboard access for item actions", async () => {
    const fetchMock = mockFileTreeFetch();
    globalThis.confirm = vi.fn(() => true) as typeof confirm;

    render(
      <FileTreePane
        dirtyPaths={[]}
        onFileOperation={vi.fn()}
        onFileSelected={vi.fn()}
        selectedPath={null}
        workspaceRoot="/tmp/workspace"
      />,
    );

    const readme = await screen.findByRole("treeitem", { name: "README.md" });
    fireEvent.contextMenu(readme, { clientX: 123, clientY: 87 });
    expect(screen.getByRole("menu", { name: "README.md の操作" })).toHaveStyle({
      left: "123px",
      position: "fixed",
      top: "87px",
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "削除" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/files/operations",
        expect.objectContaining({
          body: JSON.stringify({
            operation: "delete",
            path: "README.md",
            workspaceRoot: "/tmp/workspace",
          }),
          method: "POST",
        }),
      );
    });

    const sourceDirectory = screen.getByRole("treeitem", { name: "src" });
    fireEvent.keyDown(sourceDirectory, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu", { name: "src の操作" })).toBeInTheDocument();
  });

  it("dismisses floating action menus with Escape, outside click, and item selection", async () => {
    mockFileTreeFetch();

    render(
      <FileTreePane
        dirtyPaths={[]}
        onFileOperation={vi.fn()}
        onFileSelected={vi.fn()}
        selectedPath={null}
        workspaceRoot="/tmp/workspace"
      />,
    );

    const readme = await screen.findByRole("treeitem", { name: "README.md" });
    fireEvent.contextMenu(readme, { clientX: 20, clientY: 30 });
    expect(screen.getByRole("menu", { name: "README.md の操作" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "README.md の操作" })).not.toBeInTheDocument();

    fireEvent.contextMenu(readme, { clientX: 20, clientY: 30 });
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu", { name: "README.md の操作" })).not.toBeInTheDocument();

    fireEvent.contextMenu(readme, { clientX: 20, clientY: 30 });
    fireEvent.click(screen.getByRole("menuitem", { name: "名前を変更" }));
    expect(screen.queryByRole("menu", { name: "README.md の操作" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("名前")).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "README.md" })).toContainElement(
      screen.getByLabelText("名前"),
    );
  });

  it("anchors the floating action menu to the row menu button", async () => {
    mockFileTreeFetch();

    render(
      <FileTreePane
        dirtyPaths={[]}
        onFileOperation={vi.fn()}
        onFileSelected={vi.fn()}
        selectedPath={null}
        workspaceRoot="/tmp/workspace"
      />,
    );

    await screen.findByRole("treeitem", { name: "README.md" });
    const actionButton = screen.getByRole("button", { name: "README.md の操作" });
    vi.spyOn(actionButton, "getBoundingClientRect").mockReturnValue({
      bottom: 72,
      height: 26,
      left: 144,
      right: 170,
      top: 46,
      width: 26,
      x: 144,
      y: 46,
      toJSON: () => ({}),
    });

    fireEvent.click(actionButton);

    expect(screen.getByRole("menu", { name: "README.md の操作" })).toHaveStyle({
      left: "144px",
      position: "fixed",
      top: "72px",
    });
  });

  it("keeps floating action menus inside the viewport", async () => {
    mockFileTreeFetch();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 180,
    });

    render(
      <FileTreePane
        dirtyPaths={[]}
        onFileOperation={vi.fn()}
        onFileSelected={vi.fn()}
        selectedPath={null}
        workspaceRoot="/tmp/workspace"
      />,
    );

    const readme = await screen.findByRole("treeitem", { name: "README.md" });
    fireEvent.contextMenu(readme, { clientX: 300, clientY: 300 });

    expect(screen.getByRole("menu", { name: "README.md の操作" })).toHaveStyle({
      left: "12px",
      top: "12px",
    });
  });

  it("rejects empty create names before calling the file operation API", async () => {
    const fetchMock = mockFileTreeFetch();

    render(
      <FileTreePane
        dirtyPaths={[]}
        onFileOperation={vi.fn()}
        onFileSelected={vi.fn()}
        selectedPath={null}
        workspaceRoot="/tmp/workspace"
      />,
    );

    await screen.findByRole("treeitem", { name: "README.md" });
    fireEvent.click(screen.getByRole("button", { name: "ファイルを作成" }));
    fireEvent.click(screen.getByRole("button", { name: "作成する" }));

    expect(screen.getByRole("alert")).toHaveTextContent("名前を入力してください");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/files/operations", expect.anything());
  });

  it("builds rename paths from the parent directory and validates basename input", async () => {
    const fetchMock = mockFileTreeFetch();
    const confirmMock = vi.fn(() => true);
    globalThis.confirm = confirmMock as typeof confirm;

    render(
      <FileTreePane
        dirtyPaths={[]}
        onFileOperation={vi.fn()}
        onFileSelected={vi.fn()}
        selectedPath={null}
        workspaceRoot="/tmp/workspace"
      />,
    );

    await screen.findByRole("treeitem", { name: "App.tsx" });
    fireEvent.click(screen.getByRole("button", { name: "App.tsx の操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "名前を変更" }));

    const renameInput = screen.getByLabelText("名前");
    expect(renameInput).toHaveValue("App.tsx");

    fireEvent.change(renameInput, { target: { value: "nested/App.tsx" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent("名前に / は使えません");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/files/operations", expect.anything());

    fireEvent.change(renameInput, { target: { value: "AppRenamed.tsx" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/files/operations",
        expect.objectContaining({
          body: JSON.stringify({
            newPath: "src/features/AppRenamed.tsx",
            operation: "rename",
            path: "src/features/App.tsx",
            workspaceRoot: "/tmp/workspace",
          }),
          method: "POST",
        }),
      );
    });
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("keeps item operations anchored when the item path is root", async () => {
    mockFileTreeFetch({
      items: [{ kind: "file", path: "root" }],
      limit: 100,
      truncated: false,
    });

    render(
      <FileTreePane
        dirtyPaths={[]}
        onFileOperation={vi.fn()}
        onFileSelected={vi.fn()}
        selectedPath={null}
        workspaceRoot="/tmp/workspace"
      />,
    );

    const rootItem = await screen.findByRole("treeitem", { name: "root" });
    fireEvent.click(screen.getByRole("button", { name: "root の操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "名前を変更" }));

    expect(rootItem.closest("li")).toContainElement(
      screen.getByLabelText("名前").closest("form"),
    );
    expect(rootItem).toContainElement(screen.getByLabelText("名前"));
  });

  it("refreshes the file tree when the external refresh key changes", async () => {
    const fetchMock = mockFileTreeFetch();

    const { rerender } = render(
      <FileTreePane
        onFileSelected={vi.fn()}
        selectedPath={null}
        workspaceRoot="/tmp/workspace"
        refreshKey={0}
      />,
    );

    await screen.findByRole("treeitem", { name: "README.md" });
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/files/tree"))).toHaveLength(1);

    rerender(
      <FileTreePane
        onFileSelected={vi.fn()}
        selectedPath={null}
        workspaceRoot="/tmp/workspace"
        refreshKey={1}
      />,
    );

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/files/tree"))).toHaveLength(2);
    });
  });

  it("confirms destructive operations and blocks dirty open files", async () => {
    const fetchMock = mockFileTreeFetch();
    const onFileOperation = vi.fn();
    globalThis.confirm = vi.fn(() => true) as typeof confirm;

    render(
      <FileTreePane
        dirtyPaths={["src/index.ts"]}
        onFileOperation={onFileOperation}
        onFileSelected={vi.fn()}
        selectedPath="src/index.ts"
        workspaceRoot="/tmp/workspace"
      />,
    );

    await screen.findByRole("treeitem", { name: "index.ts" });
    fireEvent.click(screen.getByRole("button", { name: "選択中の項目を削除" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "未保存の変更があるファイルは削除または名前変更できません",
    );
    expect(fetchMock).not.toHaveBeenCalledWith("/api/files/operations", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "選択中の項目名を変更" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "未保存の変更があるファイルは削除または名前変更できません",
    );
    expect(onFileOperation).not.toHaveBeenCalled();
  });
});
