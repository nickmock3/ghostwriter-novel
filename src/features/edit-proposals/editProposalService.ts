import { createHash, randomUUID } from "node:crypto";
import { readdir, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { notifyWorkspaceChanged } from "../workspace/workspaceChangedNotifier";
import {
  normalizeWorkspaceRelativePath,
  resolveWorkspaceFilePath,
  toWorkspaceRelativePath,
} from "../workspace/workspaceFilePaths";
import { localWorkspaceFileStore } from "../workspace/workspaceFileStore";
import type { EditProposal, EditProposalUndoSnapshot } from "./editProposalSchemas";

export type CreateEditProposalInput = {
  newText: string;
  oldText: string;
  path: string;
  workspaceRoot: string;
};

export type CreateFileProposalInput = {
  content: string;
  path: string;
  workspaceRoot: string;
};

export type CreateDirectoryProposalInput = {
  path: string;
  workspaceRoot: string;
};

export type ApplyEditProposalInput = {
  beforeMutation?: (intendedProposal: EditProposal) => Promise<void>;
  dirtyPaths: string[];
  proposal: EditProposal;
  workspaceRoot: string;
};

function nowIso() {
  return new Date().toISOString();
}

function createProposalId(input: CreateEditProposalInput): string {
  return createHash("sha256")
    .update(
      `${input.workspaceRoot}\0${input.path}\0${input.oldText}\0${input.newText}\0${randomUUID()}`,
    )
    .digest("hex")
    .slice(0, 24);
}

function createDiff(path: string, oldText: string, newText: string): string {
  return [
    `--- ${path}`,
    `+++ ${path}`,
    "@@",
    `-${oldText}`,
    `+${newText}`,
  ].join("\n");
}

function createNewFileDiff(path: string, content: string): string {
  return [
    `--- /dev/null`,
    `+++ ${path}`,
    "@@",
    ...content.split("\n").map((line) => `+${line}`),
  ].join("\n");
}

function createNewDirectoryDiff(path: string): string {
  const displayPath = path.endsWith("/") ? path : `${path}/`;
  return [
    `--- /dev/null`,
    `+++ ${displayPath}`,
    "@@",
    `+directory: ${path}`,
  ].join("\n");
}

function countExactOccurrences(text: string, needle: string): number {
  if (needle === "") {
    return text === "" ? 1 : text.length + 1;
  }

  let count = 0;
  let offset = 0;

  while (offset >= 0) {
    const foundIndex = text.indexOf(needle, offset);
    if (foundIndex === -1) {
      break;
    }

    count += 1;
    offset = foundIndex + 1;
  }

  return count;
}

function replaceExactOnce(
  text: string,
  oldText: string,
  newText: string,
): string {
  if (oldText === "") {
    if (text !== "") {
      throw new Error("Edit proposals require oldText to match exactly once");
    }
    return newText;
  }

  const matchCount = countExactOccurrences(text, oldText);
  if (matchCount !== 1) {
    throw new Error("Edit proposals require oldText to match exactly once");
  }

  const matchIndex = text.indexOf(oldText);
  if (matchIndex === -1) {
    throw new Error("Edit proposals require oldText to match exactly once");
  }

  return `${text.slice(0, matchIndex)}${newText}${text.slice(matchIndex + oldText.length)}`;
}

function normalizePathForComparison(relativePath: string): string {
  return normalizeWorkspaceRelativePath(relativePath);
}

function isDirtyPath(proposalPath: string, dirtyPaths: string[]): boolean {
  const normalizedProposalPath = normalizePathForComparison(proposalPath);
  return dirtyPaths.some((dirtyPath) => {
    try {
      return normalizePathForComparison(dirtyPath) === normalizedProposalPath;
    } catch {
      return dirtyPath === proposalPath;
    }
  });
}

async function resolveProposalPath(workspaceRoot: string, filePath: string) {
  const resolvedPath = await resolveWorkspaceFilePath(workspaceRoot, filePath, {
    rejectHiddenSegments: true,
    requireExisting: true,
  });

  return {
    absolutePath: resolvedPath.absolutePath,
    workspaceRelativePath: resolvedPath.workspaceRelativePath,
    workspaceRoot: resolvedPath.workspaceRoot,
  };
}

async function resolveNewProposalPath(workspaceRoot: string, filePath: string) {
  const resolvedPath = await resolveWorkspaceFilePath(workspaceRoot, filePath, {
    rejectHiddenSegments: true,
    requireExisting: false,
  });

  return {
    absolutePath: resolvedPath.absolutePath,
    workspaceRelativePath: resolvedPath.workspaceRelativePath,
    workspaceRoot: resolvedPath.workspaceRoot,
  };
}

function parentWorkspaceRelativePath(
  workspaceRoot: string,
  absolutePath: string,
): string {
  const nativeRelativePath = path.relative(workspaceRoot, path.dirname(absolutePath));
  return nativeRelativePath ? toWorkspaceRelativePath(nativeRelativePath) : "";
}

async function assertParentDirectoryExists(
  workspaceRoot: string,
  absolutePath: string,
): Promise<void> {
  const parentRelativePath = parentWorkspaceRelativePath(workspaceRoot, absolutePath);
  if (!parentRelativePath) {
    return;
  }

  try {
    const resolvedParent = await resolveWorkspaceFilePath(workspaceRoot, parentRelativePath, {
      rejectHiddenSegments: true,
      requireExisting: true,
    });
    const parentStat = await stat(resolvedParent.absolutePath);
    if (!parentStat.isDirectory()) {
      throw new Error("Parent directory does not exist");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Parent directory does not exist") {
      throw error;
    }
    throw new Error("Parent directory does not exist");
  }
}

export async function createEditProposalForWorkspace(
  input: CreateEditProposalInput,
): Promise<EditProposal> {
  const resolvedInput = await resolveProposalPath(
    input.workspaceRoot,
    input.path,
  );
  const context = await localWorkspaceFileStore.createContext(
    resolvedInput.workspaceRoot,
  );
  const currentContent = (
    await localWorkspaceFileStore.readTextFile(
      context,
      resolvedInput.workspaceRelativePath,
    )
  ).content;
  const createdAt = nowIso();

  if (input.oldText === "") {
    if (currentContent !== "") {
      throw new Error(
        "Edit proposals with empty oldText require an empty file",
      );
    }
  } else if (countExactOccurrences(currentContent, input.oldText) !== 1) {
    throw new Error("Edit proposals require oldText to match exactly once");
  }

  return {
    createdAt,
    diff: createDiff(
      resolvedInput.workspaceRelativePath,
      input.oldText,
      input.newText,
    ),
    id: createProposalId({
      ...input,
      workspaceRoot: resolvedInput.workspaceRoot,
      path: resolvedInput.workspaceRelativePath,
    }),
    newText: input.newText,
    oldText: input.oldText,
    operation: "edit",
    path: resolvedInput.workspaceRelativePath,
    status: "pending",
    title: `Edit ${resolvedInput.workspaceRelativePath}`,
    updatedAt: createdAt,
  };
}

export async function createFileProposalForWorkspace(
  input: CreateFileProposalInput,
): Promise<EditProposal> {
  const resolvedInput = await resolveNewProposalPath(
    input.workspaceRoot,
    input.path,
  );
  const parentRelativePath = parentWorkspaceRelativePath(
    resolvedInput.workspaceRoot,
    resolvedInput.absolutePath,
  );
  if (parentRelativePath) {
    await assertParentDirectoryExists(
      resolvedInput.workspaceRoot,
      resolvedInput.absolutePath,
    );
  }
  const context = await localWorkspaceFileStore.createContext(
    resolvedInput.workspaceRoot,
  );
  if (
    await localWorkspaceFileStore.exists(
      context,
      resolvedInput.workspaceRelativePath,
    )
  ) {
    throw new Error("Create proposal target file already exists");
  }

  const createdAt = nowIso();
  return {
    createdAt,
    diff: createNewFileDiff(resolvedInput.workspaceRelativePath, input.content),
    id: createProposalId({
      newText: input.content,
      oldText: "",
      path: resolvedInput.workspaceRelativePath,
      workspaceRoot: resolvedInput.workspaceRoot,
    }),
    newText: input.content,
    oldText: "",
    operation: "create",
    path: resolvedInput.workspaceRelativePath,
    status: "pending",
    title: `Create ${resolvedInput.workspaceRelativePath}`,
    updatedAt: createdAt,
  };
}

export async function createDirectoryProposalForWorkspace(
  input: CreateDirectoryProposalInput,
): Promise<EditProposal> {
  const resolvedInput = await resolveNewProposalPath(
    input.workspaceRoot,
    input.path,
  );
  const context = await localWorkspaceFileStore.createContext(
    resolvedInput.workspaceRoot,
  );
  if (
    await localWorkspaceFileStore.exists(
      context,
      resolvedInput.workspaceRelativePath,
    )
  ) {
    throw new Error("Create directory proposal target path already exists");
  }
  const parentRelativePath = parentWorkspaceRelativePath(
    resolvedInput.workspaceRoot,
    resolvedInput.absolutePath,
  );
  if (
    parentRelativePath &&
    !(await localWorkspaceFileStore.exists(context, parentRelativePath))
  ) {
    throw new Error("Parent directory does not exist");
  }

  const createdAt = nowIso();
  return {
    createdAt,
    diff: createNewDirectoryDiff(resolvedInput.workspaceRelativePath),
    id: createProposalId({
      newText: "",
      oldText: "",
      path: resolvedInput.workspaceRelativePath,
      workspaceRoot: resolvedInput.workspaceRoot,
    }),
    newText: "",
    oldText: "",
    operation: "createDirectory",
    path: resolvedInput.workspaceRelativePath,
    status: "pending",
    title: `Create directory ${resolvedInput.workspaceRelativePath}`,
    updatedAt: createdAt,
  };
}

function undoSnapshotForAppliedProposal(
  beforeContent: string,
  afterContent: string,
): EditProposalUndoSnapshot {
  return {
    afterContent,
    beforeContent,
  };
}

export async function applyEditProposal(
  input: ApplyEditProposalInput,
): Promise<EditProposal> {
  const context = await localWorkspaceFileStore.createContext(
    input.workspaceRoot,
  );
  const resolvedInput =
    input.proposal.operation === "create" ||
    input.proposal.operation === "createDirectory"
      ? await resolveNewProposalPath(input.workspaceRoot, input.proposal.path)
      : await resolveProposalPath(input.workspaceRoot, input.proposal.path);

  if (isDirtyPath(resolvedInput.workspaceRelativePath, input.dirtyPaths)) {
    throw new Error(
      "Cannot apply edit proposal while the target file has unsaved editor changes",
    );
  }

  if (input.proposal.operation === "create") {
    const updatedAt = nowIso();
    if (
      await localWorkspaceFileStore.exists(
        context,
        resolvedInput.workspaceRelativePath,
      )
    ) {
      return {
        ...input.proposal,
        status: "conflicted",
        updatedAt,
      };
    }

    try {
      await assertParentDirectoryExists(
        resolvedInput.workspaceRoot,
        resolvedInput.absolutePath,
      );
    } catch {
      return {
        ...input.proposal,
        status: "conflicted",
        updatedAt,
      };
    }

    await input.beforeMutation?.({ ...input.proposal, status: "applied", updatedAt,
      undoSnapshot: undoSnapshotForAppliedProposal("", input.proposal.newText) });
    await localWorkspaceFileStore.createFile(
      context,
      resolvedInput.workspaceRelativePath,
      input.proposal.newText,
    );
    notifyWorkspaceChanged(input.workspaceRoot);
    return {
      ...input.proposal,
      status: "applied",
      undoSnapshot: undoSnapshotForAppliedProposal("", input.proposal.newText),
      updatedAt,
    };
  }

  if (input.proposal.operation === "createDirectory") {
    const updatedAt = nowIso();
    if (
      await localWorkspaceFileStore.exists(
        context,
        resolvedInput.workspaceRelativePath,
      )
    ) {
      return {
        ...input.proposal,
        status: "conflicted",
        updatedAt,
      };
    }
    const parentRelativePath = parentWorkspaceRelativePath(
      resolvedInput.workspaceRoot,
      resolvedInput.absolutePath,
    );
    if (
      parentRelativePath &&
      !(await localWorkspaceFileStore.exists(context, parentRelativePath))
    ) {
      return {
        ...input.proposal,
        status: "conflicted",
        updatedAt,
      };
    }

    await input.beforeMutation?.({ ...input.proposal, status: "applied", updatedAt,
      undoSnapshot: undoSnapshotForAppliedProposal("", "") });
    await localWorkspaceFileStore.createDirectory(
      context,
      resolvedInput.workspaceRelativePath,
    );
    notifyWorkspaceChanged(input.workspaceRoot);
    return {
      ...input.proposal,
      status: "applied",
      undoSnapshot: undoSnapshotForAppliedProposal("", ""),
      updatedAt,
    };
  }

  const currentContent = (
    await localWorkspaceFileStore.readTextFile(
      context,
      resolvedInput.workspaceRelativePath,
    )
  ).content;
  const matchCount = countExactOccurrences(
    currentContent,
    input.proposal.oldText,
  );

  if (matchCount !== 1) {
    const updatedAt = nowIso();
    return {
      ...input.proposal,
      status: "conflicted",
      updatedAt,
    };
  }

  const updatedContent = replaceExactOnce(
    currentContent,
    input.proposal.oldText,
    input.proposal.newText,
  );

  await input.beforeMutation?.({ ...input.proposal, status: "applied", updatedAt: nowIso(),
    undoSnapshot: undoSnapshotForAppliedProposal(currentContent, updatedContent) });
  await localWorkspaceFileStore.saveTextFile(
    context,
    resolvedInput.workspaceRelativePath,
    updatedContent,
  );
  const updatedAt = nowIso();

  return {
    ...input.proposal,
    status: "applied",
    undoSnapshot: undoSnapshotForAppliedProposal(currentContent, updatedContent),
    updatedAt,
  };
}

export async function undoEditProposal(input: {
  beforeMutation?: (intendedProposal: EditProposal) => Promise<void>;
  proposal: EditProposal;
  workspaceRoot: string;
}): Promise<EditProposal> {
  if (input.proposal.status !== "applied" || !input.proposal.undoSnapshot) {
    throw new Error("Edit proposal cannot be undone");
  }

  const context = await localWorkspaceFileStore.createContext(input.workspaceRoot);
  const { afterContent, beforeContent } = input.proposal.undoSnapshot;
  const updatedAt = nowIso();
  const resolvedInput =
    input.proposal.operation === "create" ||
    input.proposal.operation === "createDirectory"
      ? await resolveNewProposalPath(input.workspaceRoot, input.proposal.path)
      : await resolveProposalPath(input.workspaceRoot, input.proposal.path);

  if (input.proposal.operation === "createDirectory") {
    if (
      !(await localWorkspaceFileStore.exists(
        context,
        resolvedInput.workspaceRelativePath,
      ))
    ) {
      return {
        ...input.proposal,
        status: "conflicted",
        updatedAt,
      };
    }

    const conflicted: EditProposal = { ...input.proposal, status: "conflicted", updatedAt };
    try {
      if ((await readdir(resolvedInput.absolutePath)).length > 0) return conflicted;
    } catch {
      return conflicted;
    }
    // A checkpoint error must escape without attempting the filesystem mutation.
    await input.beforeMutation?.({ ...input.proposal, status: "undone", updatedAt });
    try {
      await rmdir(resolvedInput.absolutePath);
    } catch {
      return conflicted;
    }
    notifyWorkspaceChanged(input.workspaceRoot);
    return { ...input.proposal, status: "undone", updatedAt };
  }

  if (input.proposal.operation === "create") {
    if (
      !(await localWorkspaceFileStore.exists(
        context,
        resolvedInput.workspaceRelativePath,
      ))
    ) {
      return {
        ...input.proposal,
        status: "conflicted",
        updatedAt,
      };
    }

    let currentContent: string;
    try {
      currentContent = (
        await localWorkspaceFileStore.readTextFile(
          context,
          resolvedInput.workspaceRelativePath,
        )
      ).content;
    } catch {
      return {
        ...input.proposal,
        status: "conflicted",
        updatedAt,
      };
    }
    if (currentContent !== afterContent) {
      return {
        ...input.proposal,
        status: "conflicted",
        updatedAt,
      };
    }

    await input.beforeMutation?.({ ...input.proposal, status: "undone", updatedAt });
    await localWorkspaceFileStore.delete(context, resolvedInput.workspaceRelativePath);
    notifyWorkspaceChanged(input.workspaceRoot);
    return {
      ...input.proposal,
      status: "undone",
      updatedAt,
    };
  }

  let currentContent: string;
  try {
    currentContent = (
      await localWorkspaceFileStore.readTextFile(
        context,
        resolvedInput.workspaceRelativePath,
      )
    ).content;
  } catch {
    return {
      ...input.proposal,
      status: "conflicted",
      updatedAt,
    };
  }
  if (currentContent !== afterContent) {
    return {
      ...input.proposal,
      status: "conflicted",
      updatedAt,
    };
  }

  await input.beforeMutation?.({ ...input.proposal, status: "undone", updatedAt });
  await localWorkspaceFileStore.saveTextFile(
    context,
    resolvedInput.workspaceRelativePath,
    beforeContent,
  );
  return {
    ...input.proposal,
    status: "undone",
    updatedAt,
  };
}

export function rejectEditProposal(proposal: EditProposal): EditProposal {
  const updatedAt = nowIso();
  return {
    ...proposal,
    status: "rejected",
    updatedAt,
  };
}
