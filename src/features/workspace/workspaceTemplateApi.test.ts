import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspaceTemplateApiHandler } from "./workspaceTemplateApi";
import {
  builtInWorkspaceTemplateId,
  chatModeNovelWorkspaceTemplateId,
} from "./workspaceTemplateStore";

function tempDataRoot() {
  return mkdtempSync(path.join(tmpdir(), "ghostwriter-template-api-"));
}

describe("workspace template API", () => {
  it("saves, lists, and deletes user templates", async () => {
    const dataRoot = tempDataRoot();
    const handler = createWorkspaceTemplateApiHandler({ dataRoot });

    try {
      const putResponse = await handler(
        new Request("http://localhost/api/workspace/templates/project-notes", {
          body: JSON.stringify({
            items: [
              { kind: "directory", path: "notes" },
              { content: "# Project\n", kind: "file", path: "notes/project.md" },
            ],
            name: "Project notes",
          }),
          method: "PUT",
        }),
      );

      expect(putResponse.status).toBe(200);
      expect(await putResponse.json()).toEqual({
        template: {
          id: "project-notes",
          items: [
            { kind: "directory", path: "notes" },
            { content: "# Project\n", kind: "file", path: "notes/project.md" },
          ],
          name: "Project notes",
          source: "user",
        },
      });

      const listResponse = await handler(
        new Request("http://localhost/api/workspace/templates"),
      );
      expect(listResponse.status).toBe(200);
      expect(await listResponse.json()).toEqual({
        templates: [
          expect.objectContaining({ id: builtInWorkspaceTemplateId, source: "built-in" }),
          expect.objectContaining({ id: chatModeNovelWorkspaceTemplateId, source: "built-in" }),
          expect.objectContaining({ id: "project-notes", source: "user" }),
        ],
      });

      const deleteResponse = await handler(
        new Request("http://localhost/api/workspace/templates/project-notes", {
          method: "DELETE",
        }),
      );

      expect(deleteResponse.status).toBe(200);
      expect(await deleteResponse.json()).toEqual({ ok: true });
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
    }
  });

  it("rejects invalid templates and built-in template mutations", async () => {
    const dataRoot = tempDataRoot();
    const handler = createWorkspaceTemplateApiHandler({ dataRoot });

    try {
      const invalidResponse = await handler(
        new Request("http://localhost/api/workspace/templates/invalid", {
          body: JSON.stringify({
            items: [{ content: "secret\u0000value", kind: "file", path: "README.md" }],
            name: "Invalid",
          }),
          method: "PUT",
        }),
      );
      const editBuiltInResponse = await handler(
        new Request(`http://localhost/api/workspace/templates/${builtInWorkspaceTemplateId}`, {
          body: JSON.stringify({ items: [], name: "Built-in" }),
          method: "PUT",
        }),
      );
      const deleteBuiltInResponse = await handler(
        new Request(`http://localhost/api/workspace/templates/${builtInWorkspaceTemplateId}`, {
          method: "DELETE",
        }),
      );

      expect(invalidResponse.status).toBe(400);
      expect(await invalidResponse.json()).toEqual({
        message: "Template file content must be text",
      });
      expect(editBuiltInResponse.status).toBe(409);
      expect(deleteBuiltInResponse.status).toBe(409);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
    }
  });

  it("does not expose the configured data root when storage is unavailable", async () => {
    const parent = tempDataRoot();
    const dataRoot = path.join(parent, "not-a-directory");
    writeFileSync(dataRoot, "occupied", "utf8");
    const handler = createWorkspaceTemplateApiHandler({ dataRoot });

    try {
      const response = await handler(
        new Request("http://localhost/api/workspace/templates/project-notes", {
          body: JSON.stringify({
            items: [{ content: "# Project\n", kind: "file", path: "project.md" }],
            name: "Project notes",
          }),
          method: "PUT",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({ message: "Application data storage is unavailable" });
      expect(JSON.stringify(body)).not.toContain(dataRoot);
    } finally {
      rmSync(parent, { force: true, recursive: true });
    }
  });
});
