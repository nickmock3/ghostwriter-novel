import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDroppedFileImportApiHandler } from "./droppedFileImportApi";

function importRequest(body: unknown) {
  return new Request("http://localhost/api/files/import", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("dropped file import API", () => {
  it("creates a text file before the requested sibling and returns the persisted order", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-import-data-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-import-workspace-"));
    writeFileSync(path.join(workspaceRoot, "A.txt"), "A");
    writeFileSync(path.join(workspaceRoot, "B.txt"), "B");
    const handler = createDroppedFileImportApiHandler({ dataRoot });

    try {
      const response = await handler(
        importRequest({
          contentBase64: Buffer.from("C本文").toString("base64"),
          insertBeforePath: "B.txt",
          name: "C.txt",
          parentPath: "",
          workspaceRoot,
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        operation: "import",
        orderedFilePaths: ["A.txt", "C.txt", "B.txt"],
        parentPath: "",
        path: "C.txt",
      });
      expect(readFileSync(path.join(workspaceRoot, "C.txt"), "utf8")).toBe("C本文");
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("preserves the canonical UTF-8 bytes instead of re-encoding the content", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-import-data-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-import-workspace-"));
    const originalBytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("本文"),
    ]);

    try {
      const response = await createDroppedFileImportApiHandler({ dataRoot })(
        importRequest({
          contentBase64: originalBytes.toString("base64"),
          name: "BOM.txt",
          parentPath: "",
          workspaceRoot,
        }),
      );

      expect(response.status).toBe(200);
      expect(readFileSync(path.join(workspaceRoot, "BOM.txt"))).toEqual(
        originalBytes,
      );
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("rejects conflicts or an insertion sibling from another parent without changing files", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-import-data-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-import-workspace-"));
    writeFileSync(path.join(workspaceRoot, "A.txt"), "original");
    const handler = createDroppedFileImportApiHandler({ dataRoot });

    try {
      const conflict = await handler(
        importRequest({
          contentBase64: Buffer.from("replacement").toString("base64"),
          name: "A.txt",
          parentPath: "",
          workspaceRoot,
        }),
      );
      const wrongParent = await handler(
        importRequest({
          contentBase64: Buffer.from("new").toString("base64"),
          insertBeforePath: "other/B.txt",
          name: "C.txt",
          parentPath: "",
          workspaceRoot,
        }),
      );

      expect(conflict.status).toBe(409);
      expect(wrongParent.status).toBe(409);
      expect(readFileSync(path.join(workspaceRoot, "A.txt"), "utf8")).toBe("original");
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("rejects unsafe names, hidden parents, null bytes, and oversized content", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-import-data-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-import-workspace-"));
    const handler = createDroppedFileImportApiHandler({ dataRoot });

    try {
      const responses = await Promise.all([
        handler(
          importRequest({
            contentBase64: Buffer.from("escape").toString("base64"),
            name: "../escape.txt",
            parentPath: "",
            workspaceRoot,
          }),
        ),
        handler(
          importRequest({
            contentBase64: Buffer.from("hidden").toString("base64"),
            name: "file.txt",
            parentPath: ".hidden",
            workspaceRoot,
          }),
        ),
        handler(
          importRequest({
            contentBase64: Buffer.from("before\u0000after").toString("base64"),
            name: "binary.dat",
            parentPath: "",
            workspaceRoot,
          }),
        ),
        handler(
          importRequest({
            contentBase64: Buffer.from("a".repeat(1024 * 1024 + 1)).toString("base64"),
            name: "large.txt",
            parentPath: "",
            workspaceRoot,
          }),
        ),
      ]);

      expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 413]);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("preserves strict canonical workspace-relative path validation", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-import-data-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-import-workspace-"));
    mkdirSync(path.join(workspaceRoot, "nested"));
    const handler = createDroppedFileImportApiHandler({ dataRoot });

    try {
      for (const parentPath of ["nested\\child", "./nested", ".hidden"]) {
        const response = await handler(
          importRequest({
            contentBase64: Buffer.from("content").toString("base64"),
            name: "file.txt",
            parentPath,
            workspaceRoot,
          }),
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
          message: "Invalid workspace-relative path",
        });
      }
      expect(existsSync(path.join(workspaceRoot, "nested", "file.txt"))).toBe(false);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("rejects malformed base64, invalid UTF-8, and symlink parent escapes", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-import-data-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-import-workspace-"));
    const outsideRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-import-outside-"));
    symlinkSync(outsideRoot, path.join(workspaceRoot, "outside"));
    const handler = createDroppedFileImportApiHandler({ dataRoot });

    try {
      const malformed = await handler(
        importRequest({
          contentBase64: "not-base64",
          name: "malformed.txt",
          parentPath: "",
          workspaceRoot,
        }),
      );
      const invalidUtf8 = await handler(
        importRequest({
          contentBase64: Buffer.from([0xff]).toString("base64"),
          name: "invalid.txt",
          parentPath: "",
          workspaceRoot,
        }),
      );
      const escapedParent = await handler(
        importRequest({
          contentBase64: Buffer.from("outside").toString("base64"),
          name: "escape.txt",
          parentPath: "outside",
          workspaceRoot,
        }),
      );

      expect([malformed.status, invalidUtf8.status, escapedParent.status]).toEqual([
        400,
        400,
        400,
      ]);
      expect(existsSync(path.join(workspaceRoot, "malformed.txt"))).toBe(false);
      expect(existsSync(path.join(workspaceRoot, "invalid.txt"))).toBe(false);
      expect(existsSync(path.join(outsideRoot, "escape.txt"))).toBe(false);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
      rmSync(outsideRoot, { force: true, recursive: true });
    }
  });

  it("rolls back the created file when order metadata cannot be saved", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-import-"));
    const dataRoot = path.join(root, "not-a-directory");
    const workspaceRoot = path.join(root, "workspace");
    writeFileSync(dataRoot, "file");
    mkdirSync(workspaceRoot);
    writeFileSync(path.join(workspaceRoot, "A.txt"), "A");
    writeFileSync(path.join(workspaceRoot, "B.txt"), "B");

    try {
      const response = await createDroppedFileImportApiHandler({ dataRoot })(
        importRequest({
          contentBase64: Buffer.from("C").toString("base64"),
          insertBeforePath: "B.txt",
          name: "C.txt",
          parentPath: "",
          workspaceRoot,
        }),
      );

      expect(response.status).toBe(500);
      expect(existsSync(path.join(workspaceRoot, "C.txt"))).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
