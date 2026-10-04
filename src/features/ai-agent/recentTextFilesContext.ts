import { localWorkspaceFileStore } from "../workspace/workspaceFileStore";

const DEFAULT_MAX_FILES = 10;

export type RecentTextFile = {
  mtime: string;
  path: string;
  size: number;
};

export type RecentTextFilesContext = {
  files: RecentTextFile[];
  generatedAt: string;
  maxFiles: number;
  omittedFileCount: number;
  truncated: boolean;
};

export type LoadRecentTextFilesContextOptions = {
  maxFiles?: number;
  workspaceRoot: string;
};

function normalizeMaxFiles(maxFiles: number | undefined): number {
  if (maxFiles === undefined) {
    return DEFAULT_MAX_FILES;
  }

  if (!Number.isSafeInteger(maxFiles) || maxFiles <= 0) {
    return DEFAULT_MAX_FILES;
  }

  return maxFiles;
}

export async function loadRecentTextFilesContext(
  options: LoadRecentTextFilesContextOptions,
): Promise<RecentTextFilesContext> {
  const maxFiles = normalizeMaxFiles(options.maxFiles);
  const context = await localWorkspaceFileStore.createContext(
    options.workspaceRoot,
  );
  const result = await localWorkspaceFileStore.getRecentTextFiles(context, {
    maxFiles,
  });

  return {
    files: result.files,
    generatedAt: new Date().toISOString(),
    maxFiles,
    omittedFileCount: result.omittedFileCount,
    truncated: result.truncated,
  };
}
