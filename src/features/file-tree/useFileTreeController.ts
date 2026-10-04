import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { z } from "zod";
import { apiFetch } from "../../shared/client/apiTransport";
import { fetchFileTree } from "../workspace/workspaceFilesClient";
import {
  buildChildPath,
  buildRenamePath,
  buildTree,
  clampActionMenuPosition,
  flattenVisibleTree,
  getBasename,
  type FileTreeItem,
  type FileTreeNode,
  validateOperationName,
} from "./fileTreeModel";

const droppedFileImportResponseSchema = z.object({
  operation: z.literal("import"),
  orderedFilePaths: z.array(z.string()),
  parentPath: z.string(),
  path: z.string(),
});

const MAX_DROPPED_FILE_COUNT = 5;
const MAX_DROPPED_FILE_BYTES = 1024 * 1024;
const MAX_DROPPED_FILES_TOTAL_BYTES = 2 * 1024 * 1024;

export type FileTreeDropTarget = {
  insertBeforePath: string;
  parentPath: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

async function prepareDroppedFiles(files: File[]) {
  if (files.length === 0 || files.length > MAX_DROPPED_FILE_COUNT) {
    throw new Error(`一度に追加できるファイルは${MAX_DROPPED_FILE_COUNT}件までです`);
  }

  const prepared: Array<{ contentBase64: string; name: string }> = [];
  let totalBytes = 0;
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_DROPPED_FILE_BYTES) {
      throw new Error(`${file.name} は1 MiBを超えているため追加できません`);
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_DROPPED_FILES_TOTAL_BYTES) {
      throw new Error("追加するファイルの合計サイズは2 MiBまでです");
    }
    if (bytes.includes(0)) {
      throw new Error(`${file.name} はテキストファイルとして読み込めません`);
    }
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error(`${file.name} はUTF-8テキストではありません`);
    }
    prepared.push({ contentBase64: bytesToBase64(bytes), name: file.name });
  }
  return prepared;
}

export type FileOperationEvent =
  | { kind: "directory" | "file"; operation: "create"; path: string }
  | { operation: "delete"; path: string }
  | { newPath: string; operation: "rename"; path: string };

export type OperationMode = "create-directory" | "create-file" | "rename";
export type OperationTarget = Pick<FileTreeNode, "kind" | "path">;
type OperationAnchor = { kind: "root" } | { kind: "item"; path: string };
type ActionMenuState = { node: FileTreeNode; x: number; y: number };

type Options = {
  dirtyPaths: string[];
  onFileOperation?: (operation: FileOperationEvent) => void;
  onFileSelected(path: string): void;
  refreshKey: number;
  selectedPath: string | null;
  showNoisyDirectories: boolean;
  workspaceRoot: string | null;
};

