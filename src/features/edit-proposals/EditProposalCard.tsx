import { useEffect, useState } from "react";
import { diffWords, type Change } from "diff";
import type { EditProposal } from "./editProposalSchemas";
import {
  buildEditProposalLineRows,
  collapseDistantUnchangedContext,
  countLineDiffSummary,
  type EditProposalLineRow,
} from "./editProposalDiff";

type EditProposalDiffView = "inline" | "line";

function operationBadgeLabel(operation: EditProposal["operation"]) {
  if (operation === "create") {
    return "Create";
  }
  if (operation === "createDirectory") {
    return "CreateDirectory";
  }
  return "Edit";
}

function renderInlineDiffParts(parts: Change[], keyPrefix: string) {
  return parts.map((part, index) => {
    if (part.added) {
      return (
        <span className="diff-token-insert" key={`${keyPrefix}-add-${index}`}>
          {part.value}
        </span>
      );
    }
    if (part.removed) {
      return (
        <span className="diff-token-delete" key={`${keyPrefix}-del-${index}`}>
          {part.value}
        </span>
      );
    }
    return <span key={`${keyPrefix}-ctx-${index}`}>{part.value}</span>;
  });
}

function renderInlineDiffFromRows(rows: EditProposalLineRow[], keyPrefix: string) {
  return rows.map((row, index) => {
    const suffix = index < rows.length - 1 ? "\n" : "";
    const text = `${row.text}${suffix}`;
    if (row.kind === "insert") {
      return (
        <span className="diff-token-insert" key={`${keyPrefix}-ins-${index}`}>
          {text}
        </span>
      );
    }
    if (row.kind === "delete") {
      return (
        <span className="diff-token-delete" key={`${keyPrefix}-del-${index}`}>
          {text}
        </span>
      );
    }
    return <span key={`${keyPrefix}-ctx-${index}`}>{text}</span>;
  });
}

export type EditProposalCardProps = {
  canApply: boolean;
  canReject?: boolean;
  canUndo: boolean;
  inlineDiffStrategy?: "lines" | "words";
  isTargetDirty: boolean;
  mode?: "chat" | "editor";
  onApply: () => void;
  onOpenPath?: (path: string) => void;
  onReject: () => void;
  onUndo: () => void;
  proposal: EditProposal;
};

