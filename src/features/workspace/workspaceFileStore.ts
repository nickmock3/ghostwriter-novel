import { resolveWorkspaceRoot } from "./workspacePaths";
import {
  getWorkspaceRecentTextFiles,
  type WorkspaceRecentTextFile,
} from "./workspaceRecentFiles";
import {
  getWorkspaceFileTree,
  listWorkspaceChildFiles,
  type WorkspaceFileTreeItem,
  type WorkspaceFileTreeResult,
} from "./workspaceTreeWalker";
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  createWorkspaceFileBytes,
  deleteWorkspacePath,
  readWorkspaceTextFile,
  renameWorkspacePath,
  saveWorkspaceTextFile,
  workspacePathExists,
  type WorkspaceFileContent,
} from "./workspaceTextFileIo";

export type {
  WorkspaceFileContent,
  WorkspaceFileTreeItem,
  WorkspaceFileTreeResult,
  WorkspaceRecentTextFile,
};

export type WorkspaceFileContext = {
  readonly workspaceRoot: string;
};

export type WorkspaceFileStore = {
  createContext(workspaceRoot: string): Promise<WorkspaceFileContext>;
  createDirectory(
    context: WorkspaceFileContext,
    workspaceRelativePath: string,
  ): Promise<string>;
  createFile(
    context: WorkspaceFileContext,
    workspaceRelativePath: string,
    content: string,
  ): Promise<string>;
  createFileBytes(
    context: WorkspaceFileContext,
    workspaceRelativePath: string,
    content: Uint8Array,
  ): Promise<string>;
  delete(
    context: WorkspaceFileContext,
    workspaceRelativePath: string,
  ): Promise<string>;
  exists(
    context: WorkspaceFileContext,
    workspaceRelativePath: string,
  ): Promise<boolean>;
  getFileTree(
    context: WorkspaceFileContext,
    options: {
      filter?: string;
      includeNoisyDirectories?: boolean;
      limit: number;
    },
  ): Promise<WorkspaceFileTreeResult>;
  listChildFiles(
    context: WorkspaceFileContext,
    workspaceRelativeDirectoryPath: string,
  ): Promise<string[]>;
  getRecentTextFiles(
    context: WorkspaceFileContext,
    options: {
      maxFiles: number;
    },
  ): Promise<{
    files: WorkspaceRecentTextFile[];
    omittedFileCount: number;
    truncated: boolean;
  }>;
  readTextFile(
    context: WorkspaceFileContext,
    workspaceRelativePath: string,
    options?: {
      maxBytes?: number;
    },
  ): Promise<WorkspaceFileContent>;
  rename(
    context: WorkspaceFileContext,
    workspaceRelativePath: string,
    newWorkspaceRelativePath: string,
  ): Promise<{
    newPath: string;
    path: string;
  }>;
  saveTextFile(
    context: WorkspaceFileContext,
    workspaceRelativePath: string,
    content: string,
  ): Promise<string>;
};

async function createLocalWorkspaceFileContext(
  workspaceRoot: string,
): Promise<WorkspaceFileContext> {
  const resolvedWorkspaceRoot = await resolveWorkspaceRoot(workspaceRoot);
  return { workspaceRoot: resolvedWorkspaceRoot };
}

export const localWorkspaceFileStore: WorkspaceFileStore = {
  createContext: createLocalWorkspaceFileContext,
  createDirectory: (context, workspaceRelativePath) =>
    createWorkspaceDirectory(context.workspaceRoot, workspaceRelativePath),
  createFile: (context, workspaceRelativePath, content) =>
    createWorkspaceFile(context.workspaceRoot, workspaceRelativePath, content),
  createFileBytes: (context, workspaceRelativePath, content) =>
    createWorkspaceFileBytes(
      context.workspaceRoot,
      workspaceRelativePath,
      content,
    ),
  delete: (context, workspaceRelativePath) =>
    deleteWorkspacePath(context.workspaceRoot, workspaceRelativePath),
  exists: (context, workspaceRelativePath) =>
    workspacePathExists(context.workspaceRoot, workspaceRelativePath),
  getFileTree: (context, options) =>
    getWorkspaceFileTree(context.workspaceRoot, options),
  getRecentTextFiles: (context, options) =>
    getWorkspaceRecentTextFiles(context.workspaceRoot, options),
  listChildFiles: (context, workspaceRelativeDirectoryPath) =>
    listWorkspaceChildFiles(
      context.workspaceRoot,
      workspaceRelativeDirectoryPath,
    ),
  readTextFile: (context, workspaceRelativePath, options) =>
    readWorkspaceTextFile(
      context.workspaceRoot,
      workspaceRelativePath,
      options,
    ),
  rename: (context, workspaceRelativePath, newWorkspaceRelativePath) =>
    renameWorkspacePath(
      context.workspaceRoot,
      workspaceRelativePath,
      newWorkspaceRelativePath,
    ),
  saveTextFile: (context, workspaceRelativePath, content) =>
    saveWorkspaceTextFile(
      context.workspaceRoot,
      workspaceRelativePath,
      content,
    ),
};
