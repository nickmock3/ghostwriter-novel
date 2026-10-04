import { z } from "zod";

export const builtInWorkspaceTemplateId = "built-in/basic-workspace";
export const chatModeNovelWorkspaceTemplateId = "built-in/chat-mode-novel";

export const workspaceTemplateItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("directory"),
    path: z.string().min(1),
  }),
  z.object({
    content: z.string(),
    kind: z.literal("file"),
    path: z.string().min(1),
  }),
]);

export const workspaceTemplateSchema = z.object({
  id: z.string(),
  items: z.array(workspaceTemplateItemSchema),
  name: z.string(),
  source: z.enum(["built-in", "user"]),
});

export const workspaceTemplateListResponseSchema = z.object({
  templates: z.array(workspaceTemplateSchema),
});

export const workspaceTemplateSaveResponseSchema = z.object({
  template: workspaceTemplateSchema,
});

export const saveWorkspaceTemplateBodySchema = z.object({
  items: z.array(workspaceTemplateItemSchema),
  name: z.string(),
});

export type WorkspaceTemplateItem = z.infer<typeof workspaceTemplateItemSchema>;
export type WorkspaceTemplate = z.infer<typeof workspaceTemplateSchema>;
export type WorkspaceTemplateListResponse = z.infer<typeof workspaceTemplateListResponseSchema>;
export type WorkspaceTemplateSaveResponse = z.infer<typeof workspaceTemplateSaveResponseSchema>;
export type SaveWorkspaceTemplateBody = z.infer<typeof saveWorkspaceTemplateBodySchema>;
