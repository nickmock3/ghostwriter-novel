import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolveWorkspaceRoot } from "../workspace/workspacePaths";
import type { WorkspaceFileTreeItem } from "../workspace/workspaceFileStore";

const orderDocumentSchema = z.object({
  parents: z.record(z.string(), z.array(z.string())),
  version: z.literal(1),
});

type FileTreeOrderDocument = z.infer<typeof orderDocumentSchema>;

type StoreContext = {
  dataRoot: string;
  workspaceRoot: string;
};

const updateLocks = new Map<string, Promise<void>>();

function parentPathOf(workspaceRelativePath: string): string {
  const segments = workspaceRelativePath.split("/");
  return segments.length > 1 ? segments.slice(0, -1).join("/") : "";
}

function normalizeWorkspaceRelativePath(
  value: string,
  options: { allowEmpty: boolean },
): string {
  if (value === "" && options.allowEmpty) {
    return "";
  }
  if (
    value === "" ||
    value.includes("\\") ||
    value.includes("\u0000") ||
    path.posix.isAbsolute(value)
  ) {
    throw new Error("Invalid workspace-relative path");
  }

  const normalized = path.posix.normalize(value);
  const segments = normalized.split("/");
  if (
    normalized !== value ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith("."),
    )
  ) {
    throw new Error("Invalid workspace-relative path");
  }
  return normalized;
}

function workspaceOrderId(workspaceRoot: string): string {
  return createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 24);
}

async function resolveStoreContext(options: StoreContext) {
  const workspaceRoot = await resolveWorkspaceRoot(options.workspaceRoot);
  const directory = path.join(options.dataRoot, "file-tree-order");
  const filePath = path.join(directory, `${workspaceOrderId(workspaceRoot)}.json`);
  return { directory, filePath };
}

function emptyDocument(): FileTreeOrderDocument {
  return { parents: {}, version: 1 };
}

function sanitizeDocument(value: unknown): FileTreeOrderDocument {
  const parsed = orderDocumentSchema.safeParse(value);
  if (!parsed.success) {
    return emptyDocument();
  }

  const parents: Record<string, string[]> = {};
  for (const [rawParentPath, rawPaths] of Object.entries(parsed.data.parents)) {
    try {
      const parentPath = normalizeWorkspaceRelativePath(rawParentPath, {
        allowEmpty: true,
      });
      const seen = new Set<string>();
      const paths: string[] = [];
      for (const rawPath of rawPaths) {
        try {
          const filePath = normalizeWorkspaceRelativePath(rawPath, {
            allowEmpty: false,
          });
          if (parentPathOf(filePath) !== parentPath || seen.has(filePath)) {
            continue;
          }
          seen.add(filePath);
          paths.push(filePath);
        } catch {
          // Ignore only the invalid entry instead of discarding other valid order data.
        }
      }
      if (paths.length > 0) {
        parents[parentPath] = paths;
      }
    } catch {
      // Ignore an invalid parent key and continue loading other directories.
    }
  }
  return { parents, version: 1 };
}

async function readDocument(filePath: string): Promise<FileTreeOrderDocument> {
  try {
    return sanitizeDocument(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return emptyDocument();
    }
    return emptyDocument();
  }
}

async function writeDocument(
  directory: string,
  filePath: string,
  document: FileTreeOrderDocument,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );
  await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function updateDocument(
  options: StoreContext,
  update: (document: FileTreeOrderDocument) => void,
): Promise<void> {
  const context = await resolveStoreContext(options);
  const previous = updateLocks.get(context.filePath) ?? Promise.resolve();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  updateLocks.set(context.filePath, tail);

  await previous;
  try {
    const document = await readDocument(context.filePath);
    update(document);
    await writeDocument(context.directory, context.filePath, document);
  } finally {
    release();
    if (updateLocks.get(context.filePath) === tail) {
      updateLocks.delete(context.filePath);
    }
  }
}

function reconcileSiblingOrder(
  existingOrder: string[],
  siblingFilePaths: string[],
): string[] {
  const siblingSet = new Set(siblingFilePaths);
  const ordered = existingOrder.filter((filePath) => siblingSet.has(filePath));
  const orderedSet = new Set(ordered);
  const unordered = siblingFilePaths
    .filter((filePath) => !orderedSet.has(filePath))
    .sort((left, right) => left.localeCompare(right));
  return [...ordered, ...unordered];
}

export async function readFileTreeOrder(
  options: StoreContext & { parentPath: string },
): Promise<string[]> {
  const parentPath = normalizeWorkspaceRelativePath(options.parentPath, {
    allowEmpty: true,
  });
  const context = await resolveStoreContext(options);
  const document = await readDocument(context.filePath);
  return [...(document.parents[parentPath] ?? [])];
}

