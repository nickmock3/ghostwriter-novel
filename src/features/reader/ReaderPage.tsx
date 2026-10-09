import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { FiChevronLeft, FiChevronRight } from "react-icons/fi";
import {
  fetchFileContent,
  fetchFileTree,
} from "../workspace/workspaceFilesClient";
import { deriveReaderChapters, type ReaderChapter } from "./readerChapters";
import { ReaderInlineContent } from "./ReaderInlineContent";
import {
  createReaderSelectionMap,
  mapReaderDomSelectionToSource,
} from "./readerSelectionMapping";

type ReaderPageProps = {
  onOpenEditorSelection: (request: {
    end: number;
    path: string;
    sourceExcerpt: string;
    start: number;
  }) => void;
  workspaceRoot: string | null;
};

type ReaderSelectionMenu = {
  end: number;
  path: string;
  sourceExcerpt: string;
  start: number;
  x: number;
  y: number;
};

function clampMenuPosition(x: number, y: number) {
  const margin = 8;
  const estimatedWidth = 220;
  const estimatedHeight = 48;
  return {
    x: Math.min(Math.max(x, margin), Math.max(margin, window.innerWidth - estimatedWidth - margin)),
    y: Math.min(Math.max(y, margin), Math.max(margin, window.innerHeight - estimatedHeight - margin)),
  };
}

