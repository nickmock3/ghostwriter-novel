// @vitest-environment node
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createLocalWorkspaceSearchStore,
  localWorkspaceSearchStore,
} from "./workspaceSearchStore";
import { resolveWorkspaceRoot } from "./workspacePaths";

vi.mock("node:child_process", async original => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

function makeWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-search-store-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, "docs"), { recursive: true });
  return root;
}

describe("localWorkspaceSearchStore", () => {
  it("searches real files without showing a child console", async () => {
    const root = makeWorkspace();
    writeFileSync(path.join(root, "src/app.txt"), "text\n");
    try {
      const context = await localWorkspaceSearchStore.createContext(root);
      expect(await localWorkspaceSearchStore.glob(context, { pattern: "src/**" }))
        .toMatchObject({ matches: ["src/app.txt"] });
      expect(spawn).toHaveBeenCalledWith(expect.any(String), expect.any(Array),
        expect.objectContaining({ windowsHide: true }));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
  it("runs searches with an explicitly injected ripgrep executable", async () => {
    const root = makeWorkspace();
    writeFileSync(path.join(root, "src/app.txt"), "text\n");
    const invocations: Array<{ args: string[]; command: string; cwd: string }> = [];
    const store = createLocalWorkspaceSearchStore({
      rgExecutable: "/desktop/resources/bin/rg",
      runCommand: async (command, args, cwd) => {
        invocations.push({ args, command, cwd });
        return {
          exitCode: 0,
          stderr: "",
          stdout: "src/app.txt\n",
        };
      },
    });

    try {
      const context = await store.createContext(root);
      await expect(store.glob(context, { pattern: "src/**" })).resolves.toMatchObject({
        matches: ["src/app.txt"],
      });
      const resolvedRoot = await resolveWorkspaceRoot(root);
      expect(invocations).toEqual([
        {
          args: ["--files"],
          command: "/desktop/resources/bin/rg",
          cwd: resolvedRoot,
        },
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("creates a workspace search context from a workspace root", async () => {
    const root = makeWorkspace();

    try {
      const resolvedRoot = await resolveWorkspaceRoot(root);
      await expect(localWorkspaceSearchStore.createContext(root)).resolves.toEqual({
        workspaceRoot: resolvedRoot,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("returns files and directories from glob searches with a 10 item limit", async () => {
    const root = makeWorkspace();
    mkdirSync(path.join(root, "src/empty"), { recursive: true });
    mkdirSync(path.join(root, "src/nested"), { recursive: true });
    writeFileSync(path.join(root, "src/app.txt"), "text\n");
    writeFileSync(path.join(root, "src/nested/file.txt"), "text\n");

    try {
      const context = await localWorkspaceSearchStore.createContext(root);
      const result = await localWorkspaceSearchStore.glob(context, { pattern: "src/**" });

      expect(result).toMatchObject({
        limit: 10,
        truncated: false,
      });
      expect(result.matches).toEqual([
        "src/app.txt",
        "src/empty",
        "src/nested",
        "src/nested/file.txt",
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("returns exact grep matches with line numbers and truncation", async () => {
    const root = makeWorkspace();
    for (let index = 0; index < 12; index += 1) {
      writeFileSync(path.join(root, `src/file-${index}.txt`), `alpha match ${index}\n`);
    }

    try {
      const context = await localWorkspaceSearchStore.createContext(root);
      const result = await localWorkspaceSearchStore.grep(context, { query: "alpha" });

      expect(result.matches).toHaveLength(10);
      expect(result.limit).toBe(10);
      expect(result.truncated).toBe(true);
      expect(result.matches[0]).toMatchObject({
        line: expect.stringContaining("alpha"),
        lineNumber: 1,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("accepts Windows-style grep paths and glob patterns while returning POSIX paths", async () => {
    const root = makeWorkspace();
    mkdirSync(path.join(root, "src", "nested"), { recursive: true });
    writeFileSync(path.join(root, "src", "nested", "file.txt"), "alpha\n");

    try {
      const context = await localWorkspaceSearchStore.createContext(root);
      const globResult = await localWorkspaceSearchStore.glob(context, {
        pattern: "src\\nested\\*.txt",
      });
      const grepResult = await localWorkspaceSearchStore.grep(context, {
        options: { path: "src\\nested\\file.txt" },
        query: "alpha",
      });

      expect(globResult.matches).toEqual(["src/nested/file.txt"]);
      expect(grepResult.matches).toEqual([
        {
          line: "alpha",
          lineNumber: 1,
          path: "src/nested/file.txt",
        },
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("ranks natural-language search snippets from local rg results", async () => {
    const root = makeWorkspace();
    writeFileSync(path.join(root, "docs/agent.md"), "The agent can read files and grep text.\n");
    writeFileSync(path.join(root, "docs/other.md"), "Unrelated content.\n");

    try {
      const context = await localWorkspaceSearchStore.createContext(root);
      const result = await localWorkspaceSearchStore.search(context, {
        query: "How does the agent grep files?",
      });

      expect(result.results[0]).toMatchObject({
        path: "docs/agent.md",
        lineNumber: 1,
      });
      expect(result.results[0].snippet).toContain("agent");
      expect(result.results).toHaveLength(1);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("does not return symlinked directories that escape the workspace", async () => {
    const root = makeWorkspace();
    const outsideDir = mkdtempSync(path.join(tmpdir(), "ghostwriter-search-store-outside-"));
    writeFileSync(path.join(outsideDir, "outside.txt"), "outside\n");
    symlinkSync(outsideDir, path.join(root, "src/outside-link"));

    try {
      const context = await localWorkspaceSearchStore.createContext(root);
      const result = await localWorkspaceSearchStore.glob(context, { pattern: "src/**" });

      expect(result.matches).not.toContain("src/outside-link");
      expect(result.matches).not.toContain("src/outside-link/outside.txt");
    } finally {
      rmSync(outsideDir, { force: true, recursive: true });
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("filters grep and search matches whose symlinked paths escape the workspace", async () => {
    const root = makeWorkspace();
    const outsideDir = mkdtempSync(path.join(tmpdir(), "ghostwriter-search-store-outside-"));
    writeFileSync(path.join(outsideDir, "outside.txt"), "outside\n");
    symlinkSync(outsideDir, path.join(root, "src/outside-link"));
    const store = createLocalWorkspaceSearchStore({
      rgExecutable: "rg",
      runCommand: async () => ({
        exitCode: 0,
        stderr: "",
        stdout: "src/outside-link/outside.txt:1:outside\n",
      }),
    });

    try {
      const context = await store.createContext(root);

      await expect(store.grep(context, { query: "outside" })).resolves.toMatchObject({
        matches: [],
      });
      await expect(store.search(context, { query: "outside" })).resolves.toMatchObject({
        results: [],
      });
    } finally {
      rmSync(outsideDir, { force: true, recursive: true });
      rmSync(root, { force: true, recursive: true });
    }
  });
});
