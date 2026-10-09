import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorPane } from "./EditorPane";
import { useFileSession } from "./useFileSession";

const { editorDispatches, editorFocus } = vi.hoisted(() => ({
  editorDispatches: [] as unknown[],
  editorFocus: vi.fn(),
}));
const { editorDropPosition } = vi.hoisted(() => ({
  editorDropPosition: vi.fn(() => 4),
}));

vi.mock("@uiw/react-codemirror", () => ({
  EditorSelection: {
    range: (anchor: number, head: number) => ({ anchor, head }),
  },
  EditorView: {
    lineWrapping: "line-wrapping-extension",
    scrollIntoView: (selection: unknown) => ({ selection }),
    theme: () => "theme-extension",
  },
  keymap: {
    of: (bindings: unknown[]) =>
      bindings.some((binding) => String((binding as { key?: unknown }).key).includes("Mod-f"))
        ? "localized-search-keymap-extension"
        : "keymap-extension",
  },
  default: ({
    basicSetup,
    extensions,
    onChange,
    onCreateEditor,
    onUpdate,
    value,
  }: {
    basicSetup: { lineNumbers?: boolean };
    extensions: unknown[];
    onChange: (value: string) => void;
    onCreateEditor?: (view: {
      dispatch: (transaction: unknown) => void;
      focus: () => void;
      posAtCoords: (coords: { x: number; y: number }) => number | null;
    }) => void;
    onUpdate?: (update: {
      state: {
        doc: { sliceString: (from: number, to: number) => string };
        selection: { main: { empty: boolean; from: number; to: number } };
      };
      view: {
        coordsAtPos: (pos: number) => { bottom: number; left: number; top: number };
      };
    }) => void;
    value: string;
  }) => {
    onCreateEditor?.({
      dispatch: (transaction) => {
        editorDispatches.push(transaction);
        const changes = (transaction as {
          changes?: { from: number; insert: string; to?: number };
        }).changes;
        if (changes) {
          onChange(
            `${value.slice(0, changes.from)}${changes.insert}${value.slice(
              changes.to ?? changes.from,
            )}`,
          );
        }
      },
      focus: editorFocus,
      posAtCoords: editorDropPosition,
    });
    return (
      <>
      <textarea
        aria-label="エディター本文"
        onChange={(event) => onChange(event.currentTarget.value)}
        onSelect={(event) => {
          const selectionStart = event.currentTarget.selectionStart;
          const selectionEnd = event.currentTarget.selectionEnd;
          onUpdate?.({
            state: {
              doc: {
                sliceString: (from, to) => event.currentTarget.value.slice(from, to),
              },
              selection: {
                main: {
                  empty: selectionStart === selectionEnd,
                  from: selectionStart,
                  to: selectionEnd,
                },
              },
            },
            view: {
              coordsAtPos: () => ({ bottom: 70, left: 130, top: 50 }),
            },
          });
        }}
        value={value}
      />
      <output aria-label="CodeMirror拡張">
        {extensions.includes("line-wrapping-extension") ? "line-wrapping" : "no-wrapping"}
        {extensions.includes("localized-search-keymap-extension") ? " localized-search" : ""}
      </output>
      <output aria-label="行番号">{basicSetup.lineNumbers ? "表示" : "非表示"}</output>
      </>
    );
  },
}));

const fileContents = new Map<string, string>();

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? new URL(input, window.location.origin) : new URL(input.toString());

    if (url.pathname === "/api/files/content" && (!init?.method || init.method === "GET")) {
      const filePath = url.searchParams.get("path") ?? "";
      const content = fileContents.get(filePath);

      if (content === undefined) {
        return Response.json({ message: "not found" }, { status: 404 });
      }

      return Response.json({ content, path: filePath }, { status: 200 });
    }

    if (url.pathname === "/api/files/content" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { content: string; path: string };
      fileContents.set(body.path, body.content);
      return Response.json({ content: body.content, path: body.path }, { status: 200 });
    }

    return Response.json({ message: "unexpected request" }, { status: 500 });
  });
}

