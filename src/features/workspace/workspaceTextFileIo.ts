import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "./workspaceDirectoryWalk";
import { resolveWorkspaceFilePath } from "./workspaceFilePaths";

export type WorkspaceFileContent = {
  content: string;
  path: string;
  truncated: boolean;
};

async function resolveWorkspacePathForWrite(
  workspaceRoot: string,
  workspaceRelativePath: string,
): Promise<{
  absolutePath: string;
  workspaceRelativePath: string;
  workspaceRoot: string;
}> {
  const resolvedPath = await resolveWorkspaceFilePath(
    workspaceRoot,
    workspaceRelativePath,
    {
      rejectHiddenSegments: true,
      requireExisting: false,
    },
  );

  if (!(await pathExists(resolvedPath.absolutePath))) {
    return resolvedPath;
  }

  return resolveWorkspaceFilePath(workspaceRoot, workspaceRelativePath, {
    rejectHiddenSegments: true,
    requireExisting: true,
  });
}

async function resolveExistingWorkspacePath(
  workspaceRoot: string,
  workspaceRelativePath: string,
  options?: {
    rejectHiddenSegments?: boolean;
  },
): Promise<{
  absolutePath: string;
  workspaceRelativePath: string;
  workspaceRoot: string;
}> {
  return resolveWorkspaceFilePath(workspaceRoot, workspaceRelativePath, {
    rejectHiddenSegments: options?.rejectHiddenSegments,
    requireExisting: true,
  });
}

async function readTextBuffer(
  absolutePath: string,
  maxBytes?: number,
): Promise<{ buffer: Buffer; truncated: boolean }> {
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    throw new Error("File is not readable as text");
  }

  if (maxBytes !== undefined && fileStat.size > maxBytes) {
    throw new Error(`File is too large to open (max ${maxBytes} bytes)`);
  }

  const buffer = await readFile(absolutePath);
  if (buffer.includes(0x00)) {
    throw new Error("File appears to be binary");
  }

  return { buffer, truncated: false };
}

export async function createWorkspaceDirectory(
  workspaceRoot: string,
  workspaceRelativePath: string,
): Promise<string> {
  const resolvedPath = await resolveWorkspacePathForWrite(
    workspaceRoot,
    workspaceRelativePath,
  );
  if (await pathExists(resolvedPath.absolutePath)) {
    throw Object.assign(new Error("Target path already exists"), {
      status: 409,
    });
  }

  await mkdir(resolvedPath.absolutePath, { recursive: true });
  return resolvedPath.workspaceRelativePath;
}

export async function createWorkspaceFile(
  workspaceRoot: string,
  workspaceRelativePath: string,
  content: string,
): Promise<string> {
  const resolvedPath = await resolveWorkspacePathForWrite(
    workspaceRoot,
    workspaceRelativePath,
  );
  if (await pathExists(resolvedPath.absolutePath)) {
    throw Object.assign(new Error("Target path already exists"), {
      status: 409,
    });
  }

  await mkdir(path.dirname(resolvedPath.absolutePath), { recursive: true });
  await writeFile(resolvedPath.absolutePath, content, {
    flag: "wx",
    encoding: "utf8",
  });
  return resolvedPath.workspaceRelativePath;
}

export async function createWorkspaceFileBytes(
  workspaceRoot: string,
  workspaceRelativePath: string,
  content: Uint8Array,
): Promise<string> {
  const resolvedPath = await resolveWorkspacePathForWrite(
    workspaceRoot,
    workspaceRelativePath,
  );
  if (await pathExists(resolvedPath.absolutePath)) {
    throw Object.assign(new Error("Target path already exists"), {
      status: 409,
    });
  }

  await mkdir(path.dirname(resolvedPath.absolutePath), { recursive: true });
  await writeFile(resolvedPath.absolutePath, content, { flag: "wx" });
  return resolvedPath.workspaceRelativePath;
}

export async function deleteWorkspacePath(
  workspaceRoot: string,
  workspaceRelativePath: string,
): Promise<string> {
  const resolvedPath = await resolveExistingWorkspacePath(
    workspaceRoot,
    workspaceRelativePath,
    {
      rejectHiddenSegments: true,
    },
  );
  await rm(resolvedPath.absolutePath, { recursive: true });
  return resolvedPath.workspaceRelativePath;
}

export async function workspacePathExists(
  workspaceRoot: string,
  workspaceRelativePath: string,
): Promise<boolean> {
  const resolvedPath = await resolveWorkspaceFilePath(
    workspaceRoot,
    workspaceRelativePath,
    {
      requireExisting: false,
    },
  );
  return pathExists(resolvedPath.absolutePath);
}

export async function readWorkspaceTextFile(
  workspaceRoot: string,
  workspaceRelativePath: string,
  options?: {
    maxBytes?: number;
  },
): Promise<WorkspaceFileContent> {
  const resolvedPath = await resolveExistingWorkspacePath(
    workspaceRoot,
    workspaceRelativePath,
  );
  const fileBuffer = await readTextBuffer(
    resolvedPath.absolutePath,
    options?.maxBytes,
  );

  return {
    content: fileBuffer.buffer.toString("utf8"),
    path: resolvedPath.workspaceRelativePath,
    truncated: fileBuffer.truncated,
  };
}

export async function renameWorkspacePath(
  workspaceRoot: string,
  workspaceRelativePath: string,
  newWorkspaceRelativePath: string,
): Promise<{ newPath: string; path: string }> {
  const source = await resolveExistingWorkspacePath(
    workspaceRoot,
    workspaceRelativePath,
    {
      rejectHiddenSegments: true,
    },
  );
  const target = await resolveWorkspacePathForWrite(
    workspaceRoot,
    newWorkspaceRelativePath,
  );

  if (await pathExists(target.absolutePath)) {
    throw Object.assign(new Error("Target path already exists"), {
      status: 409,
    });
  }

  await mkdir(path.dirname(target.absolutePath), { recursive: true });
  await rename(source.absolutePath, target.absolutePath);

  return {
    newPath: target.workspaceRelativePath,
    path: source.workspaceRelativePath,
  };
}

export async function saveWorkspaceTextFile(
  workspaceRoot: string,
  workspaceRelativePath: string,
  content: string,
): Promise<string> {
  const resolvedPath = await resolveWorkspacePathForWrite(
    workspaceRoot,
    workspaceRelativePath,
  );
  await mkdir(path.dirname(resolvedPath.absolutePath), { recursive: true });
  await writeFile(resolvedPath.absolutePath, content, "utf8");
  return resolvedPath.workspaceRelativePath;
}