export async function insertFileTreeOrder(
  options: StoreContext & {
    insertBeforePath?: string;
    newPath: string;
    parentPath: string;
    siblingFilePaths: string[];
  },
): Promise<string[]> {
  const parentPath = normalizeWorkspaceRelativePath(options.parentPath, {
    allowEmpty: true,
  });
  const newPath = normalizeWorkspaceRelativePath(options.newPath, {
    allowEmpty: false,
  });
  const insertBeforePath =
    options.insertBeforePath === undefined
      ? undefined
      : normalizeWorkspaceRelativePath(options.insertBeforePath, {
          allowEmpty: false,
        });
  const siblingFilePaths = options.siblingFilePaths.map((filePath) =>
    normalizeWorkspaceRelativePath(filePath, { allowEmpty: false }),
  );

  if (
    parentPathOf(newPath) !== parentPath ||
    siblingFilePaths.some((filePath) => parentPathOf(filePath) !== parentPath) ||
    (insertBeforePath !== undefined &&
      (parentPathOf(insertBeforePath) !== parentPath ||
        !siblingFilePaths.includes(insertBeforePath)))
  ) {
    throw Object.assign(new Error("Insertion sibling is not in the requested parent"), {
      status: 409,
    });
  }

  let result: string[] = [];
  await updateDocument(options, (document) => {
    const siblings = reconcileSiblingOrder(
      document.parents[parentPath] ?? [],
      siblingFilePaths,
    ).filter((filePath) => filePath !== newPath);
    const insertionIndex =
      insertBeforePath === undefined ? siblings.length : siblings.indexOf(insertBeforePath);
    siblings.splice(insertionIndex < 0 ? siblings.length : insertionIndex, 0, newPath);
    document.parents[parentPath] = siblings;
    result = [...siblings];
  });
  return result;
}

export async function renameFileTreeOrderPath(
  options: StoreContext & { newPath: string; oldPath: string },
): Promise<void> {
  const oldPath = normalizeWorkspaceRelativePath(options.oldPath, {
    allowEmpty: false,
  });
  const newPath = normalizeWorkspaceRelativePath(options.newPath, {
    allowEmpty: false,
  });
  await updateDocument(options, (document) => {
    const nextParents: Record<string, string[]> = {};
    for (const [parentPath, filePaths] of Object.entries(document.parents)) {
      const nextParentPath =
        parentPath === oldPath || parentPath.startsWith(`${oldPath}/`)
          ? `${newPath}${parentPath.slice(oldPath.length)}`
          : parentPath;
      const seen = new Set<string>();
      nextParents[nextParentPath] = filePaths
        .map((filePath) =>
          filePath === oldPath || filePath.startsWith(`${oldPath}/`)
            ? `${newPath}${filePath.slice(oldPath.length)}`
            : filePath,
        )
        .filter((filePath) => {
          if (seen.has(filePath)) {
            return false;
          }
          seen.add(filePath);
          return true;
        });
    }
    document.parents = nextParents;
  });
}

export async function removeFileTreeOrderPath(
  options: StoreContext & { path: string },
): Promise<void> {
  const removedPath = normalizeWorkspaceRelativePath(options.path, {
    allowEmpty: false,
  });
  await updateDocument(options, (document) => {
    const nextParents: Record<string, string[]> = {};
    for (const [parentPath, filePaths] of Object.entries(document.parents)) {
      if (parentPath === removedPath || parentPath.startsWith(`${removedPath}/`)) {
        continue;
      }
      const remaining = filePaths.filter(
        (filePath) =>
          filePath !== removedPath && !filePath.startsWith(`${removedPath}/`),
      );
      if (remaining.length > 0) {
        nextParents[parentPath] = remaining;
      }
    }
    document.parents = nextParents;
  });
}

export async function orderFileTreeItems(options: StoreContext & {
  items: WorkspaceFileTreeItem[];
}): Promise<WorkspaceFileTreeItem[]> {
  const context = await resolveStoreContext(options);
  const document = await readDocument(context.filePath);
  const filesByParent = new Map<string, WorkspaceFileTreeItem[]>();
  for (const item of options.items) {
    if (item.kind !== "file") {
      continue;
    }
    const parentPath = parentPathOf(item.path);
    const siblings = filesByParent.get(parentPath) ?? [];
    siblings.push(item);
    filesByParent.set(parentPath, siblings);
  }

  const orderedByParent = new Map<string, WorkspaceFileTreeItem[]>();
  for (const [parentPath, siblings] of filesByParent) {
    const byPath = new Map(siblings.map((item) => [item.path, item]));
    const orderedPaths = reconcileSiblingOrder(
      document.parents[parentPath] ?? [],
      siblings.map((item) => item.path),
    );
    orderedByParent.set(
      parentPath,
      orderedPaths.flatMap((filePath) => {
        const item = byPath.get(filePath);
        return item ? [item] : [];
      }),
    );
  }

  const offsets = new Map<string, number>();
  return options.items.map((item) => {
    if (item.kind !== "file") {
      return item;
    }
    const parentPath = parentPathOf(item.path);
    const offset = offsets.get(parentPath) ?? 0;
    offsets.set(parentPath, offset + 1);
    return orderedByParent.get(parentPath)?.[offset] ?? item;
  });
}
