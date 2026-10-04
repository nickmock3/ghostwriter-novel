import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  builtInWorkspaceTemplate,
  builtInWorkspaceTemplateId,
  chatModeNovelWorkspaceTemplate,
  chatModeNovelWorkspaceTemplateId,
  deleteUserWorkspaceTemplate,
  listWorkspaceTemplates,
  saveUserWorkspaceTemplate,
  validateWorkspaceTemplateDefinition,
} from "./workspaceTemplateStore";

function tempDataRoot() {
  return mkdtempSync(path.join(tmpdir(), "ghostwriter-templates-"));
}

describe("workspace template store", () => {
  it("defines the built-in template for a Japanese novel workspace", () => {
    expect(builtInWorkspaceTemplate.name).toBe("小説ワークスペース");
    expect(builtInWorkspaceTemplate.items).toEqual([
      expect.objectContaining({ kind: "file", path: "AGENTS.md" }),
      { kind: "directory", path: "小説" },
      { kind: "directory", path: "小説/第001章" },
      { content: expect.any(String), kind: "file", path: "小説/第001章/本文.txt" },
      { content: expect.any(String), kind: "file", path: "小説/第001章/章内プロット.md" },
      { kind: "directory", path: "設定" },
      { content: expect.any(String), kind: "file", path: "設定/登場人物.md" },
      { content: expect.any(String), kind: "file", path: "設定/世界観.md" },
      { content: expect.any(String), kind: "file", path: "設定/用語集.md" },
      { kind: "directory", path: "プロット" },
      { content: expect.any(String), kind: "file", path: "プロット/全体構成.md" },
      { kind: "directory", path: "資料" },
      { kind: "directory", path: "メモ" },
    ]);
    expect(builtInWorkspaceTemplate.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "tasks" }),
        expect.objectContaining({ path: "tasks/open" }),
        expect.objectContaining({ path: "tasks/done" }),
      ]),
    );

    const agents = builtInWorkspaceTemplate.items.find(
      (item) => item.kind === "file" && item.path === "AGENTS.md",
    );
    expect(agents).toEqual(
      expect.objectContaining({
        content: expect.stringContaining("小説執筆用ワークスペース"),
      }),
    );
    expect(agents).toEqual(
      expect.objectContaining({
        content: expect.stringContaining("小説/第001章/本文.txt"),
      }),
    );
  });

  it("defines the chat mode built-in template with the standard chapter layout", () => {
    expect(chatModeNovelWorkspaceTemplate.id).toBe(chatModeNovelWorkspaceTemplateId);
    expect(chatModeNovelWorkspaceTemplate.name).toBe("チャットモード小説ワークスペース");
    expect(chatModeNovelWorkspaceTemplate.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining("AIと会話しながら小説を書き進める"),
          kind: "file",
          path: "AGENTS.md",
        }),
        { kind: "directory", path: "小説" },
        { kind: "directory", path: "小説/第001章" },
        { content: expect.any(String), kind: "file", path: "小説/第001章/本文.txt" },
        { content: expect.any(String), kind: "file", path: "小説/第001章/章内プロット.md" },
        { kind: "directory", path: "設定" },
        { kind: "directory", path: "プロット" },
        { kind: "directory", path: "資料" },
        { kind: "directory", path: "メモ" },
      ]),
    );
  });

  it("lists built-in and saved user templates", async () => {
    const dataRoot = tempDataRoot();

    try {
      const saved = await saveUserWorkspaceTemplate({
        dataRoot,
        template: {
          id: "daily-notes",
          items: [
            { kind: "directory", path: "notes" },
            { content: "# Today\n", kind: "file", path: "notes/today.md" },
          ],
          name: "Daily notes",
        },
      });
      const templates = await listWorkspaceTemplates({ dataRoot });

      expect(saved.source).toBe("user");
      expect(templates).toEqual([
        expect.objectContaining({
          id: builtInWorkspaceTemplateId,
          source: "built-in",
        }),
        expect.objectContaining({
          id: chatModeNovelWorkspaceTemplateId,
          source: "built-in",
        }),
        saved,
      ]);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
    }
  });

  it("saves and deletes user templates", async () => {
    const dataRoot = tempDataRoot();

    try {
      await saveUserWorkspaceTemplate({
        dataRoot,
        template: {
          id: "scratch",
          items: [{ content: "hello", kind: "file", path: "README.md" }],
          name: "Scratch",
        },
      });

      expect(await listWorkspaceTemplates({ dataRoot })).toHaveLength(3);

      await deleteUserWorkspaceTemplate({ dataRoot, templateId: "scratch" });

      expect(await listWorkspaceTemplates({ dataRoot })).toHaveLength(2);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
    }
  });

  it.each([
    [
      "empty template name",
      {
        id: "bad-name",
        items: [],
        name: "   ",
      },
      "Template name is required",
    ],
    [
      "directory path deeper than two levels",
      {
        id: "bad-directory",
        items: [{ kind: "directory", path: "小説/第001章/下書き" }],
        name: "Bad directory",
      },
      "Directory template paths must be at most two segments",
    ],
    [
      "file path deeper than chapter file level",
      {
        id: "bad-file",
        items: [{ content: "", kind: "file", path: "小説/第001章/下書き/本文.txt" }],
        name: "Bad file",
      },
      "File template paths must be at most three segments",
    ],
    [
      "hidden path segment",
      {
        id: "hidden-path",
        items: [{ content: "", kind: "file", path: ".env" }],
        name: "Hidden path",
      },
      "Hidden path segments are not allowed",
    ],
    [
      "null byte content",
      {
        id: "null-byte",
        items: [{ content: "bad\u0000content", kind: "file", path: "README.md" }],
        name: "Null byte",
      },
      "Template file content must be text",
    ],
  ])("rejects %s", (_caseName, template, message) => {
    expect(() => validateWorkspaceTemplateDefinition(template)).toThrow(message);
  });

  it("allows two-level directories and three-level files", () => {
    expect(
      validateWorkspaceTemplateDefinition({
        id: "novel-chapter",
        items: [
          { kind: "directory", path: "小説/第001章" },
          { content: "本文", kind: "file", path: "小説/第001章/本文.txt" },
        ],
        name: "Novel chapter",
      }),
    ).toEqual({
      id: "novel-chapter",
      items: [
        { kind: "directory", path: "小説/第001章" },
        { content: "本文", kind: "file", path: "小説/第001章/本文.txt" },
      ],
      name: "Novel chapter",
    });
  });

  it("normalizes Windows-style template paths before validation and saving", () => {
    expect(
      validateWorkspaceTemplateDefinition({
        id: "windows-input",
        items: [
          { kind: "directory", path: "小説\\第001章" },
          { content: "本文", kind: "file", path: "小説\\第001章\\本文.txt" },
        ],
        name: "Windows input",
      }),
    ).toEqual({
      id: "windows-input",
      items: [
        { kind: "directory", path: "小説/第001章" },
        { content: "本文", kind: "file", path: "小説/第001章/本文.txt" },
      ],
      name: "Windows input",
    });

    expect(() =>
      validateWorkspaceTemplateDefinition({
        id: "hidden-windows-input",
        items: [{ content: "", kind: "file", path: "小説\\.secret\\key.txt" }],
        name: "Hidden",
      }),
    ).toThrow("Hidden path segments are not allowed");
  });

  it("rejects editing or deleting the built-in template", async () => {
    const dataRoot = tempDataRoot();

    try {
      await expect(
        saveUserWorkspaceTemplate({
          dataRoot,
          template: {
            id: builtInWorkspaceTemplateId,
            items: [],
            name: "Edited built-in",
          },
        }),
      ).rejects.toThrow("Built-in templates cannot be edited");
      await expect(
        saveUserWorkspaceTemplate({
          dataRoot,
          template: {
            id: chatModeNovelWorkspaceTemplateId,
            items: [],
            name: "Edited chat built-in",
          },
        }),
      ).rejects.toThrow("Built-in templates cannot be edited");

      await expect(
        deleteUserWorkspaceTemplate({
          dataRoot,
          templateId: builtInWorkspaceTemplateId,
        }),
      ).rejects.toThrow("Built-in templates cannot be deleted");
      await expect(
        deleteUserWorkspaceTemplate({
          dataRoot,
          templateId: chatModeNovelWorkspaceTemplateId,
        }),
      ).rejects.toThrow("Built-in templates cannot be deleted");
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
    }
  });
});
