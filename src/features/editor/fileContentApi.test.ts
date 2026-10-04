import {
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
import { createFileContentApiHandler } from "./fileContentApi";
import type { WorkspaceFileStore } from "../workspace/workspaceFileStore";

function readRequest(workspaceRoot: string, filePath: string) {
  const url = new URL("http://localhost/api/files/content");
  url.searchParams.set("workspaceRoot", workspaceRoot);
  url.searchParams.set("path", filePath);
  return new Request(url);
}

function saveRequest(workspaceRoot: string, filePath: string, content: string) {
  return new Request("http://localhost/api/files/content", {
    body: JSON.stringify({ content, path: filePath, workspaceRoot }),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
}

describe("file content API", () => {
  it("uses an injected workspace file store for reads and saves", async () => {
    const calls: string[] = [];
    const store: WorkspaceFileStore = {
      createContext: async (workspaceRoot) => {
        calls.push(`context:${workspaceRoot}`);
        return { workspaceRoot: "/workspace" };
      },
      createDirectory: async () => {
        throw new Error("unused");
      },
      createFile: async () => {
        throw new Error("unused");
      },
      createFileBytes: async () => {
        throw new Error("unused");
      },
      delete: async () => {
        throw new Error("unused");
      },
      exists: async () => false,
      getFileTree: async () => ({ items: [], limit: 100, truncated: false }),
      getRecentTextFiles: async () => ({
        files: [],
        omittedFileCount: 0,
        truncated: false,
      }),
      listChildFiles: async () => [],
      readTextFile: async (context, filePath) => {
        calls.push(`root:${context.workspaceRoot}`);
        calls.push(`read:${filePath}`);
        return {
          content: "from store",
          path: "normalized.txt",
          truncated: false,
        };
      },
      rename: async () => {
        throw new Error("unused");
      },
      saveTextFile: async (context, filePath, content) => {
        calls.push(`root:${context.workspaceRoot}`);
        calls.push(`save:${filePath}:${content}`);
        return "saved.txt";
      },
    };
    const handler = createFileContentApiHandler({ fileStore: store });

    const readResponse = await handler(readRequest("/workspace", "note.txt"));
    const saveResponse = await handler(
      saveRequest("/workspace", "note.txt", "saved"),
    );

    await expect(readResponse.json()).resolves.toMatchObject({
      content: "from store",
      path: "normalized.txt",
    });
    await expect(saveResponse.json()).resolves.toMatchObject({
      content: "saved",
      path: "saved.txt",
    });
    expect(calls).toEqual([
      "context:/workspace",
      "root:/workspace",
      "read:note.txt",
      "context:/workspace",
      "root:/workspace",
      "save:note.txt:saved",
    ]);
  });

  it("reads and saves a workspace-relative text file", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-content-"));
    writeFileSync(path.join(root, "note.txt"), "before");

    try {
      const handler = createFileContentApiHandler();

      const readResponse = await handler(readRequest(root, "note.txt"));
      expect(readResponse.status).toBe(200);
      await expect(readResponse.json()).resolves.toMatchObject({
        content: "before",
        path: "note.txt",
      });

      const saveResponse = await handler(
        saveRequest(root, "note.txt", "after"),
      );
      expect(saveResponse.status).toBe(200);
      expect(readFileSync(path.join(root, "note.txt"), "utf8")).toBe("after");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("rejects saves for hidden path segments", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-content-"));
    mkdirSync(path.join(root, ".private"), { recursive: true });
    writeFileSync(path.join(root, ".private/note.txt"), "before");

    try {
      const response = await createFileContentApiHandler()(
        saveRequest(root, ".private/note.txt", "after"),
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.message).toMatch(/hidden/i);
      expect(readFileSync(path.join(root, ".private/note.txt"), "utf8")).toBe(
        "before",
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("rejects binary-looking files with a clear error", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-content-"));
    writeFileSync(
      path.join(root, "binary.dat"),
      Buffer.from([0x61, 0x00, 0x62]),
    );

    try {
      const response = await createFileContentApiHandler()(
        readRequest(root, "binary.dat"),
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.message).toMatch(/binary/i);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("rejects symlink escapes when reading", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-content-"));
    const outsideFile = path.join(tmpdir(), "ghostwriter-outside.txt");
    writeFileSync(outsideFile, "outside");
    symlinkSync(outsideFile, path.join(root, "link.txt"));

    try {
      const response = await createFileContentApiHandler()(
        readRequest(root, "link.txt"),
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.message).toMatch(/escape/i);
    } finally {
      rmSync(outsideFile, { force: true });
      rmSync(root, { force: true, recursive: true });
    }
  });
});
