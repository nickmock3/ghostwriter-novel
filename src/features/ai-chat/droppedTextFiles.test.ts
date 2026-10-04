import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  cleanupDroppedTextFiles,
  cleanupDroppedTextFilesForConversation,
  cleanupExpiredDroppedTextFiles,
  droppedTextFileInputsSchema,
  readDroppedTextFile,
  stageDroppedTextFiles,
} from "./droppedTextFiles";

describe("dropped text file input validation", () => {
  it("accepts bounded text files and rejects unsafe names or binary content", () => {
    expect(
      droppedTextFileInputsSchema.parse([{ contentBase64: "", name: "メモ.txt" }]),
    ).toEqual([{ contentBase64: "", name: "メモ.txt" }]);
    expect(() =>
      droppedTextFileInputsSchema.parse([{ contentBase64: "5pys5paH", name: "../escape.txt" }]),
    ).toThrow();
    expect(() =>
      droppedTextFileInputsSchema.parse([
        { contentBase64: Buffer.from("before\u0000after").toString("base64"), name: "binary.dat" },
      ]),
    ).toThrow();
    expect(() =>
      droppedTextFileInputsSchema.parse(
        Array.from({ length: 6 }, (_, index) => ({
          contentBase64: Buffer.from(String(index)).toString("base64"),
          name: `${index}.txt`,
        })),
      ),
    ).toThrow();
  });

  it("enforces per-file and aggregate UTF-8 byte limits", () => {
    expect(() =>
      droppedTextFileInputsSchema.parse([
        {
          contentBase64: Buffer.from("あ".repeat(400_000)).toString("base64"),
          name: "large.txt",
        },
      ]),
    ).toThrow();
    expect(() =>
      droppedTextFileInputsSchema.parse([
        { contentBase64: Buffer.from("a".repeat(700_000)).toString("base64"), name: "a.txt" },
        { contentBase64: Buffer.from("b".repeat(700_000)).toString("base64"), name: "b.txt" },
        { contentBase64: Buffer.from("c".repeat(700_000)).toString("base64"), name: "c.txt" },
      ]),
    ).toThrow();
    expect(() =>
      droppedTextFileInputsSchema.parse([{ contentBase64: "/w==", name: "invalid.txt" }]),
    ).toThrow();
    expect(() =>
      droppedTextFileInputsSchema.parse([{ contentBase64: "eA", name: "noncanonical.txt" }]),
    ).toThrow();
  });
});

