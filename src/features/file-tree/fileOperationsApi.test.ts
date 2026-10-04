import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as workspaceChangedNotifier from "../workspace/workspaceChangedNotifier";
import { createFileOperationsApiHandler } from "./fileOperationsApi";
import {
  insertFileTreeOrder,
  readFileTreeOrder,
} from "./fileTreeOrderStore";

function jsonRequest(method: string, body: unknown) {
  return new Request("http://localhost/api/files/operations", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method,
  });
}

describe("file operations API", () => {
  it("updates manual order metadata after rename and delete operations", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-order-data-"));
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-ops-"));
    writeFileSync(path.join(root, "A.txt"), "A");
    writeFileSync(path.join(root, "B.txt"), "B");
    writeFileSync(path.join(root, "C.txt"), "C");

    try {
      await insertFileTreeOrder({
        dataRoot,
        insertBeforePath: "B.txt",
        newPath: "C.txt",
        parentPath: "",
        siblingFilePaths: ["A.txt", "B.txt", "C.txt"],
        workspaceRoot: root,
      });
      const handler = createFileOperationsApiHandler({ dataRoot });
      const renameResponse = await handler(
        jsonRequest("POST", {
          newPath: "D.txt",
          operation: "rename",
          path: "C.txt",
          workspaceRoot: root,
        }),
      );
      expect(renameResponse.status).toBe(200);
      await expect(
        readFileTreeOrder({ dataRoot, parentPath: "", workspaceRoot: root }),
      ).resolves.toEqual(["A.txt", "D.txt", "B.txt"]);

      const deleteResponse = await handler(
        jsonRequest("POST", {
          operation: "delete",
          path: "D.txt",
          workspaceRoot: root,
        }),
      );
      expect(deleteResponse.status).toBe(200);
      await expect(
        readFileTreeOrder({ dataRoot, parentPath: "", workspaceRoot: root }),
      ).resolves.toEqual(["A.txt", "B.txt"]);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("creates files and directories inside the active workspace", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-ops-"));

    try {
      const handler = createFileOperationsApiHandler();

      const directoryResponse = await handler(
        jsonRequest("POST", {
          kind: "directory",
          operation: "create",
          path: "docs",
          workspaceRoot: root,
        }),
      );
      const fileResponse = await handler(
        jsonRequest("POST", {
          kind: "file",
          operation: "create",
          path: "docs/note.md",
          workspaceRoot: root,
        }),
      );

      expect(directoryResponse.status).toBe(200);
      expect(fileResponse.status).toBe(200);
      expect(readFileSync(path.join(root, "docs/note.md"), "utf8")).toBe("");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("notifies workspace changed after successful structure-changing operations", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-ops-"));
    writeFileSync(path.join(root, "note.md"), "hello");
    const notify = vi.spyOn(workspaceChangedNotifier, "notifyWorkspaceChanged");

    try {
      const handler = createFileOperationsApiHandler();
      await handler(
        jsonRequest("POST", {
          kind: "directory",
          operation: "create",
          path: "docs",
          workspaceRoot: root,
        }),
      );
      await handler(
        jsonRequest("POST", {
          newPath: "docs/renamed.md",
          operation: "rename",
          path: "note.md",
          workspaceRoot: root,
        }),
      );
      await handler(
        jsonRequest("POST", {
          operation: "delete",
          path: "docs/renamed.md",
          workspaceRoot: root,
        }),
      );

      expect(notify).toHaveBeenCalledTimes(3);
      expect(notify).toHaveBeenCalledWith(root);
    } finally {
      notify.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("renames files and rejects hidden path segments", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-ops-"));
    writeFileSync(path.join(root, "note.md"), "hello");

    try {
      const handler = createFileOperationsApiHandler();
      const hiddenResponse = await handler(
        jsonRequest("POST", {
          newPath: ".hidden/note.md",
          operation: "rename",
          path: "note.md",
          workspaceRoot: root,
        }),
      );
      const renameResponse = await handler(
        jsonRequest("POST", {
          newPath: "docs/renamed.md",
          operation: "rename",
          path: "note.md",
          workspaceRoot: root,
        }),
      );

      expect(hiddenResponse.status).toBe(400);
      expect(await hiddenResponse.json()).toEqual({
        message: "Hidden path segments are not allowed",
      });
      expect(renameResponse.status).toBe(200);
      expect(existsSync(path.join(root, "note.md"))).toBe(false);
      expect(readFileSync(path.join(root, "docs/renamed.md"), "utf8")).toBe("hello");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("deletes files and refuses conflicts or symlink escapes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-ops-"));
    const outside = mkdtempSync(path.join(tmpdir(), "ghostwriter-outside-"));
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "docs/note.md"), "hello");
    writeFileSync(path.join(root, "existing.md"), "existing");
    writeFileSync(path.join(outside, "outside.md"), "outside");
    symlinkSync(path.join(outside, "outside.md"), path.join(root, "link.md"));

    try {
      const handler = createFileOperationsApiHandler();
      const conflictResponse = await handler(
        jsonRequest("POST", {
          newPath: "existing.md",
          operation: "rename",
          path: "docs/note.md",
          workspaceRoot: root,
        }),
      );
      const symlinkResponse = await handler(
        jsonRequest("POST", {
          operation: "delete",
          path: "link.md",
          workspaceRoot: root,
        }),
      );
      const deleteResponse = await handler(
        jsonRequest("POST", {
          operation: "delete",
          path: "docs/note.md",
          workspaceRoot: root,
        }),
      );

      expect(conflictResponse.status).toBe(409);
      expect(await conflictResponse.json()).toEqual({
        message: "Target path already exists",
      });
      expect(symlinkResponse.status).toBe(400);
      expect(await symlinkResponse.json()).toEqual({
        message: "Path escapes the workspace",
      });
      expect(deleteResponse.status).toBe(200);
      expect(existsSync(path.join(root, "docs/note.md"))).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });
});
