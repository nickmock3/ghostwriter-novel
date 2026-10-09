import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRecentTextFilesContext } from "./recentTextFilesContext";

const tempRoots: string[] = [];

function makeWorkspace(): string {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-recent-files-"));
  tempRoots.push(workspaceRoot);
  return workspaceRoot;
}

function setMtime(filePath: string, isoDate: string): void {
  const date = new Date(isoDate);
  utimesSync(filePath, date, date);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("recent text files context", () => {
  it("returns recent text files as workspace-relative lightweight metadata", async () => {
    const workspaceRoot = makeWorkspace();
    mkdirSync(path.join(workspaceRoot, "notes"));
    writeFileSync(path.join(workspaceRoot, "older.txt"), "old", "utf8");
    writeFileSync(path.join(workspaceRoot, "notes/newer.md"), "new", "utf8");
    setMtime(path.join(workspaceRoot, "older.txt"), "2026-05-10T00:00:00.000Z");
    setMtime(path.join(workspaceRoot, "notes/newer.md"), "2026-05-12T00:00:00.000Z");

    const context = await loadRecentTextFilesContext({ workspaceRoot });

    expect(context.generatedAt).toMatch(/T/);
    expect(context.maxFiles).toBe(10);
    expect(context.files).toEqual([
      expect.objectContaining({
        mtime: "2026-05-12T00:00:00.000Z",
        path: "notes/newer.md",
        size: 3,
      }),
      expect.objectContaining({
        mtime: "2026-05-10T00:00:00.000Z",
        path: "older.txt",
        size: 3,
      }),
    ]);
    expect(JSON.stringify(context)).not.toContain(workspaceRoot);
  });

  it("limits results and sorts ties by relative path for stable ordering", async () => {
    const workspaceRoot = makeWorkspace();
    for (const fileName of ["c.txt", "a.txt", "b.txt"]) {
      writeFileSync(path.join(workspaceRoot, fileName), fileName, "utf8");
      setMtime(path.join(workspaceRoot, fileName), "2026-05-12T00:00:00.000Z");
    }

    const context = await loadRecentTextFilesContext({ maxFiles: 2, workspaceRoot });

    expect(context.files.map((file) => file.path)).toEqual(["a.txt", "b.txt"]);
    expect(context.maxFiles).toBe(2);
    expect(context.omittedFileCount).toBe(1);
    expect(context.truncated).toBe(true);
  });

  it("excludes binary-looking files, noisy directories, unreadable symlinks, and directories", async () => {
    const workspaceRoot = makeWorkspace();
    mkdirSync(path.join(workspaceRoot, "node_modules/pkg"), { recursive: true });
    mkdirSync(path.join(workspaceRoot, ".git"), { recursive: true });
    mkdirSync(path.join(workspaceRoot, "docs"), { recursive: true });
    writeFileSync(path.join(workspaceRoot, "keep.txt"), "keep", "utf8");
    writeFileSync(path.join(workspaceRoot, "binary.dat"), Buffer.from([0x61, 0x00, 0x62]));
    writeFileSync(path.join(workspaceRoot, "node_modules/pkg/index.js"), "ignored", "utf8");
    writeFileSync(path.join(workspaceRoot, ".git/config"), "ignored", "utf8");
    symlinkSync(path.join(workspaceRoot, "keep.txt"), path.join(workspaceRoot, "linked.txt"));

    const context = await loadRecentTextFilesContext({ workspaceRoot });

    expect(context.files.map((file) => file.path)).toEqual(["keep.txt"]);
  });
});
