import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFileTreeApiHandler } from "./fileTreeApi";
import { insertFileTreeOrder } from "./fileTreeOrderStore";

function makeRequest(workspaceRoot: string, filter = "", includeNoisyDirectories = false) {
  const url = new URL("http://localhost/api/files/tree");
  url.searchParams.set("workspaceRoot", workspaceRoot);
  if (filter) {
    url.searchParams.set("filter", filter);
  }
  if (includeNoisyDirectories) {
    url.searchParams.set("includeNoisyDirectories", "true");
  }
  return new Request(url);
}

describe("file tree API", () => {
  it("applies persisted manual file order while leaving directory entries in place", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-tree-order-data-"));
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-tree-"));
    mkdirSync(path.join(root, "docs"), { recursive: true });
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

      const response = await createFileTreeApiHandler({ dataRoot })(makeRequest(root));
      const body = await response.json();

      expect(body.items).toEqual([
        { kind: "file", path: "A.txt" },
        { kind: "file", path: "C.txt" },
        { kind: "file", path: "B.txt" },
        { kind: "directory", path: "docs" },
      ]);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("lists workspace-relative text files while hiding noisy directories", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-tree-"));
    mkdirSync(path.join(root, "src"), { recursive: true });
    mkdirSync(path.join(root, "node_modules/pkg"), { recursive: true });
    writeFileSync(path.join(root, "README.md"), "hello");
    writeFileSync(path.join(root, "src/app.ts"), "console.log('ok')");
    writeFileSync(path.join(root, "node_modules/pkg/index.js"), "ignored");

    try {
      const response = await createFileTreeApiHandler()(makeRequest(root));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.items).toEqual([
        { kind: "file", path: "README.md" },
        { kind: "directory", path: "src" },
        { kind: "file", path: "src/app.ts" },
      ]);
      expect(body.limit).toBe(100);
      expect(body.truncated).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("limits tree items to 100", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-tree-"));
    for (let index = 0; index < 120; index += 1) {
      writeFileSync(path.join(root, `file-${String(index).padStart(3, "0")}.txt`), "x");
    }

    try {
      const response = await createFileTreeApiHandler()(makeRequest(root));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.items).toHaveLength(100);
      expect(body.truncated).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("includes noisy directories when explicitly requested", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-tree-"));
    mkdirSync(path.join(root, "node_modules/pkg"), { recursive: true });
    writeFileSync(path.join(root, "node_modules/pkg/index.js"), "included");

    try {
      const response = await createFileTreeApiHandler()(makeRequest(root, "", true));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.items).toEqual([
        { kind: "directory", path: "node_modules" },
        { kind: "directory", path: "node_modules/pkg" },
        { kind: "file", path: "node_modules/pkg/index.js" },
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("keeps ancestor directories when filtering nested files", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-tree-"));
    mkdirSync(path.join(root, "src/features"), { recursive: true });
    writeFileSync(path.join(root, "README.md"), "hello");
    writeFileSync(path.join(root, "src/features/App.tsx"), "app");
    writeFileSync(path.join(root, "src/features/Other.tsx"), "other");

    try {
      const response = await createFileTreeApiHandler()(makeRequest(root, "App"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.items).toEqual([
        { kind: "directory", path: "src" },
        { kind: "directory", path: "src/features" },
        { kind: "file", path: "src/features/App.tsx" },
      ]);
      expect(body.truncated).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("skips symlinked entries", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-tree-"));
    const outsideFile = path.join(tmpdir(), "ghostwriter-tree-outside.txt");
    writeFileSync(outsideFile, "outside");
    symlinkSync(outsideFile, path.join(root, "link.txt"));
    writeFileSync(path.join(root, "visible.txt"), "visible");

    try {
      const response = await createFileTreeApiHandler()(makeRequest(root));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.items).toEqual([{ kind: "file", path: "visible.txt" }]);
    } finally {
      rmSync(outsideFile, { force: true });
      rmSync(root, { force: true, recursive: true });
    }
  });
});
