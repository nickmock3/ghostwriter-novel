import { NoObjectGeneratedError, streamObject, type LanguageModel } from "ai";
import type { z } from "zod";

export type GenerateWritingObject = (options: {
  maxOutputTokens?: number;
  model: unknown;
  prompt: string;
  schema: unknown;
  temperature?: number;
  onProgress?: (generatedCharacters: number) => void;
}) => Promise<{ object: unknown; usage?: unknown }>;

/** Only validated final objects leave this boundary; progress contains counts, never prose. */
export const streamWritingObject: GenerateWritingObject = async ({ onProgress, ...options }) => {
  const result = streamObject({
    ...options,
    // The injectable generation boundary uses unknown; production callers supply
    // the provider's LanguageModel and the writing tool's Zod schema.
    model: options.model as LanguageModel,
    schema: options.schema as z.ZodType,
    onError: () => {}, // fullStream errors are handled below, without logging raw payloads.
  });
  let finished = false;
  let lastCount = 0;
  let lastNotification = 0;
  for await (const part of result.fullStream) {
    if (part.type === "error") {
      throw part.error instanceof Error ? part.error : new Error("本文の生成に失敗しました。");
    }
    if (part.type === "object" && typeof part.object === "object" && part.object !== null) {
      const value = part.object as Record<string, unknown>;
      const text = typeof value.content === "string" ? value.content : value.newText;
      const count = typeof text === "string" ? text.length : 0;
      const now = Date.now();
      if (count > lastCount && (lastCount === 0 || now - lastNotification >= 250)) {
        lastCount = count;
        lastNotification = now;
        onProgress?.(count);
      }
    }
    if (part.type === "finish") {
      finished = true;
      if (part.finishReason !== "stop") {
        throw new NoObjectGeneratedError({
          message: part.finishReason === "length"
            ? "本文の出力上限に達しました。章や場面を短く区切って再度依頼してください。"
            : "本文の生成が正常に完了しませんでした。",
          response: part.response,
          usage: part.usage,
          finishReason: part.finishReason,
        });
      }
    }
  }
  // Missing finish/error chunks must not leave result.object pending forever.
  if (!finished) throw new Error("本文の生成中に通信が終了しました。再度依頼してください。");
  return { object: await result.object, usage: await result.usage };
};
