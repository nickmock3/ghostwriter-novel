import { diffLines } from "diff";

export const EDIT_PROPOSAL_PREVIEW_CONTEXT_LINES = 3;

export type EditProposalLineRow = {
  kind: "context" | "delete" | "insert";
  text: string;
};

export function countLineDiffSummary(oldText: string, newText: string) {
  const parts = diffLines(oldText, newText);
  let added = 0;
  let removed = 0;
  for (const part of parts) {
    if (part.added) {
      added += part.count ?? 0;
    }
    if (part.removed) {
      removed += part.count ?? 0;
    }
  }
  return { added, removed };
}

export function buildEditProposalLineRows(oldText: string, newText: string): EditProposalLineRow[] {
  const rows: EditProposalLineRow[] = [];
  for (const part of diffLines(oldText, newText)) {
    const lines = part.value.split("\n");
    const endsWithNewline = part.value.endsWith("\n");
    const lineTexts = endsWithNewline ? lines.slice(0, -1) : lines;
    for (const line of lineTexts) {
      if (part.added) {
        rows.push({ kind: "insert", text: line });
      } else if (part.removed) {
        rows.push({ kind: "delete", text: line });
      } else {
        rows.push({ kind: "context", text: line });
      }
    }
  }
  return rows;
}

export function collapseDistantUnchangedContext(
  rows: EditProposalLineRow[],
  showFullDiff: boolean,
): { rows: EditProposalLineRow[]; truncated: boolean } {
  if (showFullDiff) {
    return { rows, truncated: false };
  }

  const result: EditProposalLineRow[] = [];
  let truncated = false;
  let index = 0;

  while (index < rows.length) {
    const row = rows[index];
    if (row.kind !== "context") {
      result.push(row);
      index += 1;
      continue;
    }

    let end = index;
    while (end < rows.length && rows[end].kind === "context") {
      end += 1;
    }
    const block = rows.slice(index, end);
    const previousKind = index > 0 ? rows[index - 1].kind : null;
    const nextKind = end < rows.length ? rows[end].kind : null;
    const hasChangeNeighbor =
      previousKind === "delete" ||
      previousKind === "insert" ||
      nextKind === "delete" ||
      nextKind === "insert";

    if (!hasChangeNeighbor || block.length <= EDIT_PROPOSAL_PREVIEW_CONTEXT_LINES) {
      result.push(...block);
    } else if (previousKind === "delete" || previousKind === "insert") {
      truncated = true;
      result.push(...block.slice(0, EDIT_PROPOSAL_PREVIEW_CONTEXT_LINES));
    } else {
      truncated = true;
      result.push(...block.slice(block.length - EDIT_PROPOSAL_PREVIEW_CONTEXT_LINES));
    }

    index = end;
  }

  return { rows: result, truncated };
}
