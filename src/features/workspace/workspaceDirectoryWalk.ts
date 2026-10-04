import type { Dirent } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";
import { noisyDirectoryNames } from "./workspaceFilePaths";

const NULL_BYTE_SCAN_SIZE = 8 * 1024;

export function toRelativePath(basePath: string, childName: string): string {
  return basePath ? path.posix.join(basePath, childName) : childName;
}

export async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await lstat(absolutePath);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

export async function readSortedDirectoryEntries(
  absoluteDirectoryPath: string,
): Promise<Dirent[]> {
  const directoryEntries = await readdir(absoluteDirectoryPath, {
    withFileTypes: true,
  });
  directoryEntries.sort((left, right) => left.name.localeCompare(right.name));
  return directoryEntries;
}

export function shouldSkipWalkEntry(
  entry: Dirent,
  options: {
    includeNoisyDirectories: boolean;
  },
): boolean {
  if (entry.isSymbolicLink()) {
    return true;
  }

  if (
    !options.includeNoisyDirectories &&
    entry.isDirectory() &&
    noisyDirectoryNames.has(entry.name)
  ) {
    return true;
  }

  return false;
}

export async function fileLooksTextLike(absolutePath: string): Promise<boolean> {
  const handle = await open(absolutePath, "r");
  const buffer = Buffer.alloc(NULL_BYTE_SCAN_SIZE);

  try {
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.length,
        position,
      );
      if (bytesRead === 0) {
        return true;
      }

      if (buffer.subarray(0, bytesRead).includes(0x00)) {
        return false;
      }

      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
}
