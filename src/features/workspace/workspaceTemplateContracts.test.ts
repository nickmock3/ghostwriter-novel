import { describe, expect, it } from "vitest";
import {
  builtInWorkspaceTemplateId,
  chatModeNovelWorkspaceTemplateId,
  workspaceTemplateListResponseSchema,
  workspaceTemplateSaveResponseSchema,
} from "./workspaceTemplateContracts";

describe("workspace template contracts", () => {
  it("defines the built-in template IDs in the browser-safe contract", () => {
    expect(builtInWorkspaceTemplateId).toBe("built-in/basic-workspace");
    expect(chatModeNovelWorkspaceTemplateId).toBe("built-in/chat-mode-novel");
  });

  it("validates template list and save API responses", () => {
    const template = {
      id: builtInWorkspaceTemplateId,
      items: [
        { kind: "directory" as const, path: "小説" },
        { content: "本文", kind: "file" as const, path: "小説/本文.txt" },
      ],
      name: "小説ワークスペース",
      source: "built-in" as const,
    };

    expect(workspaceTemplateListResponseSchema.parse({ templates: [template] })).toEqual({
      templates: [template],
    });
    expect(workspaceTemplateSaveResponseSchema.parse({ template })).toEqual({ template });
  });
});
