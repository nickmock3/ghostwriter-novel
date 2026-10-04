import path from "node:path";
import { subscribeWorkspaceChanged } from "../workspace/workspaceChangedNotifier";
import {
  localWorkspaceFileStore,
  type WorkspaceFileTreeItem,
} from "../workspace/workspaceFileStore";

const DEFAULT_MAX_ENTRIES = 200;

export type WorkspaceStructureContext = {
  directoryCount: number;
  fileCount: number;
  generatedAt: string;
  omittedEntryCount: number;
  summary: string;
  truncated: boolean;
  workspaceRoot: string;
};

export type LoadWorkspaceStructureContextOptions = {
  maxEntries?: number;
  workspaceRoot: string;
};

const workspaceStructureContextCache = new Map<
  string,
  WorkspaceStructureContext
>();

function normalizeMaxEntries(maxEntries: number | undefined): number {
  if (maxEntries === undefined) {
    return DEFAULT_MAX_ENTRIES;
  }

  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
    return DEFAULT_MAX_ENTRIES;
  }

  return maxEntries;
}

function toWorkspaceSummaryPath(
  relativePath: string,
  kind: "directory" | "file",
): string {
  const normalizedPath = relativePath.split(path.sep).join("/");
  return kind === "directory" ? `${normalizedPath}/` : normalizedPath;
}

function formatSummary(
  entries: WorkspaceFileTreeItem[],
  maxEntries: number,
): {
  omittedEntryCount: number;
  summary: string;
  truncated: boolean;
} {
  const displayedEntries = entries.slice(0, maxEntries);
  const omittedEntryCount = Math.max(
    0,
    entries.length - displayedEntries.length,
  );
  const lines = [
    "./",
    ...displayedEntries.map((entry) =>
      toWorkspaceSummaryPath(entry.path, entry.kind),
    ),
  ];

  if (omittedEntryCount > 0) {
    lines.push(`Summary truncated: ${omittedEntryCount} entries omitted.`);
  }

  return {
    omittedEntryCount,
    summary: lines.join("\n"),
    truncated: omittedEntryCount > 0,
  };
}

export async function loadWorkspaceStructureContext(
  options: LoadWorkspaceStructureContextOptions,
): Promise<WorkspaceStructureContext> {
  const context = await localWorkspaceFileStore.createContext(
    options.workspaceRoot,
  );
  const tree = await localWorkspaceFileStore.getFileTree(context, {
    includeNoisyDirectories: false,
    limit: Number.MAX_SAFE_INTEGER,
  });
  const summary = formatSummary(
    tree.items,
    normalizeMaxEntries(options.maxEntries),
  );
  const directoryCount = tree.items.filter(
    (item) => item.kind === "directory",
  ).length;
  const fileCount = tree.items.filter((item) => item.kind === "file").length;

  return {
    directoryCount,
    fileCount,
    generatedAt: new Date().toISOString(),
    omittedEntryCount: summary.omittedEntryCount,
    summary: summary.summary,
    truncated: summary.truncated,
    workspaceRoot: options.workspaceRoot,
  };
}

export async function getWorkspaceStructureContext(
  options: LoadWorkspaceStructureContextOptions,
): Promise<WorkspaceStructureContext> {
  const cacheKey = options.workspaceRoot;
  const cachedContext = workspaceStructureContextCache.get(cacheKey);
  if (cachedContext) {
    return cachedContext;
  }

  const context = await loadWorkspaceStructureContext(options);
  workspaceStructureContextCache.set(cacheKey, context);
  return context;
}

export function invalidateWorkspaceStructureContext(
  workspaceRoot: string,
): void {
  workspaceStructureContextCache.delete(workspaceRoot);
}

subscribeWorkspaceChanged(invalidateWorkspaceStructureContext);
