import { describe, expect, it, vi } from "vitest";

const { editorViewMock, javascriptMock, keymapMock, markdownMock } = vi.hoisted(() => ({
  editorViewMock: {
    lineWrapping: "line-wrapping-extension",
    theme: vi.fn(() => "theme-extension"),
  },
  javascriptMock: vi.fn((options: unknown) => ({ kind: "javascript", options })),
  keymapMock: { of: vi.fn(() => "localized-search-keymap-extension") },
  markdownMock: vi.fn(() => ({ kind: "markdown" })),
}));

vi.mock("@uiw/react-codemirror", () => ({
  EditorView: editorViewMock,
  keymap: keymapMock,
}));

vi.mock("@codemirror/lang-javascript", () => ({ javascript: javascriptMock }));
vi.mock("@codemirror/lang-markdown", () => ({ markdown: markdownMock }));
vi.mock("@codemirror/search", () => ({ openSearchPanel: vi.fn() }));
vi.mock("@codemirror/state", () => ({
  EditorState: { phrases: { of: vi.fn(() => "japanese-phrases-extension") } },
}));

import { createEditorExtensions } from "./codeMirrorConfig";

describe("createEditorExtensions", () => {
  it("combines shared writing/search settings, line wrapping, and Markdown language support", () => {
    const extensions = createEditorExtensions({ path: "notes/chapter.md", wrapLines: true });

    expect(extensions).toContain("line-wrapping-extension");
    expect(extensions).toContain("localized-search-keymap-extension");
    expect(extensions).toContainEqual({ kind: "markdown" });
  });

  it("uses TypeScript-aware JavaScript language support for TypeScript paths", () => {
    const extensions = createEditorExtensions({ path: "src/app.tsx", wrapLines: false });

    expect(extensions).not.toContain("line-wrapping-extension");
    expect(extensions).toContainEqual({
      kind: "javascript",
      options: { jsx: true, typescript: true },
    });
  });
});