function PersistentEditorSession({ show }: { show: boolean }) {
  const fileSession = useFileSession({
    selectedPath: "src/app.ts",
    workspaceRoot: "/workspace",
  });
  return show ? (
    <EditorPane
      fileSession={fileSession}
      workspaceRoot="/workspace"
      selectedPath="src/app.ts"
    />
  ) : null;
}

function createFileDropEvent(files: File[], coordinates = { x: 32, y: 48 }) {
  const event = new MouseEvent("drop", {
    bubbles: true,
    cancelable: true,
    clientX: coordinates.x,
    clientY: coordinates.y,
  });
  Object.defineProperty(event, "dataTransfer", {
    value: { files },
  });
  return event;
}

describe("EditorPane", () => {
  beforeEach(() => {
    editorDispatches.length = 0;
    editorFocus.mockClear();
    editorDropPosition.mockClear();
    fileContents.clear();
    fileContents.set("src/app.ts", "app v1");
    fileContents.set("src/util.ts", "util v1");
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not render editor tabs before a file is selected", () => {
    render(<EditorPane workspaceRoot="/workspace" selectedPath={null} />);

    expect(screen.queryByRole("tablist", { name: "開いているファイル" })).not.toBeInTheDocument();
    expect(screen.queryByText("ファイル未選択")).not.toBeInTheDocument();
    expect(screen.getByTestId("editor-tabs-spacer")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "何から始めますか？" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "アイディアをAIに相談する" })).not.toBeInTheDocument();
    expect(
      screen.getByText("左のツリーからファイルを選ぶと、ここで編集できます。"),
    ).toBeInTheDocument();
  });

  it("guides workspace selection when no workspace is open", () => {
    render(<EditorPane workspaceRoot={null} selectedPath={null} />);
    expect(screen.getByText("ワークスペースを選択し、テキストファイルを開くとここで編集できます。")).toBeInTheDocument();
    expect(screen.queryByText("左のツリーからファイルを選ぶと、ここで編集できます。")).not.toBeInTheDocument();
  });

  it("hides the empty editor guide after a file is selected", async () => {
    render(<EditorPane workspaceRoot="/workspace" selectedPath="src/app.ts" />);

    expect(await screen.findByLabelText("エディター本文")).toHaveValue("app v1");
    expect(screen.queryByRole("heading", { name: "何から始めますか？" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "プロットを作る" })).not.toBeInTheDocument();
  });

  it("opens selected files as reusable tabs and switches between them", async () => {
    const { rerender } = render(
      <EditorPane workspaceRoot="/workspace" selectedPath="src/app.ts" />,
    );

    expect(await screen.findByRole("tab", { name: /src\/app\.ts/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByLabelText("エディター本文")).toHaveValue("app v1");

    rerender(<EditorPane workspaceRoot="/workspace" selectedPath="src/util.ts" />);

    expect(await screen.findByRole("tab", { name: /src\/util\.ts/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /src\/app\.ts/ })).toBeInTheDocument();
    expect(screen.getByLabelText("エディター本文")).toHaveValue("util v1");

    rerender(<EditorPane workspaceRoot="/workspace" selectedPath="src/app.ts" />);

    expect(await screen.findByRole("tab", { name: /src\/app\.ts/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getAllByRole("tab", { name: /src\/app\.ts/ })).toHaveLength(1);
    expect(screen.getByLabelText("エディター本文")).toHaveValue("app v1");
  });

  it("marks dirty tabs and asks before closing unsaved content", async () => {
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);

    render(<EditorPane workspaceRoot="/workspace" selectedPath="src/app.ts" />);

    fireEvent.change(await screen.findByLabelText("エディター本文"), {
      target: { value: "changed" },
    });

    expect(screen.getByRole("tab", { name: /src\/app\.ts.*未保存/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "src/app.ts を閉じる" }));

    expect(confirmSpy).toHaveBeenCalledWith("src/app.ts には未保存の変更があります。破棄して閉じますか？");
    expect(screen.getByRole("tab", { name: /src\/app\.ts.*未保存/ })).toBeInTheDocument();
  });

  it("refreshes an already open tab when an applied edit changes its file", async () => {
    const { rerender } = render(
      <EditorPane workspaceRoot="/workspace" selectedPath="src/app.ts" refreshKey={0} />,
    );

    expect(await screen.findByLabelText("エディター本文")).toHaveValue("app v1");

    fileContents.set("src/app.ts", "app v2");
    rerender(<EditorPane workspaceRoot="/workspace" selectedPath="src/app.ts" refreshKey={1} />);

    await waitFor(() => {
      expect(screen.getByLabelText("エディター本文")).toHaveValue("app v2");
    });
  });

  it("wraps long lines for display without inserting newlines into saved content", async () => {
    const longLine = "https://example.test/" + "very-long-segment".repeat(20);
    fileContents.set("notes/long-line.txt", longLine);

    render(<EditorPane workspaceRoot="/workspace" selectedPath="notes/long-line.txt" />);

    expect(await screen.findByLabelText("エディター本文")).toHaveValue(longLine);
    expect(screen.getByLabelText("CodeMirror拡張")).toHaveTextContent("line-wrapping");

    fireEvent.change(screen.getByLabelText("エディター本文"), {
      target: { value: `${longLine} edited` },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(fileContents.get("notes/long-line.txt")).toBe(`${longLine} edited`);
    });
    expect(fileContents.get("notes/long-line.txt")).not.toContain("\n");
  });

  it("hides line numbers by default and shows them when enabled", async () => {
    const { rerender } = render(
      <EditorPane workspaceRoot="/workspace" selectedPath="src/app.ts" />,
    );

    expect(await screen.findByLabelText("エディター本文")).toHaveValue("app v1");
    expect(screen.getByLabelText("行番号")).toHaveTextContent("非表示");

    rerender(
      <EditorPane
        showLineNumbers
        workspaceRoot="/workspace"
        selectedPath="src/app.ts"
      />,
    );

    expect(screen.getByLabelText("行番号")).toHaveTextContent("表示");
  });

  it("applies localized search key handling for Japanese search and replace labels", async () => {
    render(<EditorPane workspaceRoot="/workspace" selectedPath="src/app.ts" />);

    expect(await screen.findByLabelText("エディター本文")).toHaveValue("app v1");
    expect(screen.getByLabelText("CodeMirror拡張")).toHaveTextContent("localized-search");
  });

  it("shows a character count that follows edits, saves, and tab switches without redundant status text", async () => {
    fileContents.set("src/app.ts", "abcde");
    fileContents.set("src/util.ts", "");

    const { rerender } = render(
      <EditorPane workspaceRoot="/workspace" selectedPath="src/app.ts" />,
    );

    expect(await screen.findByLabelText("エディター本文")).toHaveValue("abcde");
    expect(screen.getByLabelText("文字数")).toHaveTextContent("5文字");
    expect(screen.queryByText("UTF-8")).not.toBeInTheDocument();
    expect(screen.queryByText("Ln 1, Col 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Spaces: 2")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("エディター本文"), {
      target: { value: "abcde changed" },
    });
    expect(screen.getByLabelText("文字数")).toHaveTextContent("13文字");

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(fileContents.get("src/app.ts")).toBe("abcde changed");
    });
    expect(screen.getByLabelText("文字数")).toHaveTextContent("13文字");

    rerender(<EditorPane workspaceRoot="/workspace" selectedPath="src/util.ts" />);

    expect(await screen.findByRole("tab", { name: /src\/util\.ts/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByLabelText("文字数")).toHaveTextContent("0文字");

    fireEvent.click(screen.getByRole("tab", { name: /src\/app\.ts/ }));

    expect(screen.getByLabelText("エディター本文")).toHaveValue("abcde changed");
    expect(screen.getByLabelText("文字数")).toHaveTextContent("13文字");
  });

  it("reports the saved file and CodeMirror selection as the current AI assist target", async () => {
    const onAiAssistTargetChange = vi.fn();
    fileContents.set("src/app.ts", "const value = 1;\nconsole.log(value);");

    render(
      <EditorPane
        onAiAssistTargetChange={onAiAssistTargetChange}
        workspaceRoot="/workspace"
        selectedPath="src/app.ts"
      />,
    );

    const editor = await screen.findByLabelText("エディター本文") as HTMLTextAreaElement;
    await waitFor(() => {
      expect(onAiAssistTargetChange).toHaveBeenLastCalledWith({
        content: "const value = 1;\nconsole.log(value);",
        isDirty: false,
        path: "src/app.ts",
        selection: null,
      });
    });

    editor.setSelectionRange(6, 11);
    fireEvent.select(editor);

    await waitFor(() => {
      expect(onAiAssistTargetChange).toHaveBeenLastCalledWith({
        content: "const value = 1;\nconsole.log(value);",
        isDirty: false,
        path: "src/app.ts",
        selection: { end: 11, start: 6 },
      });
    });
    expect(screen.queryByRole("button", { name: "選択範囲をチャットへ送る" })).not.toBeInTheDocument();
  });

  it("reports a dirty whole-file target after content changes", async () => {
    const onAiAssistTargetChange = vi.fn();
    render(
      <EditorPane
        onAiAssistTargetChange={onAiAssistTargetChange}
        workspaceRoot="/workspace"
        selectedPath="src/app.ts"
      />,
    );
    const editor = await screen.findByLabelText("エディター本文") as HTMLTextAreaElement;
    editor.setSelectionRange(0, 3);
    fireEvent.select(editor);

    fireEvent.change(editor, { target: { value: "changed content" } });
    await waitFor(() => {
      expect(onAiAssistTargetChange).toHaveBeenLastCalledWith({
        content: "changed content",
        isDirty: true,
        path: "src/app.ts",
        selection: null,
      });
    });
  });

  it("selects a one-shot source range after a reader jump opens the file", async () => {
    fileContents.set("src/app.ts", "前｜漢字《かんじ》後");
    const onSelectionRequestConsumed = vi.fn();

    render(
      <EditorPane
        onSelectionRequestConsumed={onSelectionRequestConsumed}
        selectionRequest={{
          end: 4,
          id: 1,
          path: "src/app.ts",
          sourceExcerpt: "漢字",
          start: 2,
        }}
        workspaceRoot="/workspace"
        selectedPath="src/app.ts"
      />,
    );

    expect(await screen.findByLabelText("エディター本文")).toHaveValue(
      "前｜漢字《かんじ》後",
    );
    await waitFor(() => {
      expect(editorDispatches).toContainEqual({
        effects: expect.anything(),
        scrollIntoView: true,
        selection: { anchor: 4, head: 2 },
      });
    });
    expect(editorFocus).toHaveBeenCalled();
    expect(onSelectionRequestConsumed).toHaveBeenCalledTimes(1);
    expect(onSelectionRequestConsumed).toHaveBeenCalledWith(1);
  });

  it("keeps current content and consumes a stale reader selection without dispatching it", async () => {
    fileContents.set("src/app.ts", "current content");
    const onSelectionRequestConsumed = vi.fn();

    const { rerender } = render(
      <EditorPane
        onSelectionRequestConsumed={onSelectionRequestConsumed}
        selectionRequest={{
          end: 7,
          id: 2,
          path: "src/app.ts",
          sourceExcerpt: "stale!!",
          start: 0,
        }}
        workspaceRoot="/workspace"
        selectedPath="src/app.ts"
      />,
    );

    expect(await screen.findByLabelText("エディター本文")).toHaveValue("current content");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "リーダーで選択した位置と現在の内容が一致しない",
    );
    expect(editorDispatches).not.toContainEqual(
      expect.objectContaining({ selection: expect.anything() }),
    );
    expect(onSelectionRequestConsumed).toHaveBeenCalledTimes(1);

    rerender(
      <EditorPane
        onSelectionRequestConsumed={onSelectionRequestConsumed}
        selectionRequest={null}
        workspaceRoot="/workspace"
        selectedPath="src/app.ts"
      />,
    );
    expect(onSelectionRequestConsumed).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("エディター本文")).toHaveValue("current content");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "リーダーで選択した位置と現在の内容が一致しない",
    );
  });

  it("preserves a dirty file session while the editor view unmounts between routes", async () => {
    const { rerender } = render(<PersistentEditorSession show />);

    fireEvent.change(await screen.findByLabelText("エディター本文"), {
      target: { value: "unsaved route change" },
    });
    expect(screen.getByLabelText("エディター本文")).toHaveValue("unsaved route change");
    expect(screen.getByRole("status", { name: "保存状態" })).toHaveTextContent("未保存");

    rerender(<PersistentEditorSession show={false} />);
    expect(screen.queryByLabelText("エディター本文")).not.toBeInTheDocument();

    rerender(<PersistentEditorSession show />);
    expect(await screen.findByLabelText("エディター本文")).toHaveValue(
      "unsaved route change",
    );
    expect(screen.getByRole("status", { name: "保存状態" })).toHaveTextContent("未保存");
  });

  it("inserts a dropped UTF-8 text file at the CodeMirror drop coordinates as an unsaved edit", async () => {
    render(<EditorPane workspaceRoot="/workspace" selectedPath="src/app.ts" />);

    expect(await screen.findByLabelText("エディター本文")).toHaveValue("app v1");
    const droppedFile = new File(["DROP"], "dropped.txt", { type: "text/plain" });
    Object.defineProperty(droppedFile, "arrayBuffer", {
      value: async () => new TextEncoder().encode("DROP").buffer,
    });
    const editorSurface = screen.getByLabelText("エディター本文").closest(".editor-surface");
    expect(editorSurface).not.toBeNull();

    fireEvent(editorSurface!, createFileDropEvent([droppedFile]));

    await waitFor(() => {
      expect(editorDropPosition).toHaveBeenCalledWith({ x: 32, y: 48 });
      expect(editorDispatches).toContainEqual({
        changes: { from: 4, insert: "DROP" },
        scrollIntoView: true,
        selection: { anchor: 8 },
      });
      expect(screen.getByLabelText("エディター本文")).toHaveValue("app DROPv1");
      expect(screen.getByRole("status", { name: "保存状態" })).toHaveTextContent("未保存");
    });
  });

  it("inserts multiple dropped files with one transaction and does not replace the selection", async () => {
    render(<EditorPane workspaceRoot="/workspace" selectedPath="src/app.ts" />);

    const editor = await screen.findByLabelText("エディター本文") as HTMLTextAreaElement;
    editor.setSelectionRange(0, 3);
    fireEvent.select(editor);
    const files = ["A", "B"].map((content) => {
      const file = new File([content], `${content}.txt`);
      Object.defineProperty(file, "arrayBuffer", {
        value: async () => new TextEncoder().encode(content).buffer,
      });
      return file;
    });
    const editorSurface = editor.closest(".editor-surface");

    fireEvent(editorSurface!, createFileDropEvent(files));

    await waitFor(() => {
      expect(editorDispatches.filter((transaction) => "changes" in (transaction as object))).toEqual([
        {
          changes: { from: 4, insert: "AB" },
          scrollIntoView: true,
          selection: { anchor: 6 },
        },
      ]);
      expect(editor).toHaveValue("app ABv1");
    });
  });

  it("keeps editor content unchanged when a dropped file is not valid UTF-8", async () => {
    render(<EditorPane workspaceRoot="/workspace" selectedPath="src/app.ts" />);

    const editor = await screen.findByLabelText("エディター本文");
    const invalidFile = new File(["invalid"], "invalid.txt");
    Object.defineProperty(invalidFile, "arrayBuffer", {
      value: async () => Uint8Array.from([0xff]).buffer,
    });
    const editorSurface = editor.closest(".editor-surface");

    fireEvent(editorSurface!, createFileDropEvent([invalidFile]));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "invalid.txt はUTF-8テキストではありません",
    );
    expect(editor).toHaveValue("app v1");
    expect(editorDispatches).toEqual([]);
  });
});
