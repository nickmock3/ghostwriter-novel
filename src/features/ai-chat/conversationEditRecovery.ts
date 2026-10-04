import { localWorkspaceFileStore } from "../workspace/workspaceFileStore";
import { resolveWorkspaceFilePath } from "../workspace/workspaceFilePaths";
import type { Conversation, EditProposal } from "./conversationSchemas";

async function matchesCompletedEdit(proposal: EditProposal, workspaceRoot: string): Promise<boolean> {
  if (!proposal.undoSnapshot) throw new Error("Invalid conversation edit recovery snapshot");
  // A directory's existence cannot establish who created it. Fail closed instead.
  if (proposal.operation === "createDirectory") return false;
  try {
    await resolveWorkspaceFilePath(workspaceRoot, proposal.path, {
      rejectHiddenSegments: true, requireExisting: false,
    });
    const context = await localWorkspaceFileStore.createContext(workspaceRoot);
    if (proposal.operation === "create" && proposal.status === "undone") {
      return !(await localWorkspaceFileStore.exists(context, proposal.path));
    }
    const { content } = await localWorkspaceFileStore.readTextFile(context, proposal.path);
    const expected = proposal.status === "applied"
      ? proposal.undoSnapshot.afterContent : proposal.undoSnapshot.beforeContent;
    return content === expected;
  } catch {
    return false;
  }
}

// Recovery only reads the manuscript. Even an uncertain/partially completed write
// leaves its snapshot available for inspection, but cannot be applied again.
export async function recoverConversationEdit(conversation: Conversation, workspaceRoot: string): Promise<Conversation> {
  const intended = conversation.editRecovery;
  if (!intended) return conversation;
  const original = conversation.editProposals.find((proposal) => proposal.id === intended.id);
  if (!original || original.path !== intended.path || original.operation !== intended.operation ||
      original.oldText !== intended.oldText || original.newText !== intended.newText ||
      !["applied", "undone"].includes(intended.status) || !intended.undoSnapshot) {
    throw new Error("Invalid conversation edit recovery record");
  }
  const recovered: EditProposal = await matchesCompletedEdit(intended, workspaceRoot)
    ? intended : { ...intended, status: "conflicted" };
  const { editRecovery: _, ...rest } = conversation;
  return {
    ...rest,
    editProposals: conversation.editProposals.map((proposal) => proposal.id === intended.id ? recovered : proposal),
    updatedAt: new Date().toISOString(),
  };
}
