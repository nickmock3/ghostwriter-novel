import { z } from "zod";

export const workspaceSelectSuccessSchema = z.object({
  workspaceRoot: z.string().min(1),
});

export const workspaceValidateRequestSchema = z.object({
  workspaceRoot: z.string().min(1),
});

export const workspaceTemplateRequestSchema = z.object({
  templateId: z.string().min(1).optional(),
  workspaceRoot: z.string().min(1),
});

export const workspaceTemplateSuccessSchema = z.object({
  createdDirectories: z.array(z.string()),
  createdFiles: z.array(z.string()),
  skippedExisting: z.array(z.string()),
  workspaceRoot: z.string().min(1),
});

export const workspaceSelectErrorSchema = z.object({
  code: z.literal("workspace_selection_failed"),
  message: z.string().min(1),
});

export type WorkspaceSelectSuccess = z.infer<typeof workspaceSelectSuccessSchema>;
export type WorkspaceValidateRequest = z.infer<typeof workspaceValidateRequestSchema>;
export type WorkspaceTemplateRequest = z.infer<typeof workspaceTemplateRequestSchema>;
export type WorkspaceTemplateSuccess = z.infer<typeof workspaceTemplateSuccessSchema>;
export type WorkspaceSelectError = z.infer<typeof workspaceSelectErrorSchema>;
