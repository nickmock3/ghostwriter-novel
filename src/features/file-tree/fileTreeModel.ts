export type FileTreeItem = {
  kind: "directory" | "file";
  path: string;
};

export type FileTreeNode = FileTreeItem & {
  children: FileTreeNode[];
  name: string;
};

const ACTION_MENU_WIDTH = 180;
const ACTION_MENU_ESTIMATED_HEIGHT = 160;
const VIEWPORT_MARGIN = 8;

export function getBasename(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

export function getParentPath(path: string) {
  const segments = path.split("/").filter(Boolean);
  return segments.length <= 1 ? "" : segments.slice(0, -1).join("/");
}

export function getFileDropTarget(
  previousRow: { node: FileTreeNode } | undefined,
  currentRow: { node: FileTreeNode },
): { insertBeforePath: string; parentPath: string } | null {
  if (
    !previousRow ||
    previousRow.node.kind !== "file" ||
    currentRow.node.kind !== "file"
  ) {
    return null;
  }

  const previousParentPath = getParentPath(previousRow.node.path);
  const currentParentPath = getParentPath(currentRow.node.path);
  if (previousParentPath !== currentParentPath) {
    return null;
  }

  return {
    insertBeforePath: currentRow.node.path,
    parentPath: currentParentPath,
  };
}

export function buildChildPath(parentPath: string, name: string) {
  return parentPath ? `${parentPath}/${name}` : name;
}

export function buildRenamePath(path: string, name: string) {
  return buildChildPath(getParentPath(path), name);
}

export function validateOperationName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "名前を入力してください";
  return trimmed.includes("/") ? "名前に / は使えません" : null;
}

export function clampActionMenuPosition(
  x: number,
  y: number,
  viewport: { height: number; width: number },
) {
  const maxX = Math.max(VIEWPORT_MARGIN, viewport.width - ACTION_MENU_WIDTH - VIEWPORT_MARGIN);
  const maxY = Math.max(VIEWPORT_MARGIN, viewport.height - ACTION_MENU_ESTIMATED_HEIGHT - VIEWPORT_MARGIN);
  return { x: Math.min(Math.max(x, VIEWPORT_MARGIN), maxX), y: Math.min(Math.max(y, VIEWPORT_MARGIN), maxY) };
}

function ensureDirectory(nodesByPath: Map<string, FileTreeNode>, path: string): FileTreeNode {
  const existing = nodesByPath.get(path);
  if (existing) return existing;
  const node: FileTreeNode = { children: [], kind: "directory", name: getBasename(path), path };
  nodesByPath.set(path, node);
  const parentPath = getParentPath(path);
  if (parentPath) ensureDirectory(nodesByPath, parentPath).children.push(node);
  return node;
}

export function buildTree(items: FileTreeItem[]) {
  const rootNodes: FileTreeNode[] = [];
  const nodesByPath = new Map<string, FileTreeNode>();
  for (const item of items) {
    const parentPath = getParentPath(item.path);
    if (parentPath) ensureDirectory(nodesByPath, parentPath);
    if (item.kind === "directory") {
      ensureDirectory(nodesByPath, item.path);
    } else if (!nodesByPath.has(item.path)) {
      nodesByPath.set(item.path, { children: [], kind: "file", name: getBasename(item.path), path: item.path });
    }
  }
  for (const node of nodesByPath.values()) {
    const parentPath = getParentPath(node.path);
    if (!parentPath) rootNodes.push(node);
    else {
      const parent = nodesByPath.get(parentPath);
      if (parent && !parent.children.some((child) => child.path === node.path)) parent.children.push(node);
    }
  }
  const sort = (nodes: FileTreeNode[]) => {
    nodes.sort((left, right) =>
      left.kind !== right.kind ? (left.kind === "directory" ? -1 : 1) : 0,
    );
    nodes.forEach((node) => sort(node.children));
  };
  sort(rootNodes);
  return rootNodes;
}

export function flattenVisibleTree(
  nodes: FileTreeNode[],
  collapsedDirectories: Set<string>,
  isFiltering: boolean,
  depth = 0,
): Array<{ depth: number; node: FileTreeNode }> {
  return nodes.flatMap((node) => {
    const row = { depth, node };
    if (node.kind === "file" || (!isFiltering && collapsedDirectories.has(node.path))) return [row];
    return [row, ...flattenVisibleTree(node.children, collapsedDirectories, isFiltering, depth + 1)];
  });
}
