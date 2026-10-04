import { describe, expect, it } from "vitest";
import {
  buildEditProposalLineRows,
  collapseDistantUnchangedContext,
  countLineDiffSummary,
} from "./editProposalDiff";

describe("edit proposal diff helpers", () => {
  it("derives line rows and an added/removed summary from proposal text", () => {
    expect(countLineDiffSummary("keep\nold\n", "keep\nnew\n")).toEqual({ added: 1, removed: 1 });
    expect(buildEditProposalLineRows("keep\nold\n", "keep\nnew\n")).toEqual([
      { kind: "context", text: "keep" },
      { kind: "delete", text: "old" },
      { kind: "insert", text: "new" },
    ]);
  });

  it("omits distant unchanged context only in the collapsed preview", () => {
    const oldText = `${Array.from({ length: 8 }, (_, index) => `unchanged ${index}`).join("\n")}\n`;
    const rows = buildEditProposalLineRows(oldText, `${oldText}added\n`);

    const collapsed = collapseDistantUnchangedContext(rows, false);
    expect(collapsed.truncated).toBe(true);
    expect(collapsed.rows).not.toContainEqual({ kind: "context", text: "unchanged 0" });
    expect(collapsed.rows).toContainEqual({ kind: "context", text: "unchanged 7" });
    expect(collapsed.rows).toContainEqual({ kind: "insert", text: "added" });

    expect(collapseDistantUnchangedContext(rows, true)).toEqual({ rows, truncated: false });
  });
});
