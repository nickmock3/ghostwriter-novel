import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWorkspaceRoot } from "./workspacePaths";

describe("resolveWorkspaceRoot", () => {
  it("normalizes an absolute directory path to its real path", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-"));

    try {
      await expect(resolveWorkspaceRoot(root)).resolves.toEqual(await realpath(root));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("rejects relative paths", async () => {
    await expect(resolveWorkspaceRoot("relative/workspace")).rejects.toThrow(
      "Workspace path must be absolute",
    );
  });

  it("rejects paths that are not directories", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-"));
    const filePath = path.join(root, "note.txt");
    writeFileSync(filePath, "text");

    try {
      await expect(resolveWorkspaceRoot(filePath)).rejects.toThrow(
        "Workspace path must be a directory",
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
