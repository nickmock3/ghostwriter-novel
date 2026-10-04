import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  insertFileTreeOrder,
  readFileTreeOrder,
  removeFileTreeOrderPath,
  renameFileTreeOrderPath,
} from "./fileTreeOrderStore";

describe("file tree order store", () => {
  it("persists an inserted sibling between existing files", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-tree-order-data-"));
    const workspaceRoot = mkdtempSync(
      path.join(tmpdir(), "ghostwriter-tree-order-workspace-"),
    );

    try {
      await insertFileTreeOrder({
        dataRoot,
        insertBeforePath: "B.txt",
        newPath: "C.txt",
        parentPath: "",
        siblingFilePaths: ["A.txt", "B.txt"],
        workspaceRoot,
      });

      await expect(
        readFileTreeOrder({ dataRoot, parentPath: "", workspaceRoot }),
      ).resolves.toEqual(["A.txt", "C.txt", "B.txt"]);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("keeps order metadata consistent across file and directory rename or deletion", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-tree-order-data-"));
    const workspaceRoot = mkdtempSync(
      path.join(tmpdir(), "ghostwriter-tree-order-workspace-"),
    );

    try {
      await insertFileTreeOrder({
        dataRoot,
        insertBeforePath: "章/B.txt",
        newPath: "章/C.txt",
        parentPath: "章",
        siblingFilePaths: ["章/A.txt", "章/B.txt"],
        workspaceRoot,
      });
      await renameFileTreeOrderPath({
        dataRoot,
        newPath: "本文",
        oldPath: "章",
        workspaceRoot,
      });

      await expect(
        readFileTreeOrder({ dataRoot, parentPath: "本文", workspaceRoot }),
      ).resolves.toEqual(["本文/A.txt", "本文/C.txt", "本文/B.txt"]);

      await removeFileTreeOrderPath({
        dataRoot,
        path: "本文/C.txt",
        workspaceRoot,
      });
      await expect(
        readFileTreeOrder({ dataRoot, parentPath: "本文", workspaceRoot }),
      ).resolves.toEqual(["本文/A.txt", "本文/B.txt"]);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("isolates order metadata by workspace", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-tree-order-data-"));
    const workspaceRoot = mkdtempSync(
      path.join(tmpdir(), "ghostwriter-tree-order-workspace-"),
    );
    const otherWorkspaceRoot = mkdtempSync(
      path.join(tmpdir(), "ghostwriter-tree-order-workspace-"),
    );

    try {
      await insertFileTreeOrder({
        dataRoot,
        insertBeforePath: "B.txt",
        newPath: "C.txt",
        parentPath: "",
        siblingFilePaths: ["A.txt", "B.txt"],
        workspaceRoot,
      });

      await expect(
        readFileTreeOrder({
          dataRoot,
          parentPath: "",
          workspaceRoot: otherWorkspaceRoot,
        }),
      ).resolves.toEqual([]);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
      rmSync(otherWorkspaceRoot, { force: true, recursive: true });
    }
  });
});
