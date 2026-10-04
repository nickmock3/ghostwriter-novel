import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderPage } from "./ReaderPage";

const contentsByPath: Record<string, string> = {
  "小説/第001章/本文.txt": "第一章\n前｜漢字《かんじ》後",
  "小説/第002章/本文.txt": "第二章\n次の本文",
};

function mockReaderFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), window.location.origin);
    if (url.pathname === "/api/files/tree") {
      return Response.json({
        items: [
          { kind: "directory", path: "小説/第001章" },
          { kind: "file", path: "小説/第001章/本文.txt" },
          { kind: "directory", path: "小説/第002章" },
          { kind: "file", path: "小説/第002章/本文.txt" },
        ],
        limit: 100,
        truncated: false,
      });
    }

    const path = url.searchParams.get("path") ?? "";
    return Response.json({ content: contentsByPath[path] ?? "", path });
  });
}

function selectText(node: Node, start: number, end: number) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("ReaderPage selection jump", () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    vi.unstubAllGlobals();
  });

  it("opens a focused menu and reports the selected ruby base source range", async () => {
    vi.stubGlobal("fetch", mockReaderFetch());
    const onOpenEditorSelection = vi.fn();
    render(
      <ReaderPage
        onOpenEditorSelection={onOpenEditorSelection}
        workspaceRoot="/workspace"
      />,
    );

    const rubyBase = await screen.findByText("漢字");
    selectText(rubyBase.firstChild!, 0, 2);
    fireEvent.contextMenu(screen.getByLabelText("章本文"), {
      clientX: 64,
      clientY: 72,
    });

    const action = screen.getByRole("menuitem", { name: "エディットモードで開く" });
    await waitFor(() => expect(action).toHaveFocus());
    fireEvent.click(action);

    expect(onOpenEditorSelection).toHaveBeenCalledWith({
      end: 13,
      path: "小説/第001章/本文.txt",
      sourceExcerpt: "｜漢字《かんじ》",
      start: 5,
    });
  });

  it("does not offer a jump for a title, ruby reading, or empty selection", async () => {
    vi.stubGlobal("fetch", mockReaderFetch());
    render(
      <ReaderPage onOpenEditorSelection={vi.fn()} workspaceRoot="/workspace" />,
    );

    const manuscriptBody = await screen.findByLabelText("章本文");
    const title = screen.getAllByText("第一章").find((element) =>
      element.closest(".reader-mode-manuscript-title"),
    );
    expect(title).toBeDefined();
    selectText(title!.firstChild!, 0, 2);
    fireEvent.contextMenu(manuscriptBody);
    expect(screen.queryByRole("menu", { name: "選択した本文の操作" })).not.toBeInTheDocument();

    const rubyReading = screen.getByText("かんじ");
    selectText(rubyReading.firstChild!, 0, 2);
    fireEvent.contextMenu(manuscriptBody);
    expect(screen.queryByRole("menu", { name: "選択した本文の操作" })).not.toBeInTheDocument();

    selectText(screen.getByText("漢字").firstChild!, 1, 1);
    fireEvent.contextMenu(manuscriptBody);
    expect(screen.queryByRole("menu", { name: "選択した本文の操作" })).not.toBeInTheDocument();
  });

  it("dismisses the selection menu with Escape, outside pointer, and chapter changes", async () => {
    vi.stubGlobal("fetch", mockReaderFetch());
    render(
      <ReaderPage onOpenEditorSelection={vi.fn()} workspaceRoot="/workspace" />,
    );

    const manuscriptBody = await screen.findByLabelText("章本文");
    const rubyBase = screen.getByText("漢字");
    selectText(rubyBase.firstChild!, 0, 2);
    fireEvent.contextMenu(manuscriptBody);
    expect(screen.getByRole("menu", { name: "選択した本文の操作" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "選択した本文の操作" })).not.toBeInTheDocument();
    await waitFor(() => expect(manuscriptBody).toHaveFocus());

    selectText(rubyBase.firstChild!, 0, 2);
    fireEvent.contextMenu(manuscriptBody);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu", { name: "選択した本文の操作" })).not.toBeInTheDocument();

    selectText(rubyBase.firstChild!, 0, 2);
    fireEvent.contextMenu(manuscriptBody);
    fireEvent.click(screen.getAllByRole("button", { name: "次の章" })[0]);
    expect(screen.queryByRole("menu", { name: "選択した本文の操作" })).not.toBeInTheDocument();
  });
});