export function ReaderPage({ onOpenEditorSelection, workspaceRoot }: ReaderPageProps) {
  const [chapters, setChapters] = useState<ReaderChapter[]>([]);
  const [contentsByPath, setContentsByPath] = useState<Record<string, string>>({});
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [copyState, setCopyState] = useState<"copied" | "idle">("idle");
  const [selectionMenu, setSelectionMenu] = useState<ReaderSelectionMenu | null>(null);
  const manuscriptBodyRef = useRef<HTMLDivElement | null>(null);
  const selectionMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!workspaceRoot) {
      setChapters([]);
      setContentsByPath({});
      setSelectedIndex(0);
      return;
    }

    const abortController = new AbortController();
    const activeWorkspaceRoot = workspaceRoot;
    setIsLoading(true);

    async function loadReaderData() {
      const parsedTree = await fetchFileTree({
        signal: abortController.signal,
        workspaceRoot: activeWorkspaceRoot,
      });
      const derivedChapters = deriveReaderChapters(parsedTree.items);
      if (derivedChapters.length === 0) {
        setChapters([]);
        setContentsByPath({});
        setSelectedIndex(0);
        return;
      }

      const nextContents: Record<string, string> = {};
      await Promise.all(
        derivedChapters.map(async (chapter) => {
          try {
            const body = await fetchFileContent({
              path: chapter.textPath,
              signal: abortController.signal,
              workspaceRoot: activeWorkspaceRoot,
            });
            nextContents[chapter.textPath] = body.content;
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
              throw error;
            }
          }
        }),
      );

      setContentsByPath(nextContents);
      setChapters(deriveReaderChapters(parsedTree.items, nextContents));
      setSelectedIndex(0);
    }

    void loadReaderData()
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setChapters([]);
        setContentsByPath({});
        setSelectedIndex(0);
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => abortController.abort();
  }, [workspaceRoot]);

  const selectedChapter = chapters[selectedIndex] ?? null;
  const previousChapter = selectedIndex > 0 ? chapters[selectedIndex - 1] : null;
  const nextChapter = selectedIndex < chapters.length - 1 ? chapters[selectedIndex + 1] : null;
  const selectedContent = selectedChapter ? (contentsByPath[selectedChapter.textPath] ?? "") : "";
  const selectedContentLines = selectedContent.split(/\n/);
  const selectionMapping = useMemo(
    () => createReaderSelectionMap(selectedContent),
    [selectedContent],
  );
  const lineVisibleStarts = useMemo(() => {
    let visibleOffset = 0;
    return selectedContentLines.map((line) => {
      const lineStart = visibleOffset;
      visibleOffset += createReaderSelectionMap(line).visibleText.length + 1;
      return lineStart;
    });
  }, [selectedContentLines]);
  const titleLineIndex = selectedContentLines.findIndex((line) => line.trim().length > 0);

  const closeSelectionMenu = useCallback(() => {
    setSelectionMenu(null);
  }, []);

  const openSelectionMenu = useCallback(
    (x: number, y: number) => {
      const manuscriptBody = manuscriptBodyRef.current;
      if (!manuscriptBody || !selectedChapter) {
        closeSelectionMenu();
        return false;
      }

      const sourceRange = mapReaderDomSelectionToSource(
        selectionMapping,
        window.getSelection(),
        manuscriptBody,
      );
      if (!sourceRange) {
        closeSelectionMenu();
        return false;
      }

      const position = clampMenuPosition(x, y);
      setSelectionMenu({
        ...position,
        ...sourceRange,
        path: selectedChapter.textPath,
        sourceExcerpt: selectedContent.slice(sourceRange.start, sourceRange.end),
      });
      return true;
    },
    [closeSelectionMenu, selectedChapter, selectedContent, selectionMapping],
  );

  const handleCopy = useCallback(async () => {
    if (!selectedContent) {
      return;
    }

    await navigator.clipboard.writeText(selectedContent);
    setCopyState("copied");
  }, [selectedContent]);

  useEffect(() => {
    setCopyState("idle");
    closeSelectionMenu();
  }, [closeSelectionMenu, selectedChapter?.textPath]);

  useEffect(() => {
    if (copyState !== "copied") {
      return;
    }

    const timeoutId = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [copyState]);

  useEffect(() => {
    if (!selectionMenu) {
      return;
    }

    selectionMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && selectionMenuRef.current?.contains(event.target)) {
        return;
      }
      closeSelectionMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      closeSelectionMenu();
      requestAnimationFrame(() => manuscriptBodyRef.current?.focus());
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeSelectionMenu, selectionMenu]);

  if (!workspaceRoot) {
    return (
      <section className="reader-mode-layout" aria-label="リーダーモード">
        <div className="reader-mode-empty-state">
          <p>ワークスペースが開かれていません。</p>
          <div className="reader-mode-empty-links">
            <Link className="secondary-action" to="/chat">
              チャットモードへ移動
            </Link>
            <Link className="secondary-action" to="/editor">
              エディットモードへ移動
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (!isLoading && chapters.length === 0) {
    return (
      <section className="reader-mode-layout" aria-label="リーダーモード">
        <div className="reader-mode-empty-state">
          <p>まだ読める本文がありません。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="reader-mode-layout" aria-label="リーダーモード">
      <div className="reader-mode-shell">
        <aside className="reader-mode-chapters" aria-label="章一覧">
          <h2 className="reader-mode-chapters-heading">章一覧</h2>
          <ul className="reader-mode-chapter-list">
            {chapters.map((chapter, index) => (
              <li key={chapter.textPath}>
                <button
                  type="button"
                  className="reader-mode-chapter-button"
                  aria-current={index === selectedIndex ? "true" : undefined}
                  onClick={() => {
                    closeSelectionMenu();
                    setSelectedIndex(index);
                  }}
                >
                  {chapter.title}
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <div className="reader-mode-content">
          {selectedChapter ? (
            <>
              <header className="reader-mode-content-header">
                <h2 className="reader-mode-content-title">{selectedChapter.title}</h2>
                <div className="reader-mode-content-actions">
                  <div className="reader-mode-header-pager" aria-label="章送り">
                    <button
                      type="button"
                      className="reader-mode-header-pager-button"
                      aria-label="前の章"
                      disabled={!previousChapter}
                      onClick={() => {
                        closeSelectionMenu();
                        setSelectedIndex((current) => Math.max(0, current - 1));
                      }}
                    >
                      <FiChevronLeft aria-hidden="true" focusable="false" />
                    </button>
                    <button
                      type="button"
                      className="reader-mode-header-pager-button"
                      aria-label="次の章"
                      disabled={!nextChapter}
                      onClick={() => {
                        closeSelectionMenu();
                        setSelectedIndex((current) =>
                          Math.min(chapters.length - 1, current + 1),
                        );
                      }}
                    >
                      <FiChevronRight aria-hidden="true" focusable="false" />
                    </button>
                  </div>
                  <button type="button" className="primary-action" onClick={() => void handleCopy()}>
                    {copyState === "copied" ? "コピーしました" : "本文をコピー"}
                  </button>
                </div>
              </header>
              <div className="reader-mode-manuscript">
                <article className="reader-mode-manuscript-inner">
                  <div
                    aria-label="章本文"
                    className="reader-mode-manuscript-body"
                    onContextMenu={(event) => {
                      if (openSelectionMenu(event.clientX, event.clientY)) {
                        event.preventDefault();
                      }
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key !== "ContextMenu" &&
                        !(event.key === "F10" && event.shiftKey)
                      ) {
                        return;
                      }
                      const selection = window.getSelection();
                      if (!selection || selection.rangeCount === 0) {
                        return;
                      }
                      const rect = selection.getRangeAt(0).getBoundingClientRect();
                      if (openSelectionMenu(rect.left, rect.bottom)) {
                        event.preventDefault();
                      }
                    }}
                    ref={manuscriptBodyRef}
                    tabIndex={0}
                  >
                    {selectedContentLines.map((line, index) => (
                      <p
                        className={
                          index === titleLineIndex ? "reader-mode-manuscript-title" : undefined
                        }
                        key={`${index}:${line}`}
                      >
                        <ReaderInlineContent
                          keyPrefix={`${index}:${line}`}
                          text={line}
                          visibleStart={lineVisibleStarts[index]}
                        />
                      </p>
                    ))}
                  </div>
                  <nav className="reader-mode-footer-nav" aria-label="章送り">
                    {previousChapter ? (
                      <button
                        type="button"
                        className="reader-mode-nav-card"
                        onClick={() => {
                          closeSelectionMenu();
                          setSelectedIndex((current) => Math.max(0, current - 1));
                        }}
                      >
                        <span className="reader-mode-nav-label">← 前の章</span>
                        <span className="reader-mode-nav-title">{previousChapter.title}</span>
                      </button>
                    ) : (
                      <span className="reader-mode-nav-card-spacer" aria-hidden="true" />
                    )}
                    {nextChapter ? (
                      <button
                        type="button"
                        className="reader-mode-nav-card reader-mode-nav-card--next"
                        onClick={() => {
                          closeSelectionMenu();
                          setSelectedIndex((current) =>
                            Math.min(chapters.length - 1, current + 1),
                          );
                        }}
                      >
                        <span className="reader-mode-nav-label">次の章 →</span>
                        <span className="reader-mode-nav-title">{nextChapter.title}</span>
                      </button>
                    ) : (
                      <span className="reader-mode-nav-card-spacer" aria-hidden="true" />
                    )}
                  </nav>
                </article>
              </div>
            </>
          ) : null}
        </div>
      </div>
      {selectionMenu
        ? createPortal(
            <div
              aria-label="選択した本文の操作"
              className="reader-selection-menu"
              ref={selectionMenuRef}
              role="menu"
              style={{
                left: `${selectionMenu.x}px`,
                position: "fixed",
                top: `${selectionMenu.y}px`,
              }}
            >
              <button
                onClick={() => {
                  onOpenEditorSelection({
                    end: selectionMenu.end,
                    path: selectionMenu.path,
                    sourceExcerpt: selectionMenu.sourceExcerpt,
                    start: selectionMenu.start,
                  });
                  closeSelectionMenu();
                }}
                role="menuitem"
                type="button"
              >
                エディットモードで開く
              </button>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
