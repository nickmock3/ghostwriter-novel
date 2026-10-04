import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { apiFetch } from "../../shared/client/apiTransport";
import { fileContentResponseSchema } from "../workspace/workspaceFilesClient";

export type EditorTab = {
  content: string;
  errorMessage: string | null;
  externalContent?: string;
  isLoading: boolean;
  path: string;
  savedContent: string;
};

export type UseFileSessionOptions = {
  onActivePathChange?: (path: string | null) => void;
  onDirtyStateChange?: (path: string | null, isDirty: boolean) => void;
  refreshKey?: number;
  selectedPath: string | null;
  workspaceRoot: string | null;
};

export type FileSession = ReturnType<typeof useFileSession>;

async function loadFile(root: string, path: string, signal: AbortSignal) {
  const url = new URL("/api/files/content", window.location.origin);
  url.searchParams.set("workspaceRoot", root);
  url.searchParams.set("path", path);

  return apiFetch(`${url.pathname}${url.search}`, { signal }).then(async (response) => {
    const body: unknown = await response.json();
    if (!response.ok) {
      const parsedError = z.object({ message: z.string() }).safeParse(body);
      throw new Error(
        parsedError.success ? parsedError.data.message : "ファイルを開けませんでした",
      );
    }
    return fileContentResponseSchema.parse(body);
  });
}

