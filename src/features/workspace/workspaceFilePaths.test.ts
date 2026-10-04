import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeWorkspaceRelativePath,
  resolveWorkspaceFilePath,
} from "./workspaceFilePaths";

describe("workspace file paths", () => {
  it("normalizes slash and backslash workspace-relative paths to POSIX separators", () => {
    expect(normalizeWorkspaceRelativePath("小説\\第001章\\本文.txt")).toBe(
      "小説/第001章/本文.txt",
    );
    expect(normalizeWorkspaceRelativePath("小説/第001章\\本文.txt")).toBe(
      "小説/第001章/本文.txt",
    );
    expect(normalizeWorkspaceRelativePath("./notes\\today.md")).toBe(
      "notes/today.md",
    );
  });

  it("rejects traversal and hidden segments after backslash normalization", () => {
    expect(() => normalizeWorkspaceRelativePath("notes\\..\\..\\secret.txt")).toThrow(
      /workspace/i,
    );
    expect(() => normalizeWorkspaceRelativePath("notes\\.secret\\key.txt")).not.toThrow();
  });

  it("supports opt-in strict validation without changing default normalization", () => {
    expect(normalizeWorkspaceRelativePath("./notes\\today.md")).toBe(
      "notes/today.md",
    );
    expect(() =>
      normalizeWorkspaceRelativePath("", { allowEmpty: false }),
    ).toThrow(/empty/i);
    expect(normalizeWorkspaceRelativePath("", { allowEmpty: true })).toBe("");

    const strictOptions = {
      rejectBackslashes: true,
      rejectHiddenSegments: true,
      rejectNullBytes: true,
      requireCanonical: true,
    };
    expect(() => normalizeWorkspaceRelativePath("nested\\child", strictOptions)).toThrow();
    expect(() => normalizeWorkspaceRelativePath("./nested", strictOptions)).toThrow();
    expect(() => normalizeWorkspaceRelativePath("nested/", strictOptions)).toThrow();
    expect(() => normalizeWorkspaceRelativePath(".hidden", strictOptions)).toThrow();
    expect(() => normalizeWorkspaceRelativePath("nested\u0000child", strictOptions)).toThrow();
    expect(normalizeWorkspaceRelativePath("nested/child", strictOptions)).toBe(
      "nested/child",
    );
  });

  it("resolves backslash input to the same file and returns a POSIX workspace path", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "novel-editor-paths-"));
    mkdirSync(path.join(root, "小説", "第001章"), { recursive: true });
    writeFileSync(path.join(root, "小説", "第001章", "本文.txt"), "本文", "utf8");

    try {
      await expect(
        resolveWorkspaceFilePath(root, "小説\\第001章\\本文.txt", {
          requireExisting: true,
        }),
      ).resolves.toMatchObject({
        workspaceRelativePath: "小説/第001章/本文.txt",
      });

      await expect(
        resolveWorkspaceFilePath(root, ".hidden\\note.txt", {
          rejectHiddenSegments: true,
        }),
      ).rejects.toThrow(/hidden/i);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