describe("dropped text file staging", () => {
  it("binds opaque files to one workspace, conversation, and request context", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-dropped-data-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-dropped-workspace-"));
    const otherWorkspaceRoot = mkdtempSync(
      path.join(tmpdir(), "ghostwriter-dropped-workspace-"),
    );

    try {
      const staged = await stageDroppedTextFiles({
        conversationId: "conversation-1",
        dataRoot,
        files: [
          {
            contentBase64: Buffer.from("第一行\n第二行").toString("base64"),
            name: "notes.txt",
          },
        ],
        workspaceRoot,
      });
      const otherContext = await stageDroppedTextFiles({
        conversationId: "conversation-1",
        dataRoot,
        files: [],
        workspaceRoot: otherWorkspaceRoot,
      });

      expect(staged.files).toHaveLength(1);
      expect(staged.files[0]).toMatchObject({
        name: "notes.txt",
        sizeBytes: new TextEncoder().encode("第一行\n第二行").byteLength,
      });
      expect(staged.files[0]?.id).not.toContain("notes.txt");

      await expect(
        readDroppedTextFile({
          context: staged.context,
          droppedFileId: staged.files[0]!.id,
        }),
      ).resolves.toMatchObject({
        content: "第一行\n第二行",
        name: "notes.txt",
        totalLines: 2,
        truncated: false,
      });
      await expect(
        readDroppedTextFile({
          context: otherContext.context,
          droppedFileId: staged.files[0]!.id,
        }),
      ).rejects.toThrow(/not found|利用できません/i);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
      rmSync(otherWorkspaceRoot, { force: true, recursive: true });
    }
  });

  it("truncates reads at 2000 lines and removes staged files during cleanup", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-dropped-data-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-dropped-workspace-"));

    try {
      const staged = await stageDroppedTextFiles({
        conversationId: "conversation-1",
        dataRoot,
        files: [
          {
            contentBase64: Buffer.from(
              Array.from({ length: 2_001 }, (_, index) => `line-${index}`).join("\n"),
            ).toString("base64"),
            name: "long.txt",
          },
        ],
        workspaceRoot,
      });
      const droppedFileId = staged.files[0]!.id;

      await expect(
        readDroppedTextFile({ context: staged.context, droppedFileId }),
      ).resolves.toMatchObject({
        totalLines: 2_001,
        truncated: true,
      });
      await cleanupDroppedTextFiles(staged.context);
      await expect(
        readDroppedTextFile({ context: staged.context, droppedFileId }),
      ).rejects.toThrow(/not found|利用できません/i);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("preserves BOM and CRLF bytes and expires request-scoped access at the TTL", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-dropped-data-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-dropped-workspace-"));
    const now = new Date("2026-07-23T00:00:00.000Z");
    const bytes = Buffer.from("\uFEFF第一行\r\n第二行\r\n", "utf8");

    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const staged = await stageDroppedTextFiles({
        conversationId: "conversation-ttl",
        dataRoot,
        files: [{ contentBase64: bytes.toString("base64"), name: "windows.txt" }],
        now,
        ttlMs: 1_000,
        workspaceRoot,
      });
      const droppedFileId = staged.files[0]!.id;

      await expect(
        readDroppedTextFile({ context: staged.context, droppedFileId }),
      ).resolves.toMatchObject({
        content: "\uFEFF第一行\r\n第二行\r\n",
        name: "windows.txt",
      });

      vi.setSystemTime(new Date(now.getTime() + 1_000));
      await expect(
        readDroppedTextFile({ context: staged.context, droppedFileId }),
      ).rejects.toThrow(/not found|利用できません/i);
    } finally {
      vi.useRealTimers();
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("sweeps expired request directories after a restart", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-dropped-data-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-dropped-workspace-"));
    const now = new Date();

    try {
      const staged = await stageDroppedTextFiles({
        conversationId: "conversation-1",
        dataRoot,
        files: [{ contentBase64: "eA==", name: "expired.txt" }],
        now,
        ttlMs: 1_000,
        workspaceRoot,
      });
      const droppedFileId = staged.files[0]!.id;

      await cleanupExpiredDroppedTextFiles({
        dataRoot,
        maxRequests: 100,
        now: new Date(now.getTime() + 2_000),
      });

      await expect(
        readDroppedTextFile({ context: staged.context, droppedFileId }),
      ).rejects.toThrow(/not found|利用できません/i);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("removes every staged request for a deleted conversation only", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-dropped-data-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-dropped-workspace-"));

    try {
      const first = await stageDroppedTextFiles({
        conversationId: "conversation-1",
        dataRoot,
        files: [{ contentBase64: "YQ==", name: "a.txt" }],
        workspaceRoot,
      });
      const second = await stageDroppedTextFiles({
        conversationId: "conversation-2",
        dataRoot,
        files: [{ contentBase64: "Yg==", name: "b.txt" }],
        workspaceRoot,
      });

      await cleanupDroppedTextFilesForConversation({
        conversationId: "conversation-1",
        dataRoot,
        workspaceRoot,
      });

      await expect(
        readDroppedTextFile({
          context: first.context,
          droppedFileId: first.files[0]!.id,
        }),
      ).rejects.toThrow(/not found|利用できません/i);
      await expect(
        readDroppedTextFile({
          context: second.context,
          droppedFileId: second.files[0]!.id,
        }),
      ).resolves.toMatchObject({ content: "b" });
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });
});
