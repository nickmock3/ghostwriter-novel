import { stat } from "node:fs/promises";
import path from "node:path";
import {
  fileLooksTextLike,
  readSortedDirectoryEntries,
  shouldSkipWalkEntry,
  toRelativePath,
} from "./workspaceDirectoryWalk";
import { toWorkspaceRelativePath } from "./workspaceFilePaths";

export type WorkspaceRecentTextFile = {
  mtime: string;
  path: string;
  size: number;
};

type RecentTextCandidate = {
  mtimeMs: number;
  path: string;
  size: number;
};

async function walkRecentTextFiles(
  absoluteDirectoryPath: string,
  relativeDirectoryPath: string,
  candidates: RecentTextCandidate[],
): Promise<void> {
  const directoryEntries = await readSortedDirectoryEntries(
    absoluteDirectoryPath,
  );

  for (const entry of directoryEntries) {
    if (
      shouldSkipWalkEntry(entry, {
        includeNoisyDirectories: false,
      })
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      const childRelativePath = toRelativePath(
        relativeDirectoryPath,
        entry.name,
      );
      await walkRecentTextFiles(
        path.join(absoluteDirectoryPath, entry.name),
        childRelativePath,
        candidates,
      );
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const childRelativePath = toRelativePath(relativeDirectoryPath, entry.name);
    const absolutePath = path.join(absoluteDirectoryPath, entry.name);
    try {
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile() || !(await fileLooksTextLike(absolutePath))) {
        continue;
      }

      candidates.push({
        mtimeMs: fileStat.mtimeMs,
        path: toWorkspaceRelativePath(childRelativePath),
        size: fileStat.size,
      });
    } catch {
      continue;
    }
  }
}

export async function getWorkspaceRecentTextFiles(
  workspaceRoot: string,
  options: {
    maxFiles: number;
  },
): Promise<{
  files: WorkspaceRecentTextFile[];
  omittedFileCount: number;
  truncated: boolean;
}> {
  const maxFiles =
    Number.isSafeInteger(options.maxFiles) && options.maxFiles > 0
      ? options.maxFiles
      : 10;
  const candidates: RecentTextCandidate[] = [];

  await walkRecentTextFiles(workspaceRoot, "", candidates);

  candidates.sort((left, right) => {
    if (left.mtimeMs !== right.mtimeMs) {
      return right.mtimeMs - left.mtimeMs;
    }

    return left.path.localeCompare(right.path);
  });

  const files = candidates.slice(0, maxFiles).map((candidate) => ({
    mtime: new Date(candidate.mtimeMs).toISOString(),
    path: candidate.path,
    size: candidate.size,
  }));

  return {
    files,
    omittedFileCount: Math.max(0, candidates.length - files.length),
    truncated: candidates.length > files.length,
  };
}