export function useFileSession({
  onActivePathChange,
  onDirtyStateChange,
  refreshKey = 0,
  selectedPath,
  workspaceRoot,
}: UseFileSessionOptions) {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const tabsRef = useRef(tabs);
  const previousRefreshKeyRef = useRef(refreshKey);
  const previousWorkspaceRootRef = useRef(workspaceRoot);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null;
  const isDirty = activeTab ? activeTab.content !== activeTab.savedContent : false;
  const characterCount = activeTab?.content.length ?? 0;

  useEffect(() => {
    if (previousWorkspaceRootRef.current !== workspaceRoot || !workspaceRoot) {
      setTabs([]);
      setActivePath(null);
      setIsSaving(false);
    }
    previousWorkspaceRootRef.current = workspaceRoot;
  }, [workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot || !selectedPath) {
      return;
    }

    const existingTab = tabsRef.current.find((tab) => tab.path === selectedPath);
    setActivePath(selectedPath);

    if (existingTab) {
      return;
    }

    const abortController = new AbortController();
    const pathToOpen = selectedPath;

    setTabs((currentTabs) => {
      if (currentTabs.some((tab) => tab.path === pathToOpen)) {
        return currentTabs;
      }
      return [
        ...currentTabs,
        {
          content: "",
          errorMessage: null,
          isLoading: true,
          path: pathToOpen,
          savedContent: "",
        },
      ];
    });

    loadFile(workspaceRoot, pathToOpen, abortController.signal)
      .then((body) => {
        setTabs((currentTabs) =>
          currentTabs.map((tab) =>
            tab.path === pathToOpen
              ? {
                  content: body.content,
                  errorMessage: null,
                  isLoading: false,
                  path: body.path,
                  savedContent: body.content,
                }
              : tab,
          ),
        );
        setActivePath(body.path);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setTabs((currentTabs) =>
          currentTabs.map((tab) =>
            tab.path === pathToOpen
              ? {
                  ...tab,
                  content: "",
                  errorMessage:
                    error instanceof Error ? error.message : "ファイルを開けませんでした",
                  isLoading: false,
                  savedContent: "",
                }
              : tab,
          ),
        );
      });

    return () => abortController.abort();
  }, [selectedPath, workspaceRoot]);

  useEffect(() => {
    if (previousRefreshKeyRef.current === refreshKey) {
      return;
    }

    previousRefreshKeyRef.current = refreshKey;

    if (!workspaceRoot) {
      return;
    }

    const abortController = new AbortController();
    // Refresh the retained session, without activating tabs or interrupting typing.
    tabsRef.current.forEach((snapshot) => {
      if (snapshot.isLoading) return;
      void loadFile(workspaceRoot, snapshot.path, abortController.signal)
        .then((body) => {
          if (abortController.signal.aborted) return;
          setTabs((currentTabs) =>
            currentTabs.map((tab) => {
              // A save completed since this request started; its result takes precedence.
              if (tab.path !== snapshot.path || tab.isLoading || tab.savedContent !== snapshot.savedContent) {
                return tab;
              }
              if (tab.content !== tab.savedContent && body.content !== tab.savedContent) {
                return { ...tab, errorMessage: null, externalContent: body.content };
              }
              if (body.content === tab.savedContent) {
                return { ...tab, errorMessage: null, externalContent: undefined };
              }
              return {
                ...tab,
                content: body.content,
                savedContent: body.content,
                errorMessage: null,
                externalContent: undefined,
              };
            }),
          );
        })
        .catch((error: unknown) => {
          if (abortController.signal.aborted) return;
          setTabs((currentTabs) => currentTabs.map((tab) =>
            tab.path === snapshot.path
              ? { ...tab, errorMessage: error instanceof Error ? error.message : "ファイルを開けませんでした" }
              : tab,
          ));
        });
    });

    return () => abortController.abort();
  }, [refreshKey, workspaceRoot]);

  useEffect(() => {
    onDirtyStateChange?.(activeTab?.path ?? null, isDirty);
  }, [activeTab?.path, isDirty, onDirtyStateChange]);

  function activateTab(path: string | null) {
    setActivePath(path);
    onActivePathChange?.(path);
  }

  function updateActiveContent(nextContent: string) {
    if (!activeTab) {
      return;
    }

    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.path === activeTab.path ? { ...tab, content: nextContent } : tab,
      ),
    );
  }

  function closeTab(path: string) {
    const currentTabs = tabsRef.current;
    const tab = currentTabs.find((currentTab) => currentTab.path === path);
    if (!tab) {
      return;
    }

    if (tab.content !== tab.savedContent) {
      const shouldDiscard = window.confirm(
        `${path} には未保存の変更があります。破棄して閉じますか？`,
      );
      if (!shouldDiscard) {
        return;
      }
    }

    const closingIndex = currentTabs.findIndex((currentTab) => currentTab.path === path);
    const nextTabs = currentTabs.filter((currentTab) => currentTab.path !== path);
    setTabs(nextTabs);

    if (path === activePath) {
      const nextActiveTab = nextTabs[Math.max(0, closingIndex - 1)] ?? nextTabs[0] ?? null;
      activateTab(nextActiveTab?.path ?? null);
    }
  }

  function loadExternalContent() {
    if (!activeTab || activeTab.externalContent === undefined) return;
    if (
      activeTab.content !== activeTab.savedContent &&
      !window.confirm(`${activeTab.path} の未保存の変更を破棄し、更新内容を読み込みますか？`)
    ) return;
    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.path === activeTab.path && tab.externalContent !== undefined
          ? {
              ...tab,
              content: tab.externalContent,
              savedContent: tab.externalContent,
              externalContent: undefined,
              errorMessage: null,
            }
          : tab,
      ),
    );
  }

  async function saveFile() {
    if (!workspaceRoot || !activeTab || activeTab.externalContent !== undefined) {
      return;
    }

    setIsSaving(true);
    const pathToSave = activeTab.path;
    const contentToSave = activeTab.content;
    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.path === pathToSave ? { ...tab, errorMessage: null } : tab,
      ),
    );

    try {
      const response = await apiFetch("/api/files/content", {
        body: JSON.stringify({
          content: contentToSave,
          path: pathToSave,
          workspaceRoot,
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const parsedError = z.object({ message: z.string() }).safeParse(body);
        throw new Error(
          parsedError.success ? parsedError.data.message : "ファイルを保存できませんでした",
        );
      }
      const parsedBody = fileContentResponseSchema.parse(body);
      setTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.path === pathToSave
            ? {
                ...tab,
                content: parsedBody.content,
                errorMessage: null,
                path: parsedBody.path,
                savedContent: parsedBody.content,
              }
            : tab,
        ),
      );
      setActivePath(parsedBody.path);
    } catch (error) {
      setTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.path === pathToSave
            ? {
                ...tab,
                errorMessage:
                  error instanceof Error ? error.message : "ファイルを保存できませんでした",
              }
            : tab,
        ),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return {
    activePath,
    activeTab,
    activateTab,
    characterCount,
    closeTab,
    isDirty,
    isSaving,
    loadExternalContent,
    saveFile,
    tabs,
    updateActiveContent,
  };
}
