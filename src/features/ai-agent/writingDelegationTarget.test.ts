import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_WRITING_DELEGATION_READ_BYTES,
  resolveWritingDelegationTarget,
} from "./writingDelegationTarget";

function createWorkspace() {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-writing-target-"));
  return {
    cleanup: () => rmSync(workspaceRoot, { force: true, recursive: true }),
    workspaceRoot,
  };
}

describe("resolveWritingDelegationTarget", () => {
  it("treats a missing file path as create mode when the parent directory exists", async () => {
    const workspace = createWorkspace();
    try {
      mkdirSync(path.join(workspace.workspaceRoot, "manuscript"));
      const result = await resolveWritingDelegationTarget(
        workspace.workspaceRoot,
        "manuscript/scene-02.txt",
      );
      expect(result).toEqual({
        normalizedPath: "manuscript/scene-02.txt",
        state: { kind: "missing" },
      });
    } finally {
      workspace.cleanup();
    }
  });

  it("rejects missing parent directories for create mode targets", async () => {
    const workspace = createWorkspace();
    try {
      const result = await resolveWritingDelegationTarget(
        workspace.workspaceRoot,
        "missing/scene.txt",
      );
      expect(result.state).toEqual({
        kind: "unreadable",
        reason: "Parent directory does not exist",
      });
    } finally {
      workspace.cleanup();
    }
  });

  it("treats existing empty files as readable edit targets", async () => {
    const workspace = createWorkspace();
    try {
      writeFileSync(path.join(workspace.workspaceRoot, "empty.txt"), "", "utf8");
      const result = await resolveWritingDelegationTarget(
        workspace.workspaceRoot,
        "empty.txt",
      );
      expect(result.state).toEqual({ kind: "readable" });
    } finally {
      workspace.cleanup();
    }
  });

  it("does not treat directories as missing create targets", async () => {
    const workspace = createWorkspace();
    try {
      mkdirSync(path.join(workspace.workspaceRoot, "manuscript"));
      const result = await resolveWritingDelegationTarget(
        workspace.workspaceRoot,
        "manuscript",
      );
      expect(result.state).toEqual({
        kind: "unreadable",
        reason: "File is not readable as text",
      });
    } finally {
      workspace.cleanup();
    }
  });

  it("does not treat binary files as missing create targets", async () => {
    const workspace = createWorkspace();
    try {
      writeFileSync(path.join(workspace.workspaceRoot, "image.bin"), Buffer.from([0, 1, 0]));
      const result = await resolveWritingDelegationTarget(
        workspace.workspaceRoot,
        "image.bin",
      );
      expect(result.state).toEqual({
        kind: "unreadable",
        reason: "File appears to be binary",
      });
    } finally {
      workspace.cleanup();
    }
  });

  it("does not treat oversized files as missing create targets", async () => {
    const workspace = createWorkspace();
    try {
      const oversized = Buffer.alloc(MAX_WRITING_DELEGATION_READ_BYTES + 1, 0x41);
      writeFileSync(path.join(workspace.workspaceRoot, "huge.txt"), oversized);
      const result = await resolveWritingDelegationTarget(
        workspace.workspaceRoot,
        "huge.txt",
      );
      expect(result.state).toEqual({
        kind: "unreadable",
        reason: `File is too large to read (max ${MAX_WRITING_DELEGATION_READ_BYTES} bytes)`,
      });
    } finally {
      workspace.cleanup();
    }
  });

  it("rejects hidden path segments", async () => {
    const workspace = createWorkspace();
    try {
      mkdirSync(path.join(workspace.workspaceRoot, ".hidden"));
      await expect(
        resolveWritingDelegationTarget(workspace.workspaceRoot, ".hidden/note.txt"),
      ).rejects.toThrow("Hidden path segments are not allowed");
    } finally {
      workspace.cleanup();
    }
  });

  it("rejects workspace-outside relative paths", async () => {
    const workspace = createWorkspace();
    try {
      await expect(
        resolveWritingDelegationTarget(workspace.workspaceRoot, "../outside.txt"),
      ).rejects.toThrow("Path must stay within the workspace");
    } finally {
      workspace.cleanup();
    }
  });

  it("rejects dangling symlinks as unreadable targets", async () => {
    const workspace = createWorkspace();
    try {
      symlinkSync("missing-target.txt", path.join(workspace.workspaceRoot, "broken-link.txt"));
      const result = await resolveWritingDelegationTarget(
        workspace.workspaceRoot,
        "broken-link.txt",
      );
      expect(result.state).toEqual({
        kind: "unreadable",
        reason: "File is not readable as text",
      });
    } finally {
      workspace.cleanup();
    }
  });

  it("rejects workspace-escaping symlink targets without classifying them as readable", async () => {
    const workspace = createWorkspace();
    try {
      const outsideDir = mkdtempSync(path.join(tmpdir(), "ghostwriter-outside-"));
      const outsideFile = path.join(outsideDir, "secret.txt");
      writeFileSync(outsideFile, "outside secret", "utf8");
      symlinkSync(outsideFile, path.join(workspace.workspaceRoot, "escape-link.txt"));
      await expect(
        resolveWritingDelegationTarget(workspace.workspaceRoot, "escape-link.txt"),
      ).rejects.toThrow("Path escapes the workspace");
      rmSync(outsideDir, { force: true, recursive: true });
    } finally {
      workspace.cleanup();
    }
  });
});
