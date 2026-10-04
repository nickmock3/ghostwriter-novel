// @vitest-environment node
import { generateObject, isStepCount, streamText, tool } from "ai";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import type { SiwcRun } from "../../siwc/service";
import { complete, sse, textEvents, toolEvents } from "../../siwc/test-support";
import { createSiwcModelProvider } from "./siwcResponses";

const setup = (responses: Response[]) => {
  const requests: Record<string, unknown>[] = [];
  const fetcher = vi.fn<SiwcRun["fetch"]>(async (url, init) => {
    expect(url).toBe("https://api.openai.com/v1/responses");
    requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    const response = responses.shift();
    if (!response) throw new Error("Unexpected request");
    return response;
  });
  const provider = createSiwcModelProvider({ accountId: "synthetic", fetch: fetcher }, [{ slug: "test-model", displayName: "Test" }]);
  return { provider, model: provider.getLanguageModel("test-model", "openai-chatgpt"), requests, fetcher };
};
async function consume(result: { stream: AsyncIterable<{ type: string; error?: unknown }> }) {
  const parts = [];
  for await (const part of result.stream) {
    if (part.type === "error") throw part.error;
    parts.push(part);
  }
  return parts;
}
it("共通ループ由来のsampling・上限・providerOptionsを除外してResponsesへ送る", async () => {
  const { model, requests } = setup([sse([...textEvents("hello"), complete])]);
  const result = streamText({ model, system: "Instructions", prompt: "Hello", temperature: 0.7, maxOutputTokens: 4000,
    providerOptions: { openai: { store: true, previousResponseId: "forbidden", metadata: { secret: "no" }, truncation: "auto" } },
  });
  await consume(result);
  expect(requests[0]).toMatchObject({ model: "test-model", store: false, stream: true, include: ["reasoning.encrypted_content"], input: [{ role: "developer", content: "Instructions" }, { role: "user" }] });
  for (const field of ["temperature", "max_output_tokens", "previous_response_id", "metadata", "truncation"]) expect(requests[0]).not.toHaveProperty(field);
});
it("既存toolをnamespaceへ変換し、実行と次stepへの結果返送を維持する", async () => {
  const { model, requests } = setup([sse([...toolEvents("abc"), complete]), sse([...textEvents("3"), complete])]);
  const execute = vi.fn(async ({ text }: { text: string }) => ({ count: text.length }));
  const result = streamText({ model, prompt: "Count", stopWhen: isStepCount(3), tools: { count_text: tool({ description: "Count text", inputSchema: z.object({ text: z.string() }), execute }) } });
  await consume(result);
  expect(execute).toHaveBeenCalledOnce();
  expect(requests[0]?.tools).toMatchObject([{ type: "namespace", name: "local", tools: [{ type: "function", name: "count_text" }] }]);
  expect(requests[1]?.input).toEqual(expect.arrayContaining([expect.objectContaining({ type: "function_call_output", call_id: "call_test" })]));
});
it.each([401, 403, 429, 503])("HTTP %sでもSDKの既定retryに再送させず秘密を出さない", async status => {
  const { model, fetcher } = setup([Response.json({ detail: "dummy-access-token" }, { status })]);
  const result = streamText({ model, prompt: "Hello", onError: () => {} });
  await expect(consume(result)).rejects.not.toThrow("dummy-access-token");
  expect(fetcher).toHaveBeenCalledOnce();
});
it.each([
  ["incomplete", { type: "response.incomplete", response: {} }, "incomplete"],
  ["failed", { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } }, "usage_limit"],
  ["EOF", undefined, "disconnected"],
])("%sを正常完了にしない", async (_label, terminal, error) => {
  const { model } = setup([sse([...textEvents("partial"), ...(terminal ? [terminal] : [])])]);
  await expect(consume(streamText({ model, prompt: "Hello", onError: () => {} }))).rejects.toThrow(String(error));
});
it("SDKのgenerateObjectもHTTPはstreamにし、正常終端後のschema検証へ返す", async () => {
  const { model, requests } = setup([sse([...textEvents('{"text":"draft"}'), complete])]);
  const result = await generateObject({ model, schema: z.object({ text: z.string() }), prompt: "Write", maxOutputTokens: 100, temperature: 0.5 });
  expect(result.object).toEqual({ text: "draft" });
  expect(requests[0]).toMatchObject({ stream: true, store: false, text: { format: { type: "json_schema" } } });
  expect(requests[0]).not.toHaveProperty("max_output_tokens");
});
it("別provider・未取得modelは使えずAPIキーへfallbackしない", () => {
  const { provider, fetcher } = setup([]);
  expect(() => provider.getLanguageModel("test-model", "openai")).toThrow("unsupported_request");
  expect(() => provider.getLanguageModel("unknown", "openai-chatgpt")).toThrow("invalid_model");
  expect(fetcher).not.toHaveBeenCalled();
});
