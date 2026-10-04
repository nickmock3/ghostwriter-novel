import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { resolveWorkspaceRoot } from "./workspacePaths";

export const noisyDirectoryNames = new Set([".git", "node_modules", "dist", ".data"]);

const windowsAbsolutePathPattern = /^(?:[A-Za-z]:[\\/]|[\\/])/;
const windowsDrivePathPattern = /^[A-Za-z]:/;

export type NormalizeWorkspaceRelativePathOptions = {
  allowEmpty?: boolean;
  rejectBackslashes?: boolean;
  rejectHiddenSegments?: boolean;
  rejectNullBytes?: boolean;
  requireCanonical?: boolean;
};

export function normalizeWorkspaceRelativePath(
  workspaceRelativePath: string,
  options: NormalizeWorkspaceRelativePathOptions = {},
): string {
  if (workspaceRelativePath === "" && options.allowEmpty) {
    return "";
  }

  if (!workspaceRelativePath.trim()) {
    throw new Error("Path must not be empty");
  }

  if (options.rejectNullBytes && workspaceRelativePath.includes("\u0000")) {
    throw new Error("Path must not include null bytes");
  }

  if (options.rejectBackslashes && workspaceRelativePath.includes("\\")) {
    throw new Error("Path must not include backslashes");
  }

  if (
    path.isAbsolute(workspaceRelativePath) ||
    windowsAbsolutePathPattern.test(workspaceRelativePath) ||
    windowsDrivePathPattern.test(workspaceRelativePath)
  ) {
    throw new Error("Path must be workspace-relative");
  }

  const normalizedPath = path.posix.normalize(workspaceRelativePath.replace(/\\/g, "/"));
  if (normalizedPath === "." || normalizedPath === "") {
    throw new Error("Path must not be empty");
  }

  if (
    normalizedPath === ".." ||
    normalizedPath.startsWith("../")
  ) {
    throw new Error("Path must stay within the workspace");
  }

  if (options.requireCanonical) {
    if (
      normalizedPath !== workspaceRelativePath ||
      normalizedPath.split("/").some((segment) => !segment)
    ) {
      throw new Error("Path must be canonical");
    }
  }

  if (options.rejectHiddenSegments && hasHiddenPathSegment(normalizedPath)) {
    throw new Error("Hidden path segments are not allowed");
  }

  return normalizedPath;
}

export function workspaceRelativePathSegments(workspaceRelativePath: string): string[] {
  return normalizeWorkspaceRelativePath(workspaceRelativePath).split("/");
}

export function toWorkspaceRelativePath(nativeRelativePath: string): string {
  return normalizeWorkspaceRelativePath(nativeRelativePath);
}

export function hasHiddenPathSegment(workspaceRelativePath: string): boolean {
  return workspaceRelativePath.split(/[\\/]+/).some((segment) => {
    if (!segment || segment === "." || segment === "..") {
      return false;
    }

    return segment.startsWith(".");
  });
}

function isWithinWorkspace(workspaceRoot: string, candidatePath: string): boolean {
  const relativePath = path.relative(workspaceRoot, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function resolveExistingAncestor(candidatePath: string): Promise<string> {
  let currentPath = candidatePath;

  while (true) {
    try {
      await stat(currentPath);
      return currentPath;
    } catch (error) {
      if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        throw new Error("Workspace path does not exist");
      }

      currentPath = parentPath;
    }
  }
}

export async function resolveWorkspaceFilePath(
  workspaceRoot: string,
  workspaceRelativePath: string,
  options?: {
    rejectHiddenSegments?: boolean;
    requireExisting?: boolean;
  },
): Promise<{ absolutePath: string; workspaceRoot: string; workspaceRelativePath: string }> {
  const resolvedWorkspaceRoot = await resolveWorkspaceRoot(workspaceRoot);
  const normalizedRelativePath = normalizeWorkspaceRelativePath(workspaceRelativePath);

  if (options?.rejectHiddenSegments && hasHiddenPathSegment(normalizedRelativePath)) {
    throw new Error("Hidden path segments are not allowed");
  }

  const absolutePath = path.resolve(
    resolvedWorkspaceRoot,
    ...workspaceRelativePathSegments(normalizedRelativePath),
  );
  if (!isWithinWorkspace(resolvedWorkspaceRoot, absolutePath)) {
    throw new Error("Path must stay within the workspace");
  }

  if (options?.requireExisting) {
    const realAbsolutePath = await realpath(absolutePath);
    if (!isWithinWorkspace(resolvedWorkspaceRoot, realAbsolutePath)) {
      throw new Error("Path escapes the workspace");
    }
    return {
      absolutePath: realAbsolutePath,
      workspaceRelativePath: normalizedRelativePath,
      workspaceRoot: resolvedWorkspaceRoot,
    };
  }

  const existingAncestor = await resolveExistingAncestor(path.dirname(absolutePath));
  const realAncestor = await realpath(existingAncestor);
  if (!isWithinWorkspace(resolvedWorkspaceRoot, realAncestor)) {
    throw new Error("Path escapes the workspace");
  }

  return {
    absolutePath,
    workspaceRelativePath: normalizedRelativePath,
    workspaceRoot: resolvedWorkspaceRoot,
  };
}
