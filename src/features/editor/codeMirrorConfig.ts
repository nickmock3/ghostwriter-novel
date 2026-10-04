import { EditorView, keymap } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { openSearchPanel } from "@codemirror/search";

const novelWritingTheme = EditorView.theme({
  "&": {
    backgroundColor: "#fffdf8",
    color: "#1f2933",
  },
  ".cm-content": {
    caretColor: "#0f766e",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "#0f766e",
    borderLeftWidth: "2px",
  },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "#0f766e",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "#cce8e2",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(255, 243, 214, 0.35)",
  },
  ".cm-gutters": {
    backgroundColor: "#fffdf8",
    color: "#8a94a6",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(255, 243, 214, 0.35)",
    color: "#435264",
  },
});

const searchJapanesePhrases = EditorState.phrases.of({
  Find: "検索",
  Replace: "置換",
  next: "次へ",
  previous: "前へ",
  all: "すべて",
  "match case": "大文字小文字",
  regexp: "正規表現",
  "by word": "単語単位",
  replace: "置換",
  "replace all": "すべて置換",
  close: "閉じる",
  "replaced $ matches": "$ 件を置換",
});

const localizedSearchKeymap = keymap.of([
  { key: "Mod-f", run: openSearchPanel, scope: "editor search-panel" },
]);

const searchPanelTheme = EditorView.theme({
  ".cm-panel.cm-search": {
    backgroundColor: "#f8fafc",
    borderBottom: "1px solid #e2e7ee",
    color: "#697386",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: "0.82rem",
    padding: "8px 36px 8px 10px",
    position: "relative",
  },
  ".cm-search": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px 8px",
    width: "100%",
  },
  ".cm-panel.cm-search .cm-textfield": {
    border: "1px solid #d8dee8",
    borderRadius: "6px",
    backgroundColor: "#ffffff",
    color: "#1f2933",
    flex: "1 1 9rem",
    fontSize: "0.82rem",
    lineHeight: "1.3",
    margin: "0",
    minWidth: "0",
    padding: "5px 8px",
  },
  ".cm-panel.cm-search input[name=replace]": {
    flexBasis: "100%",
  },
  ".cm-panel.cm-search .cm-textfield:focus": {
    borderColor: "#0f766e",
    outline: "2px solid rgba(15, 118, 110, 0.18)",
    outlineOffset: "1px",
  },
  ".cm-panel.cm-search .cm-button, .cm-panel.cm-search button": {
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    backgroundColor: "#ffffff",
    color: "#344154",
    cursor: "pointer",
    flex: "0 0 auto",
    fontSize: "0.78rem",
    fontWeight: "650",
    lineHeight: "1.1",
    margin: "0",
    padding: "5px 9px",
    whiteSpace: "nowrap",
  },
  ".cm-panel.cm-search .cm-button:hover, .cm-panel.cm-search button:hover": {
    borderColor: "#9aa7b8",
    backgroundColor: "#f8fafc",
    color: "#111827",
  },
  ".cm-panel.cm-search label": {
    alignItems: "center",
    color: "#697386",
    display: "inline-flex",
    flex: "0 0 auto",
    fontSize: "0.76rem",
    gap: "4px",
    margin: "0",
    whiteSpace: "nowrap",
  },
  ".cm-panel.cm-search input[type=checkbox]": {
    accentColor: "#0f766e",
    margin: "0",
  },
  ".cm-panel.cm-search br": {
    display: "none",
  },
  ".cm-panel.cm-search [name=close]": {
    position: "absolute",
    top: "6px",
    right: "6px",
    width: "24px",
    height: "24px",
    border: "1px solid transparent",
    borderRadius: "6px",
    backgroundColor: "transparent",
    color: "#697386",
    fontSize: "1rem",
    lineHeight: "1",
    margin: "0",
    padding: "0",
    transform: "none",
  },
  ".cm-panel.cm-search [name=close]:hover": {
    borderColor: "#d8dee8",
    backgroundColor: "#ffffff",
    color: "#111827",
  },
  ".cm-searchMatch": {
    backgroundColor: "#e8f4ef",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "#cce8e2",
    outline: "1px solid #7ec8bc",
  },
});

function extensionsForPath(path: string | null) {
  if (!path) {
    return [];
  }
  if (/\.(md|markdown)$/i.test(path)) {
    return [markdown()];
  }
  if (/\.(js|jsx|ts|tsx|json|mjs|cjs)$/i.test(path)) {
    return [javascript({ jsx: true, typescript: /\.(ts|tsx)$/i.test(path) })];
  }
  return [];
}

export type CreateEditorExtensionsOptions = {
  path: string | null;
  wrapLines: boolean;
};

export function createEditorExtensions({ path, wrapLines }: CreateEditorExtensionsOptions) {
  return [
    novelWritingTheme,
    searchPanelTheme,
    searchJapanesePhrases,
    localizedSearchKeymap,
    ...(wrapLines ? [EditorView.lineWrapping] : []),
    ...extensionsForPath(path),
  ];
}
