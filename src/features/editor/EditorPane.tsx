import CodeMirror, {
  EditorSelection,
  EditorView,
  type ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { createEditorExtensions } from "./codeMirrorConfig";
import { readDroppedEditorText } from "./droppedEditorTextFiles";
import { useFileSession, type FileSession } from "./useFileSession";
import type { AiAssistEditorTarget } from "../ai-assist/AiAssistPane";

export type EditorPaneSelectionRequest = {
  end: number;
  id: number;
  path: string;
  sourceExcerpt: string;
  start: number;
};

type EditorPaneProps = {
  aiAssistPaneRestoreControl?: ReactNode;
  fileSession?: FileSession;
  fileTreeRestoreControl?: ReactNode;
  onActivePathChange?: (path: string | null) => void;
  onAiAssistTargetChange?: (target: AiAssistEditorTarget | null) => void;
  onDirtyStateChange?: (path: string | null, isDirty: boolean) => void;
  onSelectionRequestConsumed?: (id: number) => void;
  refreshKey?: number;
  selectionRequest?: EditorPaneSelectionRequest | null;
  workspaceRoot: string | null;
  selectedPath: string | null;
  showLineNumbers?: boolean;
  wrapLines?: boolean;
};

type EditorPaneContentProps = EditorPaneProps & {
  fileSession: FileSession;
};

function EditorPaneWithLocalFileSession(props: EditorPaneProps) {
  const fileSession = useFileSession({
    onActivePathChange: props.onActivePathChange,
    onDirtyStateChange: props.onDirtyStateChange,
    refreshKey: props.refreshKey,
    selectedPath: props.selectedPath,
    workspaceRoot: props.workspaceRoot,
  });
  return <EditorPaneContent {...props} fileSession={fileSession} />;
}

export function EditorPane(props: EditorPaneProps) {
  return props.fileSession ? (
    <EditorPaneContent {...props} fileSession={props.fileSession} />
  ) : (
    <EditorPaneWithLocalFileSession {...props} />
  );
}

function EditorPaneContent({
  aiAssistPaneRestoreControl,
  fileSession,
  fileTreeRestoreControl,
  onAiAssistTargetChange,
  onSelectionRequestConsumed,
  selectionRequest,
  showLineNumbers = false,
  wrapLines = true,
}: EditorPaneContentProps) {
  const codeMirrorRef = useRef<ReactCodeMirrorRef | null>(null);
  const editorSurfaceRef = useRef<HTMLDivElement | null>(null);
  const handledSelectionRequestIdRef = useRef<number | null>(null);
  const selectionRef = useRef<{ end: number; start: number } | null>(null);
  const activeTabRef = useRef(fileSession.activeTab);
  const isSavingRef = useRef(fileSession.isSaving);
  const [droppedFileError, setDroppedFileError] = useState<string | null>(null);
  const [selectionRequestError, setSelectionRequestError] = useState<string | null>(null);

  const {
    activePath,
    activeTab,
    activateTab,
    characterCount,
    closeTab,
    isDirty,
    isSaving,
    saveFile,
    tabs,
    updateActiveContent,
  } = fileSession;
  activeTabRef.current = activeTab;
  isSavingRef.current = isSaving;

  const editorExtensions = useMemo(
    () => createEditorExtensions({ path: activeTab?.path ?? null, wrapLines }),
    [activeTab?.path, wrapLines],
  );

  useEffect(() => {
    if (selectionRequest) {
      setSelectionRequestError(null);
    }
  }, [selectionRequest?.id]);

  useEffect(() => {
    if (
      !selectionRequest ||
      handledSelectionRequestIdRef.current === selectionRequest.id ||
      !activeTab ||
      activeTab.path !== selectionRequest.path ||
      activeTab.isLoading
    ) {
      return;
    }

    const consumeRequest = () => {
      handledSelectionRequestIdRef.current = selectionRequest.id;
      onSelectionRequestConsumed?.(selectionRequest.id);
    };

    if (activeTab.errorMessage) {
      consumeRequest();
      return;
    }

    const isValidRange =
      Number.isInteger(selectionRequest.start) &&
      Number.isInteger(selectionRequest.end) &&
      selectionRequest.start >= 0 &&
      selectionRequest.start < selectionRequest.end &&
      selectionRequest.end <= activeTab.content.length;
    const sourceMatches =
      isValidRange &&
      activeTab.content.slice(selectionRequest.start, selectionRequest.end) ===
        selectionRequest.sourceExcerpt;

    if (!isValidRange || !sourceMatches) {
      setSelectionRequestError(
        "リーダーで選択した位置と現在の内容が一致しないため、選択範囲への移動を中止しました。未保存の内容は保持されています。",
      );
      consumeRequest();
      return;
    }

    const view = codeMirrorRef.current?.view;
    if (!view) {
      return;
    }

    const selection = EditorSelection.range(selectionRequest.end, selectionRequest.start);
    view.dispatch({
      effects: EditorView.scrollIntoView(selection, { y: "center" }),
      scrollIntoView: true,
      selection: {
        anchor: selectionRequest.end,
        head: selectionRequest.start,
      },
    });
    view.focus();
    setSelectionRequestError(null);
    consumeRequest();
  }, [activeTab, onSelectionRequestConsumed, selectionRequest]);

  const publishAiAssistTarget = useCallback(
    (
      content: string,
      path: string | null,
      dirty: boolean,
      selection: { end: number; start: number } | null,
    ) => {
      if (!path) {
        onAiAssistTargetChange?.(null);
        return;
      }

      onAiAssistTargetChange?.({
        content,
        isDirty: dirty,
        path,
        selection: dirty ? null : selection,
      });
    },
    [onAiAssistTargetChange],
  );

  useEffect(() => {
    if (!activeTab || activeTab.isLoading || activeTab.errorMessage) {
      onAiAssistTargetChange?.(null);
      return;
    }

    const tabIsDirty = activeTab.content !== activeTab.savedContent;
    publishAiAssistTarget(
      activeTab.content,
      activeTab.path,
      tabIsDirty,
      tabIsDirty ? null : selectionRef.current,
    );
  }, [
    activeTab?.content,
    activeTab?.errorMessage,
    activeTab?.isLoading,
    activeTab?.path,
    activeTab?.savedContent,
    onAiAssistTargetChange,
    publishAiAssistTarget,
  ]);

  function handleActivateTab(path: string | null) {
    selectionRef.current = null;
    activateTab(path);
  }

  function handleUpdateActiveContent(nextContent: string) {
    selectionRef.current = null;
    updateActiveContent(nextContent);
  }

  const updateEditorSelection = useCallback(
    (update: {
      state: {
        doc: { sliceString: (from: number, to: number) => string };
        selection: { main: { empty: boolean; from: number; to: number } };
      };
    }) => {
      const selection = update.state.selection.main;
      if (selection.empty) {
        selectionRef.current = null;
      } else {
        selectionRef.current = { end: selection.to, start: selection.from };
      }

      if (!activeTab || activeTab.content !== activeTab.savedContent) {
        return;
      }

      publishAiAssistTarget(activeTab.content, activeTab.path, false, selectionRef.current);
    },
    [activeTab, publishAiAssistTarget],
  );

  const handleEditorFileDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (
      event.dataTransfer.files.length > 0 ||
      Array.from(event.dataTransfer.types ?? []).includes("Files")
    ) {
      event.preventDefault();
      event.dataTransfer.dropEffect =
        activeTab && !activeTab.isLoading && !activeTab.errorMessage && !isSaving
          ? "copy"
          : "none";
    }
  };

  const handleEditorFileDrop = async (event: DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer.files);
    const nativeDropEvent = event.nativeEvent as globalThis.DragEvent;
    const dropCoordinates = {
      x: event.clientX ?? nativeDropEvent.clientX,
      y: event.clientY ?? nativeDropEvent.clientY,
    };
    if (files.length === 0) {
      if (Array.from(event.dataTransfer.types ?? []).includes("Files")) {
        event.preventDefault();
        event.stopPropagation();
        setDroppedFileError("追加するファイルを読み取れませんでした");
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setDroppedFileError(null);

    const droppedPath = activeTab?.path;
    const view = codeMirrorRef.current?.view;
    if (
      !activeTab ||
      activeTab.isLoading ||
      activeTab.errorMessage ||
      isSaving ||
      !view
    ) {
      setDroppedFileError("現在はエディターへファイルを追加できません");
      return;
    }

    try {
      const insertedText = await readDroppedEditorText(files);
      const currentTab = activeTabRef.current;
      if (
        !currentTab ||
        currentTab.path !== droppedPath ||
        currentTab.isLoading ||
        currentTab.errorMessage ||
        isSavingRef.current ||
        codeMirrorRef.current?.view !== view
      ) {
        setDroppedFileError(
          "ファイルの読み取り中に編集対象が変わったため、追加を中止しました",
        );
        return;
      }
      const position = view.posAtCoords(dropCoordinates);
      if (position === null) {
        setDroppedFileError("ドロップ位置を特定できないため、追加を中止しました");
        return;
      }

      view.dispatch({
        changes: { from: position, insert: insertedText },
        scrollIntoView: true,
        selection: { anchor: position + insertedText.length },
      });
      view.focus();
    } catch (error) {
      setDroppedFileError(
        error instanceof Error
          ? error.message
          : "ドロップしたファイルを追加できませんでした",
      );
    }
  };

  return (
    <section className="pane editor-pane" aria-label="テキストエディター">
      {tabs.length > 0 ? (
        <div className="editor-tabs" role="tablist" aria-label="開いているファイル">
          {fileTreeRestoreControl ? (
            <div className="editor-tabs-leading">{fileTreeRestoreControl}</div>
          ) : null}
          <div className="editor-tabs-scroll">
            {tabs.map((tab) => {
              const tabIsDirty = tab.content !== tab.savedContent;
              return (
                <div className="editor-tab-item" key={tab.path}>
                  <div
                    className="editor-tab"
                    role="tab"
                    aria-label={`${tab.path}${tabIsDirty ? " 未保存" : ""}`}
                    aria-selected={tab.path === activePath}
                    tabIndex={tab.path === activePath ? 0 : -1}
                    onClick={() => handleActivateTab(tab.path)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleActivateTab(tab.path);
                      }
                    }}
                  >
                    <span aria-hidden="true">=</span>
                    <strong>{tab.path}</strong>
                    {tabIsDirty ? <span className="dirty-dot">未保存</span> : null}
                    <button
                      type="button"
                      className="editor-tab-close-button"
                      aria-label={`${tab.path} を閉じる`}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeTab(tab.path);
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {aiAssistPaneRestoreControl ? (
            <div className="editor-tabs-trailing">{aiAssistPaneRestoreControl}</div>
          ) : null}
        </div>
      ) : (
        <div
          className="editor-tabs editor-tabs-spacer"
          data-testid="editor-tabs-spacer"
          aria-hidden={fileTreeRestoreControl || aiAssistPaneRestoreControl ? undefined : true}
        >
          {fileTreeRestoreControl ? (
            <div className="editor-tabs-leading">{fileTreeRestoreControl}</div>
          ) : null}
          <div className="editor-tabs-scroll" aria-hidden="true" />
          {aiAssistPaneRestoreControl ? (
            <div className="editor-tabs-trailing">{aiAssistPaneRestoreControl}</div>
          ) : null}
        </div>
      )}
      <div className="editor-toolbar">
        <span className="opened-path">Plain Text</span>
        <button
          type="button"
          className="secondary-action"
          disabled={!activeTab || !isDirty || isSaving || activeTab.externalContent !== undefined}
          onClick={saveFile}
        >
          {isSaving ? "保存中..." : "保存"}
        </button>
      </div>
      {activeTab?.isLoading ? <p className="pane-empty">読み込み中...</p> : null}
      {activeTab?.errorMessage ? (
        <div className="pane-error" role="alert">
          {activeTab.errorMessage}
        </div>
      ) : null}
      {activeTab?.externalContent !== undefined ? (
        <div className="pane-warning" role="alert">
          ファイルが別の操作で更新されました。未保存の内容は保持しています。必要な文章をコピーしてから更新内容を読み込んでください。
          <button type="button" className="secondary-action" onClick={fileSession.loadExternalContent}>
            更新内容を読み込む
          </button>
        </div>
      ) : null}
      {selectionRequestError ? (
        <div className="pane-warning" role="alert">
          {selectionRequestError}
        </div>
      ) : null}
      {droppedFileError ? (
        <div className="pane-warning" role="alert">
          {droppedFileError}
        </div>
      ) : null}
      {activeTab ? (
        <div
          className="editor-surface"
          ref={editorSurfaceRef}
          onDragOver={handleEditorFileDragOver}
          onDrop={(event) => void handleEditorFileDrop(event)}
        >
          <CodeMirror
            value={activeTab.content}
            minHeight="100%"
            basicSetup={{
              foldGutter: true,
              lineNumbers: showLineNumbers,
            }}
            extensions={editorExtensions}
            onChange={handleUpdateActiveContent}
            onCreateEditor={(view, state) => {
              codeMirrorRef.current = { editor: null, state, view };
            }}
            onUpdate={updateEditorSelection}
          />
        </div>
      ) : (
        <div
          className="editor-surface editor-placeholder"
          role="textbox"
          aria-readonly="true"
          onDragOver={handleEditorFileDragOver}
          onDrop={(event) => void handleEditorFileDrop(event)}
        >
          ワークスペースを選択し、テキストファイルを開くとここで編集できます。
        </div>
      )}
      <div className="editor-status-bar">
        <span aria-label="文字数">{characterCount}文字</span>
        <span>{isDirty ? "Unsaved" : "Saved"}</span>
      </div>
    </section>
  );
}
