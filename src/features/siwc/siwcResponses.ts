import { createOpenAIResponsesProvider } from "../llm/providers/openaiResponses";
import { APICallError, wrapLanguageModel } from "ai";
import { z } from "zod";
import type { Model } from "./models";
import { responseError } from "./errors";
import { BoundaryError } from "./result";
import type { SiwcRun } from "./service";
import type { ModelProvider, LlmProviderPlugin } from "../llm/providers/types";

type ResponsesModel = ReturnType<ReturnType<typeof createOpenAIResponsesProvider>["responses"]>;
type StreamResult = Awaited<ReturnType<ResponsesModel["doStream"]>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;
type GenerateResult = Awaited<ReturnType<ResponsesModel["doGenerate"]>>;
const terminalSchema = z.object({ type: z.string(), response: z.object({ error: z.unknown().optional() }).optional() });

function safeError(error: unknown): BoundaryError {
  if (error instanceof BoundaryError) return error;
  if (APICallError.isInstance(error)) {
    let body: unknown;
    try { body = JSON.parse(error.responseBody ?? "null"); } catch { body = null; }
    return new BoundaryError(responseError(body, error.statusCode));
  }
  return new BoundaryError("network");
}

// SDKのfinishReasonだけでは不十分。raw終端を検証してからfinishを外へ出す。
function validatedStream(source: ReadableStream<StreamPart>): ReadableStream<StreamPart> {
  const reader = source.getReader();
  let completed = false;
  let finished = false;
  return new ReadableStream<StreamPart>({
    async pull(controller) {
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) {
            if (!completed || !finished) throw new BoundaryError("disconnected");
            controller.close();
            reader.releaseLock();
            return;
          }
          const part = next.value;
          if (part.type === "raw") {
            const parsed = terminalSchema.safeParse(part.rawValue);
            if (parsed.success) {
              if (parsed.data.type === "response.incomplete") throw new BoundaryError("incomplete");
              if (parsed.data.type === "response.failed") throw new BoundaryError(responseError({ error: parsed.data.response?.error }));
              if (parsed.data.type === "response.completed") completed = true;
            }
            continue;
          }
          if (part.type === "error") throw safeError(part.error);
          if (part.type === "finish") {
            if (!completed) throw new BoundaryError("disconnected");
            finished = true;
          }
          controller.enqueue(part);
          return;
        }
      } catch (error: unknown) {
        controller.error(safeError(error));
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    },
    async cancel() { await reader.cancel().catch(() => {}); reader.releaseLock(); },
  });
}

// generateObject/compactionにもstream専用HTTP契約を適用する。
// 最終schemaの検証は呼出元のAI SDKが担当する。
async function collectGeneration(result: StreamResult): Promise<GenerateResult> {
  const reader = validatedStream(result.stream).getReader();
  const content: GenerateResult["content"] = [];
  const blocks = new Map<string, Extract<GenerateResult["content"][number], { type: "text" | "reasoning" }>>();
  let finish: Extract<StreamPart, { type: "finish" }> | undefined;
  let response: GenerateResult["response"];
  let warnings: GenerateResult["warnings"] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const part = next.value;
      if (part.type === "stream-start") warnings = part.warnings;
      else if (part.type === "response-metadata") {
        const { type: _type, ...metadata } = part;
        response = metadata;
      } else if (part.type === "finish") finish = part;
      else if (part.type === "text-start" || part.type === "reasoning-start") {
        const block = { type: part.type === "text-start" ? "text" as const : "reasoning" as const, text: "", providerMetadata: part.providerMetadata };
        blocks.set(part.id, block); content.push(block);
      } else if (part.type === "text-delta" || part.type === "reasoning-delta") {
        const block = blocks.get(part.id);
        if (!block) throw new BoundaryError("invalid_response");
        block.text += part.delta;
      } else if (part.type === "text-end" || part.type === "reasoning-end") {
        const block = blocks.get(part.id);
        if (block && part.providerMetadata) block.providerMetadata = { ...block.providerMetadata, ...part.providerMetadata };
      } else if (part.type === "tool-call") content.push(part);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!finish) throw new BoundaryError("disconnected");
  return { content, response, warnings, finishReason: finish.finishReason, usage: finish.usage, providerMetadata: finish.providerMetadata };
}

export function createSiwcModelProvider(run: SiwcRun, models: readonly Model[]): ModelProvider {
  const openai = createOpenAIResponsesProvider({
    // SDKのenv-key探索を無効化。実tokenはrun.fetchが送信直前に設定する。
    apiKey: "siwc-server-managed",
    baseURL: "https://api.openai.com/v1",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      if (request.url !== "https://api.openai.com/v1/responses" || request.method !== "POST") throw new BoundaryError("unsupported_request");
      return run.fetch(request.url, { method: "POST", headers: request.headers, body: await request.text(), signal: request.signal, redirect: "error" });
    },
  });
  return {
    getLanguageModel(modelId, providerId) {
      if (providerId !== "openai-chatgpt") throw new BoundaryError("unsupported_request");
      if (!models.some(model => model.slug === modelId)) throw new BoundaryError("invalid_model");
      return wrapLanguageModel({
        model: openai.responses(modelId),
        middleware: {
          specificationVersion: "v4",
          transformParams: async ({ params }) => ({
            prompt: params.prompt,
            abortSignal: params.abortSignal,
            responseFormat: params.responseFormat,
            toolChoice: params.toolChoice,
            includeRawChunks: true,
            tools: params.tools?.map(tool => {
              if (tool.type !== "function") throw new BoundaryError("unsupported_request");
              return { ...tool, providerOptions: { openai: { namespace: { name: "local", description: "Ghostwriter workspace tools" } } } };
            }),
            providerOptions: { openai: { store: false, systemMessageMode: "developer", include: ["reasoning.encrypted_content"] } },
          }),
          wrapStream: async ({ doStream }) => {
            try { return { stream: validatedStream((await doStream()).stream) }; }
            catch (error: unknown) { throw safeError(error); }
          },
          wrapGenerate: async ({ doStream }) => {
            try { return await collectGeneration(await doStream()); }
            catch (error: unknown) { throw safeError(error); }
          },
        },
      });
    },
  };
}

export function createSiwcProviderPlugin(run: SiwcRun, models: readonly Model[]): LlmProviderPlugin {
  const provider = createSiwcModelProvider(run, models);
  return {
    kind: "llm-provider", id: "openai-chatgpt", displayName: "ChatGPT プラン", connectionSettingsPolicy: "none",
    authentication: { type: "oauth", available: true },
    models: models.map(model => ({ id: model.slug, displayName: model.displayName, supportsTools: true, supportsTemperature: false })),
    createModel: modelId => provider.getLanguageModel(modelId, "openai-chatgpt"),
  };
}