export function EditProposalCard({
  canApply,
  canReject = true,
  canUndo,
  inlineDiffStrategy = "words",
  isTargetDirty,
  mode,
  onApply,
  onOpenPath,
  onReject,
  onUndo,
  proposal,
}: EditProposalCardProps) {
  const isPending = proposal.status === "pending";
  const isCreateDirectory = proposal.operation === "createDirectory";
  const isCreate = proposal.operation === "create";
  const [diffView, setDiffView] = useState<EditProposalDiffView>("inline");
  const [showFullDiff, setShowFullDiff] = useState(false);
  const [showDiffBody, setShowDiffBody] = useState(isPending);

  useEffect(() => {
    setShowDiffBody(isPending);
    setShowFullDiff(false);
    setDiffView("inline");
  }, [proposal.id, proposal.status, isPending]);

  const summary = countLineDiffSummary(proposal.oldText, proposal.newText);
  const lineRows = buildEditProposalLineRows(proposal.oldText, proposal.newText);
  const { rows: previewRows, truncated } = collapseDistantUnchangedContext(lineRows, showFullDiff);
  const showDiffToggle = !isCreateDirectory && !isPending;
  const showDiffContent = !isCreateDirectory && (isPending || showDiffBody);
  const showDiffControls = showDiffContent && !isCreateDirectory && (isCreate || proposal.operation === "edit");

  return (
    <section
      aria-label={`編集案 ${proposal.path}`}
      className={`edit-proposal is-${proposal.status}`}
      role="group"
    >
      <div className="edit-proposal-heading">
        <h3>{proposal.title}</h3>
        <span className={`edit-proposal-status is-${proposal.status}`}>{proposal.status}</span>
      </div>
      <div className="edit-proposal-header-meta">
        {proposal.operation === "edit" && onOpenPath ? (
          <button
            className="edit-proposal-open-path"
            onClick={() => onOpenPath(proposal.path)}
            type="button"
          >
            {proposal.path} を開く
          </button>
        ) : (
          <span className="edit-proposal-path">{proposal.path}</span>
        )}
        <span className={`edit-proposal-operation is-${proposal.operation}`}>
          {operationBadgeLabel(proposal.operation)}
        </span>
        {!isCreateDirectory ? (
          <span className="edit-proposal-line-summary">
            {summary.added > 0 ? <span className="edit-proposal-line-summary-add">+{summary.added}</span> : null}
            {summary.removed > 0 ? (
              <span className="edit-proposal-line-summary-remove">−{summary.removed}</span>
            ) : null}
          </span>
        ) : null}
      </div>
      {isCreateDirectory ? <p className="edit-proposal-directory-note">作成予定: {proposal.path}</p> : null}
      {showDiffToggle ? (
        <button
          className="edit-proposal-show-diff"
          onClick={() => setShowDiffBody((current) => !current)}
          type="button"
        >
          {showDiffBody ? "閉じる" : "変更点"}
        </button>
      ) : null}
      {showDiffContent ? (
        <>
          {showDiffControls ? (
            <div className="edit-proposal-diff-view-toggle" role="group" aria-label="Diff view">
              <button
                aria-pressed={diffView === "inline"}
                className={diffView === "inline" ? "is-active" : undefined}
                onClick={() => setDiffView("inline")}
                type="button"
              >
                Inline
              </button>
              <button
                aria-pressed={diffView === "line"}
                className={diffView === "line" ? "is-active" : undefined}
                onClick={() => setDiffView("line")}
                type="button"
              >
                Line
              </button>
            </div>
          ) : null}
          {diffView === "inline" ? (
            <div className="edit-proposal-inline-diff">
              {isCreate
                ? renderInlineDiffParts(
                    [{ added: true, count: proposal.newText.length, removed: false, value: proposal.newText }],
                    proposal.id,
                  )
                : inlineDiffStrategy === "lines"
                  ? renderInlineDiffFromRows(lineRows, proposal.id)
                  : showFullDiff || !truncated
                    ? renderInlineDiffParts(diffWords(proposal.oldText, proposal.newText), proposal.id)
                    : renderInlineDiffFromRows(previewRows, proposal.id)}
            </div>
          ) : (
            <div className="edit-proposal-line-diff">
              {previewRows.map((row, index) => (
                <div
                  className={`line-diff-row${
                    row.kind === "delete" ? " is-delete" : row.kind === "insert" ? " is-insert" : ""
                  }`}
                  key={`${proposal.id}-line-${index}`}
                >
                  <span className="line-diff-gutter">
                    {row.kind === "delete" ? "−" : row.kind === "insert" ? "+" : ""}
                  </span>
                  <span className="line-diff-text">{row.text}</span>
                </div>
              ))}
            </div>
          )}
          {truncated ? (
            <p className="edit-proposal-diff-omission">…省略…</p>
          ) : null}
          {truncated ? (
            <button
              className="edit-proposal-show-full-diff"
              onClick={() => setShowFullDiff(true)}
              type="button"
            >
              すべて表示
            </button>
          ) : null}
        </>
      ) : null}
      {isPending ? (
        <>
          {isTargetDirty ? (
            <p className="pane-warning">保存または破棄してからApplyしてください。</p>
          ) : null}
          <div className="edit-proposal-actions">
            <button
              className="secondary-action"
              disabled={!canApply}
              onClick={onApply}
              type="button"
            >
              Apply
            </button>
            <button
              className="secondary-action"
              disabled={!canReject}
              onClick={onReject}
              type="button"
            >
              Reject
            </button>
          </div>
        </>
      ) : canUndo ? (
        <div className="edit-proposal-actions">
          <button className="secondary-action" onClick={onUndo} type="button">
            Undo
          </button>
        </div>
      ) : null}
    </section>
  );
}
