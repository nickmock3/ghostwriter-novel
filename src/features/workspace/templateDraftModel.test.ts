import { describe, expect, it } from "vitest";
import {
  buildTemplatePreview,
  cloneTemplate,
  createBlankTemplate,
  mapApiTemplateToDraft,
  validateTemplate,
} from "./templateDraftModel";

describe("template draft model", () => {
  const itemIds = ["item-1", "item-2", "item-3", "item-4"];
  const createItemId = () => itemIds.shift() ?? "item-overflow";

  it("maps API templates to editable drafts and clones items with fresh UI IDs", () => {
    const draft = mapApiTemplateToDraft(
      {
        id: "notes-template",
        items: [
          { kind: "directory", path: "notes" },
          { content: "daily notes", kind: "file", path: "notes/today.md" },
        ],
        name: "Notes template",
        source: "user",
      },
      createItemId,
    );

    expect(draft.items).toEqual([
      { content: "", id: "item-1", kind: "directory", path: "notes" },
      { content: "daily notes", id: "item-2", kind: "file", path: "notes/today.md" },
    ]);
    expect(cloneTemplate(draft, createItemId).items.map((item) => item.id)).toEqual([
      "item-3",
      "item-4",
    ]);
  });

  it("creates a user draft and separates client guidance from the display preview", () => {
    const draft = createBlankTemplate("  新規テンプレート  ", () => "template-draft-1");
    draft.items = [
      { content: "", id: "directory", kind: "directory", path: " notes//daily/ " },
      { content: "body", id: "file", kind: "file", path: " notes//daily/today.md " },
      { content: "", id: "invalid", kind: "directory", path: "notes/deep/too-far" },
    ];

    expect(draft).toMatchObject({
      id: "template-draft-1",
      name: "  新規テンプレート  ",
      source: "user",
    });
    expect(validateTemplate(draft).issues).toEqual(["ディレクトリは二層まで作成できます。"]);
    expect(buildTemplatePreview(draft)).toEqual({
      issues: [],
      plannedDirectories: ["notes/daily", "notes/deep/too-far"],
      plannedFiles: ["notes/daily/today.md"],
    });
  });
});
