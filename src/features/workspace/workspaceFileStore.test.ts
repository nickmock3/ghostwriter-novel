import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { localWorkspaceFileStore } from "./workspaceFileStore";

describe("localWorkspaceFileStore", () => {
  it("reads, writes, creates, renames, deletes, and lists workspace-relative files", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-store-"));
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "docs/note.md"), "before", "utf8");

    try {
      const context = await localWorkspaceFileStore.createContext(root);

      await expect(
        localWorkspaceFileStore.readTextFile(context, "docs/note.md"),
      ).resolves.toMatchObject({
        content: "before",
        path: "docs/note.md",
        truncated: false,
      });

      await localWorkspaceFileStore.saveTextFile(
        context,
        "docs/note.md",
        "after",
      );
      await localWorkspaceFileStore.createDirectory(context, "new");
      await localWorkspaceFileStore.createFile(
        context,
        "new/file.txt",
        "created",
      );
      await localWorkspaceFileStore.rename(
        context,
        "new/file.txt",
        "new/renamed.txt",
      );
      await localWorkspaceFileStore.delete(context, "docs/note.md");

      const tree = await localWorkspaceFileStore.getFileTree(context, {
        filter: "",
        includeNoisyDirectories: false,
        limit: 100,
      });

      expect(readFileSync(path.join(root, "new/renamed.txt"), "utf8")).toBe(
        "created",
      );
      expect(existsSync(path.join(root, "docs/note.md"))).toBe(false);
      expect(tree.items).toContainEqual({ kind: "directory", path: "new" });
      expect(tree.items).toContainEqual({
        kind: "file",
        path: "new/renamed.txt",
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("keeps local filesystem safety checks inside the store boundary", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-store-"));
    const outside = mkdtempSync(
      path.join(tmpdir(), "ghostwriter-outside-"),
    );
    writeFileSync(
      path.join(root, "binary.dat"),
      Buffer.from([0x61, 0x00, 0x62]),
    );
    writeFileSync(path.join(outside, "outside.txt"), "outside", "utf8");
    symlinkSync(path.join(outside, "outside.txt"), path.join(root, "link.txt"));

    try {
      const context = await localWorkspaceFileStore.createContext(root);

      await expect(
        localWorkspaceFileStore.readTextFile(context, "binary.dat"),
      ).rejects.toThrow(/binary/i);
      await expect(
        localWorkspaceFileStore.readTextFile(context, "link.txt"),
      ).rejects.toThrow(/escape/i);
      await expect(
        localWorkspaceFileStore.saveTextFile(
          context,
          ".private/note.txt",
          "hidden",
        ),
      ).rejects.toThrow(/hidden/i);
      await expect(
        localWorkspaceFileStore.createFile(context, "../outside.txt", "escape"),
      ).rejects.toThrow(/workspace/i);
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });

  it("accepts Windows-style relative paths but returns POSIX workspace paths", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-store-"));

    try {
      const context = await localWorkspaceFileStore.createContext(root);

      await expect(
        localWorkspaceFileStore.createDirectory(context, "小説\\第001章"),
      ).resolves.toBe("小説/第001章");
      await expect(
        localWorkspaceFileStore.createFile(
          context,
          "小説\\第001章\\本文.txt",
          "本文",
        ),
      ).resolves.toBe("小説/第001章/本文.txt");
      await expect(
        localWorkspaceFileStore.readTextFile(context, "小説\\第001章\\本文.txt"),
      ).resolves.toMatchObject({
        content: "本文",
        path: "小説/第001章/本文.txt",
      });
      await expect(
        localWorkspaceFileStore.rename(
          context,
          "小説\\第001章\\本文.txt",
          "小説\\第001章\\改稿.txt",
        ),
      ).resolves.toEqual({
        newPath: "小説/第001章/改稿.txt",
        path: "小説/第001章/本文.txt",
      });

      const tree = await localWorkspaceFileStore.getFileTree(context, {
        filter: "",
        includeNoisyDirectories: false,
        limit: 100,
      });

      expect(existsSync(path.join(root, "小説", "第001章", "改稿.txt"))).toBe(
        true,
      );
      expect(tree.items).toContainEqual({
        kind: "file",
        path: "小説/第001章/改稿.txt",
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("walks filtered trees while skipping symlinks and noisy directories, and truncates by limit", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-store-tree-"));
    const outside = mkdtempSync(
      path.join(tmpdir(), "ghostwriter-outside-tree-"),
    );
    mkdirSync(path.join(root, "docs"), { recursive: true });
    mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "docs/alpha.md"), "a", "utf8");
    writeFileSync(path.join(root, "docs/beta.txt"), "b", "utf8");
    writeFileSync(path.join(root, "src/main.ts"), "c", "utf8");
    writeFileSync(path.join(root, "node_modules/pkg/index.js"), "d", "utf8");
    writeFileSync(path.join(outside, "outside.txt"), "outside", "utf8");
    symlinkSync(
      path.join(outside, "outside.txt"),
      path.join(root, "docs/link.txt"),
    );

    try {
      const context = await localWorkspaceFileStore.createContext(root);

      const filtered = await localWorkspaceFileStore.getFileTree(context, {
        filter: "alpha",
        includeNoisyDirectories: false,
        limit: 100,
      });
      expect(filtered.items).toEqual([
        { kind: "directory", path: "docs" },
        { kind: "file", path: "docs/alpha.md" },
      ]);
      expect(filtered.truncated).toBe(false);

      const withoutNoisy = await localWorkspaceFileStore.getFileTree(context, {
        filter: "",
        includeNoisyDirectories: false,
        limit: 100,
      });
      expect(withoutNoisy.items.map((item) => item.path)).not.toContain(
        "node_modules",
      );
      expect(withoutNoisy.items.map((item) => item.path)).not.toContain(
        "docs/link.txt",
      );

      const withNoisy = await localWorkspaceFileStore.getFileTree(context, {
        filter: "",
        includeNoisyDirectories: true,
        limit: 100,
      });
      expect(withNoisy.items).toContainEqual({
        kind: "directory",
        path: "node_modules",
      });

      const truncated = await localWorkspaceFileStore.getFileTree(context, {
        filter: "",
        includeNoisyDirectories: false,
        limit: 2,
      });
      expect(truncated.items).toHaveLength(2);
      expect(truncated.limit).toBe(2);
      expect(truncated.truncated).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });

  it("lists recent text files by mtime while skipping binary, noisy, and symlink entries", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-store-recent-"));
    const outside = mkdtempSync(
      path.join(tmpdir(), "ghostwriter-outside-recent-"),
    );
    mkdirSync(path.join(root, "docs"), { recursive: true });
    mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(path.join(root, "docs/older.md"), "older", "utf8");
    writeFileSync(path.join(root, "docs/newer.md"), "newer", "utf8");
    writeFileSync(path.join(root, "docs/mid.md"), "mid", "utf8");
    writeFileSync(
      path.join(root, "docs/binary.dat"),
      Buffer.from([0x61, 0x00, 0x62]),
    );
    writeFileSync(path.join(root, "node_modules/pkg/index.js"), "noisy", "utf8");
    writeFileSync(path.join(outside, "outside.txt"), "outside", "utf8");
    symlinkSync(
      path.join(outside, "outside.txt"),
      path.join(root, "docs/link.txt"),
    );

    const olderTime = new Date("2024-01-01T00:00:00.000Z");
    const midTime = new Date("2024-02-01T00:00:00.000Z");
    const newerTime = new Date("2024-03-01T00:00:00.000Z");
    utimesSync(path.join(root, "docs/older.md"), olderTime, olderTime);
    utimesSync(path.join(root, "docs/mid.md"), midTime, midTime);
    utimesSync(path.join(root, "docs/newer.md"), newerTime, newerTime);

    try {
      const context = await localWorkspaceFileStore.createContext(root);

      const recent = await localWorkspaceFileStore.getRecentTextFiles(context, {
        maxFiles: 2,
      });

      expect(recent.files.map((file) => file.path)).toEqual([
        "docs/newer.md",
        "docs/mid.md",
      ]);
      expect(recent.files[0]?.mtime).toBe(newerTime.toISOString());
      expect(recent.omittedFileCount).toBe(1);
      expect(recent.truncated).toBe(true);
      expect(recent.files.map((file) => file.path)).not.toContain(
        "docs/binary.dat",
      );
      expect(recent.files.map((file) => file.path)).not.toContain(
        "docs/link.txt",
      );
      expect(recent.files.map((file) => file.path)).not.toContain(
        "node_modules/pkg/index.js",
      );

      const childFiles = await localWorkspaceFileStore.listChildFiles(
        context,
        "docs",
      );
      expect(childFiles).toEqual([
        "docs/binary.dat",
        "docs/mid.md",
        "docs/newer.md",
        "docs/older.md",
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });
});
