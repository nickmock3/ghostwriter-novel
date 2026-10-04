import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  readSortedDirectoryEntries,
  shouldSkipWalkEntry,
  toRelativePath,
} from "./workspaceDirectoryWalk";
import {
  resolveWorkspaceFilePath,
  toWorkspaceRelativePath,
} from "./workspaceFilePaths";

export type WorkspaceFileTreeItem = {
  kind: "directory" | "file";
  path: string;
};

export type WorkspaceFileTreeResult = {
  items: WorkspaceFileTreeItem[];
  limit: number;
  truncated: boolean;
};

const DEFAULT_TREE_LIMIT = 100;

function normalizeFilter(filter: string): string {
  return filter.trim().toLowerCase();
}

function matchesFilter(relativePath: string, filter: string): boolean {
  if (!filter) {
    return true;
  }

  return relativePath.toLowerCase().includes(filter);
}

async function walkDirectory(
  absoluteDirectoryPath: string,
  relativeDirectoryPath: string,
  filter: string,
  includeNoisyDirectories: boolean,
  remainingItems: number,
): Promise<WorkspaceFileTreeResult> {
  if (remainingItems <= 0) {
    return { items: [], limit: DEFAULT_TREE_LIMIT, truncated: true };
  }

  const directoryEntries = await readSortedDirectoryEntries(
    absoluteDirectoryPath,
  );
  const items: WorkspaceFileTreeItem[] = [];
  let truncated = false;

  for (const entry of directoryEntries) {
    if (items.length >= remainingItems) {
      truncated = true;
      break;
    }

    if (
      shouldSkipWalkEntry(entry, {
        includeNoisyDirectories,
      })
    ) {
      continue;
    }

    const childRelativePath = toRelativePath(relativeDirectoryPath, entry.name);
    const currentMatchesFilter = matchesFilter(childRelativePath, filter);

    if (entry.isDirectory()) {
      const childAbsolutePath = path.join(absoluteDirectoryPath, entry.name);
      const childResult = await walkDirectory(
        childAbsolutePath,
        childRelativePath,
        filter,
        includeNoisyDirectories,
        remainingItems - items.length,
      );
      const shouldIncludeDirectory =
        filter === "" ||
        currentMatchesFilter ||
        childResult.items.length > 0 ||
        childResult.truncated;

      if (!shouldIncludeDirectory) {
        continue;
      }

      const combinedItems: WorkspaceFileTreeItem[] = [
        { kind: "directory", path: childRelativePath },
        ...childResult.items,
      ];
      const availableSlots = remainingItems - items.length;

      if (combinedItems.length > availableSlots) {
        items.push(...combinedItems.slice(0, availableSlots));
        truncated = true;
        break;
      }

      items.push(...combinedItems);
      truncated = truncated || childResult.truncated;
      continue;
    }

    if (entry.isFile() && currentMatchesFilter) {
      items.push({ kind: "file", path: childRelativePath });
    }
  }

  return { items, limit: DEFAULT_TREE_LIMIT, truncated };
}

export async function getWorkspaceFileTree(
  workspaceRoot: string,
  options: {
    filter?: string;
    includeNoisyDirectories?: boolean;
    limit: number;
  },
): Promise<WorkspaceFileTreeResult> {
  const filter = normalizeFilter(options.filter ?? "");
  const limit =
    Number.isSafeInteger(options.limit) && options.limit > 0
      ? options.limit
      : DEFAULT_TREE_LIMIT;
  const walkResult = await walkDirectory(
    workspaceRoot,
    "",
    filter,
    options.includeNoisyDirectories ?? false,
    limit,
  );

  return {
    items: walkResult.items,
    limit,
    truncated: walkResult.truncated,
  };
}

export async function listWorkspaceChildFiles(
  workspaceRoot: string,
  workspaceRelativeDirectoryPath: string,
): Promise<string[]> {
  const directory =
    workspaceRelativeDirectoryPath === ""
      ? {
          absolutePath: workspaceRoot,
          workspaceRelativePath: "",
        }
      : await resolveWorkspaceFilePath(
          workspaceRoot,
          workspaceRelativeDirectoryPath,
          {
            rejectHiddenSegments: true,
            requireExisting: true,
          },
        );
  const directoryStat = await stat(directory.absolutePath);
  if (!directoryStat.isDirectory()) {
    throw Object.assign(new Error("Parent path is not a directory"), {
      status: 409,
    });
  }

  const entries = await readdir(directory.absolutePath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) =>
      toWorkspaceRelativePath(
        toRelativePath(directory.workspaceRelativePath, entry.name),
      ),
    )
    .sort((left, right) => left.localeCompare(right));
}
