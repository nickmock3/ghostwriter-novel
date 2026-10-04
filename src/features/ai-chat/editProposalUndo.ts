import type { EditProposal } from "./conversationSchemas";

export function latestUndoableProposalId(
  proposals: EditProposal[],
): string | undefined {
  let latest: EditProposal | undefined;
  for (const proposal of proposals) {
    if (proposal.status !== "applied" || !proposal.undoSnapshot) {
      continue;
    }
    if (!latest || Date.parse(proposal.updatedAt) > Date.parse(latest.updatedAt)) {
      latest = proposal;
    }
  }
  return latest?.id;
}
