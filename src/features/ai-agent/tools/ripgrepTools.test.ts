import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  globToolInputSchema,
  globWorkspace,
  grepToolOutputSchema,
  grepWorkspace,
  readWorkspaceFile,
  searchWorkspace,
} from "./ripgrepTools";

function makeWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-tools-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, "docs"), { recursive: true });
  return root;
}

describe("ripgrep tool services", () => {
  it("reads a safe text file and reports line truncation", async () => {
    const root = makeWorkspace();
    const content = Array.from({ length: 2005 }, (_, index) => `line ${index + 1}`).join("\n");
    writeFileSync(path.join(root, "src/large.txt"), content);

    try {
      const result = await readWorkspaceFile({ path: "src/large.txt", workspaceRoot: root });

      expect(result.path).toBe("src/large.txt");
      expect(result.truncated).toBe(true);
      expect(result.totalLines).toBe(2005);
      expect(result.content.split("\n")).toHaveLength(2001);
      expect(result.content).toContain("line 2000");
      expect(result.content).toContain("[truncated after 2000 lines]");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("normalizes Windows-style read paths to POSIX workspace paths", async () => {
    const root = makeWorkspace();
    mkdirSync(path.join(root, "src", "nested"), { recursive: true });
    writeFileSync(path.join(root, "src", "nested", "note.txt"), "hello\n", "utf8");

    try {
      await expect(
        readWorkspaceFile({
          path: "src\\nested\\note.txt",
          workspaceRoot: root,
        }),
      ).resolves.toMatchObject({
        content: "hello\n",
        path: "src/nested/note.txt",
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("rejects workspace escapes when reading", async () => {
    const root = makeWorkspace();
    const outsideFile = path.join(tmpdir(), "ghostwriter-tools-outside.txt");
    writeFileSync(outsideFile, "outside");
    symlinkSync(outsideFile, path.join(root, "src/link.txt"));

    try {
      await expect(
        readWorkspaceFile({ path: "src/link.txt", workspaceRoot: root }),
      ).rejects.toThrow(/escape/i);
    } finally {
      rmSync(outsideFile, { force: true });
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("uses rg-style glob input validation", () => {
    expect(() => globToolInputSchema.parse({ pattern: "", workspaceRoot: "/tmp" })).toThrow();
  });

  it("lists glob matches from rg --files with a 10 result limit", async () => {
    const root = makeWorkspace();
    for (let index = 0; index < 12; index += 1) {
      writeFileSync(path.join(root, `src/file-${index}.txt`), "text\n");
    }
    writeFileSync(path.join(root, "docs/skip.md"), "text\n");

    try {
      const result = await globWorkspace({ pattern: "src/*.txt", workspaceRoot: root });

      expect(result.matches).toHaveLength(10);
      expect(result.limit).toBe(10);
      expect(result.truncated).toBe(true);
      expect(result.matches.every((match) => match.startsWith("src/file-"))).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("lists files and directories including empty directories with stable ordering", async () => {
    const root = makeWorkspace();
    mkdirSync(path.join(root, "src/empty"), { recursive: true });
    mkdirSync(path.join(root, "src/nested"), { recursive: true });
    writeFileSync(path.join(root, "src/app.txt"), "text\n");
    writeFileSync(path.join(root, "src/nested/file.txt"), "text\n");

    try {
      const result = await globWorkspace({ pattern: "src/**", workspaceRoot: root });

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

  it("applies the glob pattern to both files and directories and truncates the combined result", async () => {
    const root = makeWorkspace();
    for (let index = 0; index < 6; index += 1) {
      mkdirSync(path.join(root, `src/module-${index}`), { recursive: true });
      writeFileSync(path.join(root, `src/file-${index}.txt`), "text\n");
    }

    try {
      const result = await globWorkspace({ pattern: "src/*", workspaceRoot: root });

      expect(result.matches).toHaveLength(10);
      expect(result.limit).toBe(10);
      expect(result.truncated).toBe(true);
      expect(result.matches).toEqual([...result.matches].sort());
      expect(result.matches.every((match) => match.startsWith("src/"))).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("does not return symlinked directories that escape the workspace", async () => {
    const root = makeWorkspace();
    const outsideDir = mkdtempSync(path.join(tmpdir(), "ghostwriter-tools-outside-dir-"));
    writeFileSync(path.join(outsideDir, "outside.txt"), "outside\n");
    symlinkSync(outsideDir, path.join(root, "src/outside-link"));

    try {
      const result = await globWorkspace({ pattern: "src/**", workspaceRoot: root });

      expect(result.matches).not.toContain("src/outside-link");
      expect(result.matches).not.toContain("src/outside-link/outside.txt");
    } finally {
      rmSync(outsideDir, { force: true, recursive: true });
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("returns grep matches with path, line number, line text, and a 10 result limit", async () => {
    const root = makeWorkspace();
    for (let index = 0; index < 12; index += 1) {
      writeFileSync(path.join(root, `src/file-${index}.txt`), `alpha match ${index}\n`);
    }

    try {
      const result = await grepWorkspace({ query: "alpha", workspaceRoot: root });

      expect(result.matches).toHaveLength(10);
      expect(result.limit).toBe(10);
      expect(result.truncated).toBe(true);
      expect(result.matches[0]).toMatchObject({
        line: expect.stringContaining("alpha"),
        lineNumber: 1,
      });
      expect(grepToolOutputSchema.parse(result)).toEqual(result);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("ranks natural-language search snippets from local rg results", async () => {
    const root = makeWorkspace();
    writeFileSync(path.join(root, "docs/agent.md"), "The agent can read files and grep text.\n");
    writeFileSync(path.join(root, "docs/other.md"), "Unrelated content.\n");

    try {
      const result = await searchWorkspace({
        query: "How does the agent grep files?",
        workspaceRoot: root,
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
});
