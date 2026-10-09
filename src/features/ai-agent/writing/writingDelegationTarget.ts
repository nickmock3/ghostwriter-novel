import { lstat, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  resolveWorkspaceFilePath,
  toWorkspaceRelativePath,
} from "../../workspace/workspaceFilePaths";

export const MAX_WRITING_DELEGATION_READ_BYTES = 1024 * 1024;

export type WritingDelegationTargetState =
  | { kind: "missing" }
  | { kind: "readable" }
  | { kind: "unreadable"; reason: string };

export type ResolvedWritingDelegationTarget = {
  normalizedPath: string;
  state: WritingDelegationTargetState;
};

function parentWorkspaceRelativePath(
  workspaceRoot: string,
  absolutePath: string,
): string {
  const nativeRelativePath = path.relative(workspaceRoot, path.dirname(absolutePath));
  return nativeRelativePath ? toWorkspaceRelativePath(nativeRelativePath) : "";
}

async function parentIsDirectory(
  workspaceRoot: string,
  absolutePath: string,
): Promise<boolean> {
  const parentRelativePath = parentWorkspaceRelativePath(workspaceRoot, absolutePath);
  if (!parentRelativePath) {
    return true;
  }

  try {
    const resolvedParent = await resolveWorkspaceFilePath(workspaceRoot, parentRelativePath, {
      rejectHiddenSegments: true,
      requireExisting: true,
    });
    const parentStat = await stat(resolvedParent.absolutePath);
    return parentStat.isDirectory();
  } catch {
    return false;
  }
}

async function classifyExistingTarget(
  workspaceRoot: string,
  normalizedPath: string,
): Promise<WritingDelegationTargetState> {
  let existingPath;
  try {
    existingPath = await resolveWorkspaceFilePath(workspaceRoot, normalizedPath, {
      rejectHiddenSegments: true,
      requireExisting: true,
    });
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "unreadable", reason: "File is not readable as text" };
    }
    throw error;
  }

  const fileStat = await stat(existingPath.absolutePath);
  if (!fileStat.isFile()) {
    return { kind: "unreadable", reason: "File is not readable as text" };
  }

  if (fileStat.size > MAX_WRITING_DELEGATION_READ_BYTES) {
    return {
      kind: "unreadable",
      reason: `File is too large to read (max ${MAX_WRITING_DELEGATION_READ_BYTES} bytes)`,
    };
  }

  const buffer = await readFile(existingPath.absolutePath);
  if (buffer.includes(0x00)) {
    return { kind: "unreadable", reason: "File appears to be binary" };
  }

  return { kind: "readable" };
}

export async function resolveWritingDelegationTarget(
  workspaceRoot: string,
  targetPath: string,
): Promise<ResolvedWritingDelegationTarget> {
  const resolved = await resolveWorkspaceFilePath(workspaceRoot, targetPath, {
    rejectHiddenSegments: true,
    requireExisting: false,
  });
  const normalizedPath = resolved.workspaceRelativePath;

  try {
    await lstat(resolved.absolutePath);
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      if (!(await parentIsDirectory(resolved.workspaceRoot, resolved.absolutePath))) {
        return {
          normalizedPath,
          state: {
            kind: "unreadable",
            reason: "Parent directory does not exist",
          },
        };
      }
      return { normalizedPath, state: { kind: "missing" } };
    }
    throw error;
  }

  const state = await classifyExistingTarget(resolved.workspaceRoot, normalizedPath);
  return { normalizedPath, state };
}
