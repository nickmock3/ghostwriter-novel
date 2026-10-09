import { appendConversationEditProposal, applyConversationEditProposal, type ConversationHistoryOptions } from "./conversationHistory";
import type { RunAgentLoopToolServiceOverrides } from "../ai-agent/tools/agentTools";
import type { EditProposal } from "./conversationSchemas";
import {
  applyEditProposal,
  createDirectoryProposalForWorkspace,
  createEditProposalForWorkspace,
  createFileProposalForWorkspace,
} from "../edit-proposals/editProposalService";

export type ProposalPersistenceContext = ConversationHistoryOptions & { conversationId: string };

type WorkspaceProposalInput = { workspaceRoot: string };

type CreateProposalForWorkspace<TInput extends WorkspaceProposalInput> = (
  input: TInput,
) => Promise<EditProposal>;

export type ProposalToolServices = {
  createDirectoryProposal: typeof createDirectoryProposalForWorkspace;
  createEditProposal: typeof createEditProposalForWorkspace;
  createFileProposal: typeof createFileProposalForWorkspace;
};

const defaultProposalToolServices: ProposalToolServices = {
  createDirectoryProposal: createDirectoryProposalForWorkspace,
  createEditProposal: createEditProposalForWorkspace,
  createFileProposal: createFileProposalForWorkspace,
};

export function createAutoApplyProposalService<TInput extends WorkspaceProposalInput>(
  createProposal: CreateProposalForWorkspace<TInput>,
  autoApplyEnabled: boolean,
  persistence?: ProposalPersistenceContext,
): CreateProposalForWorkspace<TInput> {
  if (!autoApplyEnabled) {
    return createProposal;
  }

  return async (input) => {
    const proposal = await createProposal(input);
    if (persistence) {
      await appendConversationEditProposal({
        ...persistence, ...proposal, proposalId: proposal.id,
      });
      const conversation = await applyConversationEditProposal({
        ...persistence, dirtyPaths: [], proposalId: proposal.id,
      });
      const applied = conversation.editProposals.find((item) => item.id === proposal.id)!;
      return { ...applied, persistedProposalId: applied.id };
    }
    return applyEditProposal({
      dirtyPaths: [],
      proposal,
      workspaceRoot: input.workspaceRoot,
    });
  };
}

export function createAutoApplyProposalToolServices(
  baseServices: ProposalToolServices,
  autoApplyEnabled: boolean,
  persistence?: ProposalPersistenceContext,
): ProposalToolServices {
  return {
    createDirectoryProposal: createAutoApplyProposalService(
      baseServices.createDirectoryProposal,
      autoApplyEnabled,
      persistence,
    ),
    createEditProposal: createAutoApplyProposalService(
      baseServices.createEditProposal,
      autoApplyEnabled,
      persistence,
    ),
    createFileProposal: createAutoApplyProposalService(
      baseServices.createFileProposal,
      autoApplyEnabled,
      persistence,
    ),
  };
}

export function createChatModeProposalToolServices(persistence?: ProposalPersistenceContext): RunAgentLoopToolServiceOverrides {
  return createAutoApplyProposalToolServices(defaultProposalToolServices, true, persistence);
}
