import { Fragment, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FiEdit2, FiFolderPlus, FiSearch, FiTrash2, FiX } from "react-icons/fi";
import { getWorkspaceFolderName } from "../workspace/workspaceFolderName";
import type { FileOperationEvent } from "./useFileTreeController";
import { useFileTreeController } from "./useFileTreeController";
import { getFileDropTarget } from "./fileTreeModel";

type Props = {
  collapseControl?: ReactNode; dirtyPaths?: string[]; footer?: ReactNode;
  onFileOperation?: (operation: FileOperationEvent) => void; refreshKey?: number;
  showNoisyDirectories?: boolean; workspaceRoot: string | null; selectedPath: string | null;
  onFileSelected(path: string): void;
};

export function FileTreePane({ collapseControl, dirtyPaths = [], footer, onFileOperation, refreshKey = 0, showNoisyDirectories = false, workspaceRoot, selectedPath, onFileSelected }: Props) {
  const controller = useFileTreeController({ dirtyPaths, onFileOperation, onFileSelected, refreshKey, selectedPath, showNoisyDirectories, workspaceRoot });
  const operationForm = () => {
    if (!controller.operationMode || controller.operationMode === "rename") return null;
    return <form ref={controller.operationFormRef} className="file-operation-form" onSubmit={(event) => void controller.submitOperationForm(event)}>
      <label className="filter-field"><span>作成する名前</span><input type="text" aria-label="作成する名前" disabled={!workspaceRoot || controller.isLoading} value={controller.operationName} onChange={(event) => controller.setOperationName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); controller.clearOperationForm(); } }} /></label>
      <div className="file-operation-actions"><button type="submit" className="secondary-action" disabled={!workspaceRoot || controller.isLoading}>作成する</button><button type="button" className="secondary-action" disabled={controller.isLoading} onClick={controller.clearOperationForm}>キャンセル</button></div>
    </form>;
  };
  const renameForm = () => <form ref={controller.operationFormRef} className="file-rename-form" onClick={(event) => event.stopPropagation()} onSubmit={(event) => void controller.submitOperationForm(event)}>
    <input type="text" aria-label="名前" className="file-rename-input" disabled={!workspaceRoot || controller.isLoading} value={controller.operationName} autoFocus onChange={(event) => controller.setOperationName(event.target.value)} onFocus={(event) => event.currentTarget.select()} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); controller.clearOperationForm(); } else if (event.key === "Enter") { event.preventDefault(); void controller.submitCurrentOperation(); } }} />
  </form>;
  const actionMenu = controller.actionMenu ? (() => {
    const { node, x, y } = controller.actionMenu; const target = { kind: node.kind, path: node.path }; const label = `${node.name} の操作`;
    return createPortal(<div className="file-tree-action-menu" role="menu" aria-label={label} style={{ left: `${x}px`, position: "fixed", top: `${y}px` }}>
      {node.kind === "directory" ? <><button type="button" role="menuitem" onClick={() => controller.openOperationForm("create-file", target)}>ファイルを作成</button><button type="button" role="menuitem" onClick={() => controller.openOperationForm("create-directory", target)}>ディレクトリを作成</button></> : null}
      <button type="button" role="menuitem" onClick={() => controller.openOperationForm("rename", target)}>名前を変更</button><button type="button" role="menuitem" onClick={() => void controller.deleteSelectedItem(target)}>削除</button>
    </div>, document.body);
  })() : null;
  const blockUnhandledFileDrop = (event: DragEvent<HTMLElement>) => {
    if (Array.from(event.dataTransfer.types).includes("Files")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "none";
    }
  };
  return <aside className="pane file-tree-pane" aria-label="ファイルツリー" onDragOver={blockUnhandledFileDrop} onDrop={blockUnhandledFileDrop}>
    <div className="pane-heading">{collapseControl ? <div className="pane-heading-leading">{collapseControl}</div> : null}<h2>EXPLORER</h2><div className="pane-heading-actions">
      <button type="button" className="icon-action file-tree-toolbar-action" disabled={!workspaceRoot} aria-label="ファイルを作成" onClick={() => controller.openOperationForm("create-file")}>+</button>
      <button type="button" className="icon-action file-tree-toolbar-action" disabled={!workspaceRoot} aria-label="フォルダを作成" onClick={() => controller.openOperationForm("create-directory")}><FiFolderPlus aria-hidden="true" focusable="false" /></button>
      <button type="button" className="icon-action file-tree-toolbar-action file-tree-rename-action" disabled={!workspaceRoot} aria-label="選択中の項目名を変更" onClick={() => controller.openOperationForm("rename")}><FiEdit2 aria-hidden="true" focusable="false" /></button>
      <button type="button" className="icon-action file-tree-toolbar-action" disabled={!workspaceRoot} aria-label="選択中の項目を削除" onClick={() => void controller.deleteSelectedItem()}><FiTrash2 aria-hidden="true" focusable="false" /></button>
    </div></div>
    <div className="workspace-tree-root"><span title={workspaceRoot ?? undefined}>{workspaceRoot ? getWorkspaceFolderName(workspaceRoot) : "NO WORKSPACE"}</span><span className="file-count">{controller.items.length}</span><button type="button" className="icon-action" disabled={!workspaceRoot} aria-label="ファイルフィルターを開く" aria-expanded={controller.isFilterOpen} onClick={() => controller.setIsFilterOpen(true)}><FiSearch aria-hidden="true" focusable="false" /></button></div>
    {controller.isFilterOpen ? <div className="file-filter-bar"><label className="filter-field file-filter-field"><span>ファイルを絞り込む</span><input ref={controller.filterInputRef} type="search" placeholder="名前で絞り込み" disabled={!workspaceRoot} value={controller.filter} onChange={(event) => controller.setFilter(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); controller.closeFilter(); } }} /></label><button type="button" className="icon-action" disabled={!workspaceRoot} aria-label={controller.filter ? "ファイルフィルターをクリア" : "ファイルフィルターを閉じる"} onClick={controller.filter ? controller.clearFilter : controller.closeFilter}><FiX aria-hidden="true" focusable="false" /></button></div> : null}
    {!workspaceRoot ? <p className="pane-empty">ワークスペースを選択するとファイルを表示します。</p> : null}{controller.isLoading ? <p className="pane-empty">読み込み中...</p> : null}{controller.errorMessage ? <div className="pane-error" role="alert">{controller.errorMessage}</div> : null}{controller.isTruncated ? <p className="pane-warning">100件まで表示しています。フィルターで絞り込んでください。</p> : null}{workspaceRoot && !controller.isLoading && !controller.errorMessage && controller.visibleFiles === 0 ? <p className="pane-empty">表示できるファイルがありません。</p> : null}
    <div className="file-tree-scroll-area"><ul className="file-list" role="tree" aria-label="ファイルツリー">{controller.operationMode && controller.operationAnchor?.kind === "root" ? <li role="presentation">{operationForm()}</li> : null}{controller.visibleRows.map(({ node, depth }, rowIndex) => {
      const isDirectory = node.kind === "directory"; const isExpanded = isDirectory && (controller.isFiltering || !controller.collapsedDirectories.has(node.path)); const menuLabel = `${node.name} の操作`; const isRenaming = controller.operationMode === "rename" && controller.operationAnchor?.kind === "item" && controller.operationAnchor.path === node.path;
      const dropTarget = getFileDropTarget(controller.visibleRows[rowIndex - 1], { node });
      const previousNode = controller.visibleRows[rowIndex - 1]?.node;
      const dropLabel = previousNode ? `${previousNode.name} と ${node.name} の間にファイルを追加` : "";
      return <Fragment key={node.path}>{dropTarget && controller.canDropFiles ? <li className="file-tree-drop-slot" role="presentation"><div className={`file-tree-drop-target${controller.activeDropTargetPath === node.path ? " is-active" : ""}`} aria-label={dropLabel} onDragEnter={(event) => { event.preventDefault(); event.stopPropagation(); controller.setActiveDropTargetPath(node.path); }} onDragLeave={(event) => { event.preventDefault(); event.stopPropagation(); controller.setActiveDropTargetPath(null); }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy"; }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); controller.setActiveDropTargetPath(null); void controller.importDroppedFiles(Array.from(event.dataTransfer.files), dropTarget); }}><span aria-hidden="true" /></div></li> : null}<li role="presentation"><div className={isDirectory ? "file-tree-row file-tree-directory" : "file-tree-row file-tree-item"} role="treeitem" tabIndex={0} aria-label={node.name} aria-current={selectedPath === node.path ? "true" : undefined} aria-expanded={isDirectory ? isExpanded : undefined} aria-level={depth + 1} style={{ paddingInlineStart: `${10 + depth * 18}px` }} onClick={() => controller.activateTreeItem(node)} onContextMenu={(event) => { event.preventDefault(); controller.openActionMenu(node, { x: event.clientX, y: event.clientY }); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); controller.activateTreeItem(node); } else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); controller.openActionMenu(node, { x: rect.left, y: rect.bottom }); } }}>
        {isRenaming ? renameForm() : <><span className="file-tree-row-label">{node.name}</span><button type="button" className="file-tree-action-button" aria-label={menuLabel} aria-haspopup="menu" aria-expanded={controller.actionMenu?.node.path === node.path} onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); controller.openActionMenu(node, { x: rect.left, y: rect.bottom }); }}>⋯</button></>}
      </div>{controller.operationMode && controller.operationMode !== "rename" && controller.operationAnchor?.kind === "item" && controller.operationAnchor.path === node.path ? operationForm() : null}</li>
    </Fragment>;})}</ul></div>{actionMenu}{footer}
  </aside>;
}
