import { z } from "zod";

export const planItemStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "skipped",
]);

export const planItemSchema = z.object({
  detail: z.string().min(1).optional(),
  id: z.string().min(1),
  status: planItemStatusSchema,
  title: z.string().min(1),
});

export type PlanItem = z.infer<typeof planItemSchema>;
