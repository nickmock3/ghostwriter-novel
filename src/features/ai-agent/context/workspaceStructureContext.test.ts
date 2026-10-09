import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { notifyWorkspaceChanged } from "../../workspace/workspaceChangedNotifier";
import {
  getWorkspaceStructureContext,
  invalidateWorkspaceStructureContext,
  loadWorkspaceStructureContext,
} from "./workspaceStructureContext";

const tempRoots: string[] = [];

function makeWorkspace(): string {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-structure-"));
  tempRoots.push(workspaceRoot);
  return workspaceRoot;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    invalidateWorkspaceStructureContext(root);
    rmSync(root, { force: true, recursive: true });
  }
});

describe("workspace structure context", () => {
  it("summarizes workspace structure with relative paths and metadata", async () => {
    const workspaceRoot = makeWorkspace();
    mkdirSync(path.join(workspaceRoot, "src/features"), { recursive: true });
    mkdirSync(path.join(workspaceRoot, "docs"), { recursive: true });
    writeFileSync(path.join(workspaceRoot, "README.md"), "hello", "utf8");
    writeFileSync(path.join(workspaceRoot, "src/features/App.tsx"), "app", "utf8");

    const context = await loadWorkspaceStructureContext({ workspaceRoot });

    expect(context.workspaceRoot).toBe(workspaceRoot);
    expect(context.generatedAt).toMatch(/T/);
    expect(context.directoryCount).toBeGreaterThanOrEqual(2);
    expect(context.fileCount).toBe(2);
    expect(context.truncated).toBe(false);
    expect(context.summary).toContain("..");
    expect(context.summary).toContain("docs/");
    expect(context.summary).toContain("src/");
    expect(context.summary).toContain("README.md");
    expect(context.summary).not.toContain(workspaceRoot);
  });

  it("excludes noisy directories by default", async () => {
    const workspaceRoot = makeWorkspace();
    mkdirSync(path.join(workspaceRoot, "node_modules/pkg"), { recursive: true });
    mkdirSync(path.join(workspaceRoot, ".git/objects"), { recursive: true });
    mkdirSync(path.join(workspaceRoot, "dist"), { recursive: true });
    mkdirSync(path.join(workspaceRoot, ".data"), { recursive: true });
    mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    writeFileSync(path.join(workspaceRoot, "node_modules/pkg/index.js"), "ignored", "utf8");
    writeFileSync(path.join(workspaceRoot, "src/app.ts"), "included", "utf8");

    const context = await loadWorkspaceStructureContext({ workspaceRoot });

    expect(context.summary).toContain("src/");
    expect(context.summary).toContain("src/app.ts");
    expect(context.summary).not.toContain("node_modules");
    expect(context.summary).not.toContain(".git");
    expect(context.summary).not.toContain("dist/");
    expect(context.summary).not.toContain(".data");
  });

  it("truncates long summaries and reports omitted entries", async () => {
    const workspaceRoot = makeWorkspace();
    for (let index = 0; index < 8; index += 1) {
      writeFileSync(path.join(workspaceRoot, `file-${index}.txt`), "x", "utf8");
    }

    const context = await loadWorkspaceStructureContext({ maxEntries: 3, workspaceRoot });

    expect(context.truncated).toBe(true);
    expect(context.omittedEntryCount).toBeGreaterThan(0);
    expect(context.summary).toContain("Summary truncated");
  });

  it("caches summaries until invalidated", async () => {
    const workspaceRoot = makeWorkspace();
    writeFileSync(path.join(workspaceRoot, "before.txt"), "x", "utf8");

    const first = await getWorkspaceStructureContext({ workspaceRoot });
    writeFileSync(path.join(workspaceRoot, "after.txt"), "x", "utf8");
    const cached = await getWorkspaceStructureContext({ workspaceRoot });
    invalidateWorkspaceStructureContext(workspaceRoot);
    const refreshed = await getWorkspaceStructureContext({ workspaceRoot });

    expect(first.summary).toContain("before.txt");
    expect(cached.summary).not.toContain("after.txt");
    expect(refreshed.summary).toContain("after.txt");
  });

  it("invalidates cached summaries when workspace changed is notified", async () => {
    const workspaceRoot = makeWorkspace();
    writeFileSync(path.join(workspaceRoot, "before.txt"), "x", "utf8");

    const first = await getWorkspaceStructureContext({ workspaceRoot });
    writeFileSync(path.join(workspaceRoot, "after.txt"), "x", "utf8");
    const cached = await getWorkspaceStructureContext({ workspaceRoot });
    notifyWorkspaceChanged(workspaceRoot);
    const refreshed = await getWorkspaceStructureContext({ workspaceRoot });

    expect(first.summary).toContain("before.txt");
    expect(cached.summary).not.toContain("after.txt");
    expect(refreshed.summary).toContain("after.txt");
  });
});
