import { closeSync, existsSync, mkdtempSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspaceApiHandler } from "./workspaceApi";
import {
  chatModeNovelWorkspaceTemplateId,
  saveUserWorkspaceTemplate,
} from "./workspaceTemplateStore";

describe("workspace API", () => {
  it("returns the selected absolute workspace root", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-"));
    const handler = createWorkspaceApiHandler({
      selectDirectory: async () => root,
    });

    try {
      const response = await handler(new Request("http://localhost/api/workspace/select", { method: "POST" }));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ workspaceRoot: await realpath(root) });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("returns an error when native selection fails", async () => {
    const handler = createWorkspaceApiHandler({
      selectDirectory: async () => {
        throw new Error("Native picker unavailable");
      },
    });

    const response = await handler(new Request("http://localhost/api/workspace/select", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      code: "workspace_selection_failed",
      message: "Native picker unavailable",
    });
  });

  it("validates a stored absolute workspace root with the same resolver", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-"));
    const handler = createWorkspaceApiHandler({
      selectDirectory: async () => {
        throw new Error("should not open picker");
      },
    });

    try {
      const response = await handler(
        new Request("http://localhost/api/workspace/validate", {
          body: JSON.stringify({ workspaceRoot: root }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ workspaceRoot: await realpath(root) });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("rejects invalid stored workspace roots", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-"));
    const filePath = path.join(root, "not-a-directory.txt");
    closeSync(openSync(filePath, "w"));
    const handler = createWorkspaceApiHandler({
      selectDirectory: async () => root,
    });

    try {
      const response = await handler(
        new Request("http://localhost/api/workspace/validate", {
          body: JSON.stringify({ workspaceRoot: filePath }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({
        code: "workspace_selection_failed",
        message: "Workspace path must be a directory",
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("applies the built-in new workspace template without overwriting existing files", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-template-"));
    const handler = createWorkspaceApiHandler({
      selectDirectory: async () => root,
    });

    try {
      const response = await handler(
        new Request("http://localhost/api/workspace/template", {
          body: JSON.stringify({ workspaceRoot: root }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        createdDirectories: ["小説", "小説/第001章", "設定", "プロット", "資料", "メモ"],
        createdFiles: [
          "AGENTS.md",
          "小説/第001章/本文.txt",
          "小説/第001章/章内プロット.md",
          "設定/登場人物.md",
          "設定/世界観.md",
          "設定/用語集.md",
          "プロット/全体構成.md",
        ],
        skippedExisting: [],
        workspaceRoot: await realpath(root),
      });
      expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toContain("小説執筆用ワークスペース");
      expect(readFileSync(path.join(root, "小説", "第001章", "本文.txt"), "utf8")).toContain("第001章");
      expect(readFileSync(path.join(root, "小説", "第001章", "章内プロット.md"), "utf8")).toContain("章の目的");
      expect(existsSync(path.join(root, "tasks"))).toBe(false);

      const conflictResponse = await handler(
        new Request("http://localhost/api/workspace/template", {
          body: JSON.stringify({ workspaceRoot: root }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      const conflictBody = await conflictResponse.json();

      expect(conflictResponse.status).toBe(409);
      expect(conflictBody).toEqual({
        code: "workspace_selection_failed",
        message: "Template target already exists: AGENTS.md",
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("applies the chat mode novel start template with the standard-compatible chapter layout", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-template-"));
    const handler = createWorkspaceApiHandler({
      selectDirectory: async () => root,
    });

    try {
      const response = await handler(
        new Request("http://localhost/api/workspace/template", {
          body: JSON.stringify({
            templateId: chatModeNovelWorkspaceTemplateId,
            workspaceRoot: root,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        createdDirectories: expect.arrayContaining([
          "小説",
          "小説/第001章",
          "設定",
          "プロット",
          "資料",
          "メモ",
        ]),
        createdFiles: expect.arrayContaining([
          "AGENTS.md",
          "小説/第001章/本文.txt",
          "小説/第001章/章内プロット.md",
          "設定/登場人物.md",
          "設定/世界観.md",
          "設定/用語集.md",
          "プロット/全体構成.md",
        ]),
        skippedExisting: [],
        workspaceRoot: await realpath(root),
      });
      expect(readFileSync(path.join(root, "小説", "第001章", "本文.txt"), "utf8")).toContain(
        "第001章",
      );
      expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toContain(
        "AIと会話しながら小説を書き進める",
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("rejects unsafe template targets when an existing ancestor escapes through a symlink", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-template-"));
    const outside = mkdtempSync(path.join(tmpdir(), "ghostwriter-template-outside-"));
    symlinkSync(outside, path.join(root, "小説"));
    const handler = createWorkspaceApiHandler({
      selectDirectory: async () => root,
    });

    try {
      const response = await handler(
        new Request("http://localhost/api/workspace/template", {
          body: JSON.stringify({ workspaceRoot: root }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({
        code: "workspace_selection_failed",
        message: "Path escapes the workspace",
      });
      expect(existsSync(path.join(outside, "第001章"))).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });

  it("rejects invalid template payloads and non-directory roots", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-template-"));
    const filePath = path.join(root, "not-a-directory.txt");
    writeFileSync(filePath, "not a directory");
    const handler = createWorkspaceApiHandler({
      selectDirectory: async () => root,
    });

    try {
      const invalidPayloadResponse = await handler(
        new Request("http://localhost/api/workspace/template", {
          body: JSON.stringify({ workspaceRoot: "../outside" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      const nonDirectoryResponse = await handler(
        new Request("http://localhost/api/workspace/template", {
          body: JSON.stringify({ workspaceRoot: filePath }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );

      expect(invalidPayloadResponse.status).toBe(400);
      expect(await invalidPayloadResponse.json()).toEqual({
        code: "workspace_selection_failed",
        message: "Workspace path must be absolute",
      });
      expect(nonDirectoryResponse.status).toBe(400);
      expect(await nonDirectoryResponse.json()).toEqual({
        code: "workspace_selection_failed",
        message: "Workspace path must be a directory",
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("applies a selected user workspace template after revalidating the saved definition", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-template-"));
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-template-data-"));
    await saveUserWorkspaceTemplate({
      dataRoot,
      template: {
        id: "project-notes",
        items: [
          { kind: "directory", path: "docs" },
          { content: "# Plan\n", kind: "file", path: "docs/plan.md" },
        ],
        name: "Project notes",
      },
    });
    const handler = createWorkspaceApiHandler({
      dataRoot,
      selectDirectory: async () => root,
    });

    try {
      const response = await handler(
        new Request("http://localhost/api/workspace/template", {
          body: JSON.stringify({ templateId: "project-notes", workspaceRoot: root }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        createdDirectories: ["docs"],
        createdFiles: ["docs/plan.md"],
        skippedExisting: [],
        workspaceRoot: await realpath(root),
      });
      expect(readFileSync(path.join(root, "docs", "plan.md"), "utf8")).toBe("# Plan\n");
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(dataRoot, { force: true, recursive: true });
    }
  });

  it("applies Windows-style user template paths as POSIX workspace paths", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-template-"));
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-template-data-"));
    await saveUserWorkspaceTemplate({
      dataRoot,
      template: {
        id: "windows-paths",
        items: [
          { kind: "directory", path: "小説\\第001章" },
          { content: "本文", kind: "file", path: "小説\\第001章\\本文.txt" },
        ],
        name: "Windows paths",
      },
    });
    const handler = createWorkspaceApiHandler({
      dataRoot,
      selectDirectory: async () => root,
    });

    try {
      const response = await handler(
        new Request("http://localhost/api/workspace/template", {
          body: JSON.stringify({ templateId: "windows-paths", workspaceRoot: root }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        createdDirectories: ["小説/第001章"],
        createdFiles: ["小説/第001章/本文.txt"],
        skippedExisting: [],
        workspaceRoot: await realpath(root),
      });
      expect(readFileSync(path.join(root, "小説", "第001章", "本文.txt"), "utf8")).toBe(
        "本文",
      );
      if (path.sep !== "\\") {
        expect(existsSync(path.join(root, "小説\\第001章\\本文.txt"))).toBe(false);
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(dataRoot, { force: true, recursive: true });
    }
  });

  it("rejects missing selected templates and user template conflicts", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ghostwriter-template-"));
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-template-data-"));
    writeFileSync(path.join(root, "README.md"), "existing", "utf8");
    await saveUserWorkspaceTemplate({
      dataRoot,
      template: {
        id: "readme-template",
        items: [{ content: "new", kind: "file", path: "README.md" }],
        name: "Readme",
      },
    });
    const handler = createWorkspaceApiHandler({
      dataRoot,
      selectDirectory: async () => root,
    });

    try {
      const missingResponse = await handler(
        new Request("http://localhost/api/workspace/template", {
          body: JSON.stringify({ templateId: "missing", workspaceRoot: root }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      const conflictResponse = await handler(
        new Request("http://localhost/api/workspace/template", {
          body: JSON.stringify({ templateId: "readme-template", workspaceRoot: root }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );

      expect(missingResponse.status).toBe(404);
      expect(await missingResponse.json()).toEqual({
        code: "workspace_selection_failed",
        message: "Workspace template not found",
      });
      expect(conflictResponse.status).toBe(409);
      expect(await conflictResponse.json()).toEqual({
        code: "workspace_selection_failed",
        message: "Template target already exists: README.md",
      });
      expect(readFileSync(path.join(root, "README.md"), "utf8")).toBe("existing");
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(dataRoot, { force: true, recursive: true });
    }
  });
});
