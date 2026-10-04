import { z } from "zod";

// 継続に必要なprovider metadataだけを保存。tokens/HTTP headersは含めない。
const providerOptions = z.object({ openai: z.object({
  itemId: z.string().optional(),
  reasoningEncryptedContent: z.string().nullable().optional(),
  namespace: z.string().optional(),
}).optional() }).optional();
const output = z.union([
  z.object({ type: z.enum(["text", "error-text"]), value: z.string() }),
  z.object({ type: z.enum(["json", "error-json"]), value: z.json() }),
  z.object({ type: z.literal("execution-denied"), reason: z.string().optional() }),
]);
const assistantPart = z.union([
  z.object({ type: z.enum(["text", "reasoning"]), text: z.string(), providerOptions }),
  z.object({ type: z.literal("tool-call"), toolCallId: z.string().min(1), toolName: z.string().min(1), input: z.json(), providerOptions }),
]);
const responseMessage = z.union([
  z.object({ role: z.literal("assistant"), content: z.union([z.string(), z.array(assistantPart)]) }),
  z.object({ role: z.literal("tool"), content: z.array(z.object({ type: z.literal("tool-result"), toolCallId: z.string().min(1), toolName: z.string().min(1), output, providerOptions })) }),
]);
export const siwcBindingSchema = z.object({ accountId: z.uuid(), modelId: z.string().min(1) });
export const siwcHistorySchema = siwcBindingSchema.extend({ messages: z.array(responseMessage) });
export type SiwcHistory = z.infer<typeof siwcHistorySchema>;