export function useFileTreeController({
  dirtyPaths, onFileOperation, onFileSelected, refreshKey, selectedPath, showNoisyDirectories, workspaceRoot,
}: Options) {
  const [filter, setFilter] = useState("");
  const [items, setItems] = useState<FileTreeItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [operationMode, setOperationMode] = useState<OperationMode | null>(null);
  const [operationAnchor, setOperationAnchor] = useState<OperationAnchor | null>(null);
  const [operationName, setOperationName] = useState("");
  const [internalRefreshKey, setInternalRefreshKey] = useState(0);
  const [activeItem, setActiveItem] = useState<OperationTarget | null>(null);
  const [actionMenu, setActionMenu] = useState<ActionMenuState | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(() => new Set());
  const [activeDropTargetPath, setActiveDropTargetPath] = useState<string | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const operationFormRef = useRef<HTMLFormElement | null>(null);

  const clearOperationForm = () => { setOperationMode(null); setOperationAnchor(null); setOperationName(""); };
  const selectedOperationTarget = (target?: OperationTarget | null) => target ?? activeItem ?? (selectedPath ? { kind: "file" as const, path: selectedPath } : null);
  const hasDirtyFile = (targetPath: string) => dirtyPaths.some((path) => path === targetPath || path.startsWith(`${targetPath}/`));

  useEffect(() => {
    if (!workspaceRoot) { setItems([]); setErrorMessage(null); setIsTruncated(false); return; }
    const abortController = new AbortController();
    setIsLoading(true); setErrorMessage(null);
    fetchFileTree({
      filter,
      includeNoisyDirectories: showNoisyDirectories,
      signal: abortController.signal,
      workspaceRoot,
    })
      .then((body) => { setItems(body.items); setIsTruncated(body.truncated); })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setItems([]); setErrorMessage(error instanceof Error ? error.message : "ファイルツリーの取得に失敗しました");
      })
      .finally(() => { if (!abortController.signal.aborted) setIsLoading(false); });
    return () => abortController.abort();
  }, [filter, internalRefreshKey, refreshKey, showNoisyDirectories, workspaceRoot]);

  useEffect(() => { setCollapsedDirectories(new Set()); setActiveItem(null); setActionMenu(null); clearOperationForm(); setFilter(""); setIsFilterOpen(false); }, [workspaceRoot]);
  useEffect(() => { if (isFilterOpen) filterInputRef.current?.focus(); }, [isFilterOpen]);
  useEffect(() => {
    if (!operationMode) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && operationFormRef.current?.contains(target)) return;
      if (target instanceof Element && (target.closest(".file-tree-toolbar-action") || target.closest(".file-tree-action-button") || target.closest(".file-tree-action-menu"))) return;
      clearOperationForm();
    };
    document.addEventListener("click", onClick); return () => document.removeEventListener("click", onClick);
  }, [operationMode]);
  useEffect(() => {
    if (!actionMenu) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && (target.closest(".file-tree-action-menu") || target.closest(".file-tree-action-button"))) return;
      setActionMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setActionMenu(null); };
    document.addEventListener("mousedown", onMouseDown); document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("mousedown", onMouseDown); document.removeEventListener("keydown", onKeyDown); };
  }, [actionMenu]);

  const treeNodes = useMemo(() => buildTree(items), [items]);
  const isFiltering = filter.trim().length > 0;
  const canDropFiles =
    Boolean(workspaceRoot) && !isFiltering && !isTruncated && !isLoading;
  const visibleRows = useMemo(() => flattenVisibleTree(treeNodes, collapsedDirectories, isFiltering), [collapsedDirectories, isFiltering, treeNodes]);
  const visibleFiles = useMemo(() => items.filter((item) => item.kind === "file").length, [items]);
  const toggleDirectory = (path: string) => setCollapsedDirectories((current) => { const next = new Set(current); next.has(path) ? next.delete(path) : next.add(path); return next; });
  const activateTreeItem = (node: FileTreeNode) => { setActiveItem({ kind: node.kind, path: node.path }); if (node.kind === "directory") toggleDirectory(node.path); else onFileSelected(node.path); };
  const openActionMenu = (node: FileTreeNode, position: { x: number; y: number }) => { clearOperationForm(); setActiveItem({ kind: node.kind, path: node.path }); const menuPosition = clampActionMenuPosition(position.x, position.y, { height: window.innerHeight, width: window.innerWidth }); setActionMenu({ node, ...menuPosition }); setErrorMessage(null); };
  const openOperationForm = (mode: OperationMode, target?: OperationTarget | null) => {
    setErrorMessage(null); setActionMenu(null); setOperationMode(mode);
    if (mode === "rename") { const item = selectedOperationTarget(target); if (!item) { setErrorMessage("名前変更する項目を選択してください"); clearOperationForm(); } else if (hasDirtyFile(item.path)) { setErrorMessage("未保存の変更があるファイルは削除または名前変更できません"); clearOperationForm(); } else { setActiveItem(item); setOperationName(getBasename(item.path)); setOperationAnchor({ kind: "item", path: item.path }); } return; }
    setOperationName(""); setOperationAnchor(target?.kind === "directory" ? { kind: "item", path: target.path } : { kind: "root" });
  };
  const runFileOperation = async (operation: FileOperationEvent) => {
    if (!workspaceRoot) return;
    setIsLoading(true); setErrorMessage(null);
    try {
      const response = await apiFetch("/api/files/operations", { body: JSON.stringify({ ...operation, workspaceRoot }), headers: { "content-type": "application/json" }, method: "POST" });
      const body: unknown = await response.json();
      if (!response.ok) { const parsed = z.object({ message: z.string() }).safeParse(body); throw new Error(parsed.success ? parsed.data.message : "ファイル操作に失敗しました"); }
      clearOperationForm(); setInternalRefreshKey((current) => current + 1); onFileOperation?.(operation);
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : "ファイル操作に失敗しました"); } finally { setIsLoading(false); }
  };
  const submitCurrentOperation = async () => {
    if (!operationMode) return;
    const validationError = validateOperationName(operationName); if (validationError) { setErrorMessage(validationError); return; }
    const name = operationName.trim();
    if (operationMode === "create-file" || operationMode === "create-directory") { const parentPath = operationAnchor?.kind === "item" ? operationAnchor.path : ""; await runFileOperation({ kind: operationMode === "create-file" ? "file" : "directory", operation: "create", path: buildChildPath(parentPath, name) }); return; }
    const target = selectedOperationTarget(); if (!target) { setErrorMessage("名前変更する項目を選択してください"); return; } if (hasDirtyFile(target.path)) { setErrorMessage("未保存の変更があるファイルは削除または名前変更できません"); return; }
    await runFileOperation({ newPath: buildRenamePath(target.path, name), operation: "rename", path: target.path });
  };
  const submitOperationForm = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); await submitCurrentOperation(); };
  const deleteSelectedItem = async (override?: OperationTarget | null) => { const target = selectedOperationTarget(override); setErrorMessage(null); setActionMenu(null); if (!target) { setErrorMessage("削除する項目を選択してください"); return; } if (hasDirtyFile(target.path)) { setErrorMessage("未保存の変更があるファイルは削除または名前変更できません"); return; } if (!window.confirm(`${target.path} を削除しますか?`)) return; await runFileOperation({ operation: "delete", path: target.path }); };
  const importDroppedFiles = async (
    files: File[],
    target: FileTreeDropTarget,
  ) => {
    if (!workspaceRoot || !canDropFiles) {
      setErrorMessage(
        isFiltering
          ? "フィルター中はファイルの追加位置を確定できません"
          : isTruncated
            ? "100件を超えるツリーではファイルの追加位置を確定できません"
            : "現在はファイルを追加できません",
      );
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setActiveDropTargetPath(null);
    let importedCount = 0;
    let lastImportedPath: string | null = null;
    try {
      const preparedFiles = await prepareDroppedFiles(files);
      for (const file of preparedFiles) {
        const response = await apiFetch("/api/files/import", {
          body: JSON.stringify({
            ...file,
            insertBeforePath: target.insertBeforePath,
            parentPath: target.parentPath,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const body: unknown = await response.json();
        if (!response.ok) {
          const parsed = z.object({ message: z.string() }).safeParse(body);
          throw new Error(
            parsed.success ? parsed.data.message : "ファイルの追加に失敗しました",
          );
        }
        const imported = droppedFileImportResponseSchema.parse(body);
        importedCount += 1;
        lastImportedPath = imported.path;
        onFileOperation?.({
          kind: "file",
          operation: "create",
          path: imported.path,
        });
      }

      setInternalRefreshKey((current) => current + 1);
      if (lastImportedPath) {
        onFileSelected(lastImportedPath);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "ファイルの追加に失敗しました";
      setErrorMessage(
        importedCount > 0
          ? `${importedCount}件を追加しましたが、続くファイルの追加に失敗しました: ${message}`
          : message,
      );
      if (importedCount > 0) {
        setInternalRefreshKey((current) => current + 1);
        if (lastImportedPath) {
          onFileSelected(lastImportedPath);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };
  const clearFilter = () => { setFilter(""); setIsFilterOpen(true); requestAnimationFrame(() => filterInputRef.current?.focus()); };
  const closeFilter = () => { setFilter(""); setIsFilterOpen(false); };
  return { actionMenu, activateTreeItem, activeDropTargetPath, canDropFiles, clearFilter, clearOperationForm, closeFilter, collapsedDirectories, deleteSelectedItem, errorMessage, filter, filterInputRef, importDroppedFiles, isFiltering, isFilterOpen, isLoading, isTruncated, items, openActionMenu, openOperationForm, operationAnchor, operationFormRef, operationMode, operationName, setActiveDropTargetPath, setFilter, setIsFilterOpen, setOperationName, submitCurrentOperation, submitOperationForm, visibleFiles, visibleRows };
}
