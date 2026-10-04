import { z } from "zod";

export const editProposalUndoSnapshotSchema = z.object({
  afterContent: z.string(),
  beforeContent: z.string(),
});

export const editProposalSchema = z.object({
  persistedProposalId: z.string().min(1).optional(),
  assistantMessageId: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  diff: z.string(),
  id: z.string().min(1),
  newText: z.string(),
  oldText: z.string(),
  operation: z.enum(["edit", "create", "createDirectory"]).default("edit"),
  path: z.string().min(1),
  sourceRole: z.literal("writing").optional(),
  status: z
    .enum(["pending", "applied", "rejected", "conflicted", "undone"])
    .default("pending"),
  title: z.string().min(1),
  undoSnapshot: editProposalUndoSnapshotSchema.optional(),
  updatedAt: z.string().datetime(),
});

export type EditProposal = z.infer<typeof editProposalSchema>;
export type EditProposalUndoSnapshot = z.infer<typeof editProposalUndoSnapshotSchema>;
