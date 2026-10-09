/*
MIT License

Copyright (c) 2026 ChatGPT Plan Playground contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import { createOpenAI } from "@ai-sdk/openai";
import { type ModelMessage, isStepCount, streamText, tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
// Adapted from chatgpt-plan-playground (MIT), commit 0105676.
// This tests SDK 7 transport contracts only; it does not enable SIWC in Ghostwriter.
const countTextInputSchema = z.object({ text: z.string() });
const countText = ({ text }: z.infer<typeof countTextInputSchema>) => ({
  characters: Array.from(text).length,
  lines: text.split("\n").length,
});

// 合成fixtureのみ。実サービスの応答や資格情報を保存しない。
const modelSlug = "test-model";
const dummyToken = "dummy-oauth-token-not-a-real-credential";
const providerOptions = {
  openai: {
    store: false,
    systemMessageMode: "developer",
    include: ["reasoning.encrypted_content"],
  },
};
const forbiddenFields = [
  "background",
  "conversation",
  "max_output_tokens",
  "max_tool_calls",
  "metadata",
  "moderation",
  "multi_agent",
  "prompt",
  "prompt_cache_retention",
  "safety_identifier",
  "temperature",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
  "previous_response_id",
];
const completed = { type: "response.completed", response: {} };
const textEvents = (text: string) => [
  {
    type: "response.output_item.added",
    output_index: 0,
    item: { type: "message", id: "msg_test", role: "assistant", content: [] },
  },
  {
    type: "response.output_text.delta",
    item_id: "msg_test",
    output_index: 0,
    delta: text,
  },
  {
    type: "response.output_item.done",
    output_index: 0,
    item: {
      type: "message",
      id: "msg_test",
      role: "assistant",
      content: [{ type: "output_text", text, annotations: [] }],
    },
  },
];
const toolEvents = (text: unknown) => {
  const item = {
    type: "function_call",
    status: "completed",
    id: "fc_test",
    call_id: "call_test",
    name: "count_text",
    namespace: "local",
    arguments: JSON.stringify({ text }),
  };
  return [
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...item, arguments: "" },
    },
    {
      type: "response.function_call_arguments.delta",
      item_id: item.id,
      output_index: 0,
      delta: item.arguments,
    },
    { type: "response.output_item.done", output_index: 0, item },
    completed,
  ];
};
const reasoningEvents = [
  {
    type: "response.output_item.added",
    output_index: 1,
    item: { type: "reasoning", id: "rs_test", summary: [] },
  },
  {
    type: "response.output_item.done",
    output_index: 1,
    item: {
      type: "reasoning",
      id: "rs_test",
      summary: [],
      encrypted_content: "dummy-encrypted-reasoning",
    },
  },
];

const createHarness = (responses: readonly Response[]) => {
  const requests: {
    url: string;
    method: string;
    headers: Headers;
    body: Record<string, unknown>;
  }[] = [];
  const openai = createOpenAI({
    apiKey: dummyToken,
    baseURL: "https://api.openai.com/v1",
    fetch: Object.assign(
      async (...[input, init]: Parameters<typeof fetch>) => {
        const request = new Request(input, init);
        const body: unknown = await request.json();
        requests.push({
          url: request.url,
          method: request.method,
          headers: request.headers,
          body: z.record(z.string(), z.unknown()).parse(body),
        });
        const response = responses[requests.length - 1];
        if (!response)
          throw new Error(
            "想定外のSDKリクエスト（ネットワークには接続しない）",
          );
        return response;
      },
      { preconnect: () => {} },
    ),
  });
  return { model: openai.responses(modelSlug), requests };
};
const sse = (events: readonly unknown[]) =>
  new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
const rawType = (value: unknown) => {
  const parsed = z.object({ type: z.string() }).safeParse(value);
  return parsed.success ? parsed.data.type : undefined;
};

describe("SIWC on installed AI SDK 7（偽HTTP/SSE契約検証）", () => {
  it("通信例外を通知し、途中の応答を自動再送しない", async () => {
    const encoder = new TextEncoder();
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          controller.error(new Error("Synthetic connection reset"));
          return;
        }
        sent = true;
        controller.enqueue(
          encoder.encode(
            textEvents("partial")
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join(""),
          ),
        );
      },
    });
    const harness = createHarness([
      new Response(body, {
        headers: { "content-type": "text/event-stream" },
      }),
    ]);
    const errors: unknown[] = [];
    const result = streamText({
      model: harness.model,
      prompt: "hello",
      providerOptions,
      maxRetries: 0,
      streamRetries: 0,
      include: { rawChunks: true },
      onError: () => {},
    });
    const rawTypes: (string | undefined)[] = [];
    try {
      for await (const part of result.stream) {
        if (part.type === "error") errors.push(part.error);
        if (part.type === "raw") rawTypes.push(rawType(part.rawValue));
      }
    } catch (error: unknown) {
      errors.push(error);
    }
    expect(errors.length).toBeGreaterThan(0);
    expect(rawTypes).not.toContain("response.completed");
    expect(harness.requests).toHaveLength(1);
  });

  it("ステップ上限でtool結果の後続推論を停止する", async () => {
    const harness = createHarness([sse(toolEvents("test"))]);
    const result = streamText({
      model: harness.model,
      prompt: "count",
      providerOptions,
      tools: {
        count_text: tool({
          inputSchema: countTextInputSchema,
          execute: countText,
          providerOptions: {
            openai: {
              namespace: { name: "local", description: "Local pure functions" },
            },
          },
        }),
      },
      stopWhen: isStepCount(1),
      maxRetries: 0,
      streamRetries: 0,
    });
    expect(await result.finishReason).toBe("tool-calls");
    expect(await result.steps).toHaveLength(1);
    expect(await result.text).toBe("");
    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0]?.body).not.toHaveProperty("max_tool_calls");
  });

  it("schemaに合わないtool引数はローカル実行しない", async () => {
    const execute = vi.fn(countText);
    const harness = createHarness([sse(toolEvents(123))]);
    const result = streamText({
      model: harness.model,
      prompt: "count",
      providerOptions,
      tools: {
        count_text: tool({
          inputSchema: countTextInputSchema,
          execute,
          providerOptions: {
            openai: {
              namespace: { name: "local", description: "Local pure functions" },
            },
          },
        }),
      },
      stopWhen: isStepCount(1),
      maxRetries: 0,
      streamRetries: 0,
      onError: () => {},
    });
    await result.consumeStream();
    expect(execute).not.toHaveBeenCalled();
    expect(harness.requests).toHaveLength(1);
  });

  it("Responses経路・Bearer・配列input・developer指示・禁止フィールド省略を確認する", async () => {
    const harness = createHarness([sse([...textEvents("ok"), completed])]);
    const result = streamText({
      model: harness.model,
      prompt: "hello",
      instructions: "Be concise.",
      providerOptions,
      maxRetries: 0,
      streamRetries: 0,
    });
    expect(await result.text).toBe("ok");
    expect(await result.finishReason).toBe("stop");
    expect(harness.requests).toHaveLength(1);
    const request = harness.requests[0];
    expect(request?.url).toBe("https://api.openai.com/v1/responses");
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("authorization")).toBe(`Bearer ${dummyToken}`);
    expect(request?.body).toMatchObject({
      model: modelSlug,
      store: false,
      stream: true,
      input: [
        { role: "developer", content: "Be concise." },
        { role: "user", content: [{ type: "input_text", text: "hello" }] },
      ],
    });
    for (const field of forbiddenFields)
      expect(request?.body).not.toHaveProperty(field);
  });

  it("namespace toolを実行し、結果・reasoning・追質問の履歴を再送する", async () => {
    const harness = createHarness([
      sse([...reasoningEvents, ...toolEvents("あ😀")]),
      sse([...textEvents("2文字です。"), completed]),
      sse([...textEvents("1行です。"), completed]),
    ]);
    const execute = vi.fn(countText);
    const tools = {
      count_text: tool({
        description: "Count Unicode code points and lines.",
        inputSchema: countTextInputSchema,
        execute,
        providerOptions: {
          openai: {
            namespace: { name: "local", description: "Local pure functions" },
          },
        },
      }),
    };
    const initialMessages: ModelMessage[] = [
      { role: "user", content: "あ😀の文字数は？" },
    ];
    const result = streamText({
      model: harness.model,
      messages: initialMessages,
      tools,
      providerOptions,
      maxRetries: 0,
      streamRetries: 0,
      stopWhen: isStepCount(3),
    });
    expect(await result.text).toBe("2文字です。");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toEqual({ text: "あ😀" });
    expect(harness.requests[0]?.body.tools).toEqual([
      expect.objectContaining({
        type: "namespace",
        name: "local",
        tools: [
          expect.objectContaining({ type: "function", name: "count_text" }),
        ],
      }),
    ]);
    const expectedHistory = [
      expect.objectContaining({
        type: "function_call",
        call_id: "call_test",
        namespace: "local",
        name: "count_text",
      }),
      expect.objectContaining({
        type: "function_call_output",
        call_id: "call_test",
        output: JSON.stringify({ characters: 2, lines: 1 }),
      }),
      expect.objectContaining({
        type: "reasoning",
        encrypted_content: "dummy-encrypted-reasoning",
      }),
    ];
    expect(harness.requests[1]?.body.input).toEqual(
      expect.arrayContaining(expectedHistory),
    );
    const followup = streamText({
      model: harness.model,
      tools,
      providerOptions,
      maxRetries: 0,
      streamRetries: 0,
      messages: [
        ...initialMessages,
        ...(await result.responseMessages),
        { role: "user", content: "行数は？" },
      ],
    });
    expect(await followup.text).toBe("1行です。");
    expect(harness.requests).toHaveLength(3);
    expect(harness.requests[2]?.body.input).toEqual(
      expect.arrayContaining(expectedHistory),
    );
    for (const request of harness.requests) {
      expect(request.body).toMatchObject({ store: false, stream: true });
      for (const field of forbiddenFields)
        expect(request.body).not.toHaveProperty(field);
    }
  });

  it.each([
    {
      name: "正常完了",
      terminal: completed,
      finish: "stop",
      raw: "response.completed",
    },
    {
      name: "出力上限による不完全終了",
      terminal: {
        type: "response.incomplete",
        response: { incomplete_details: { reason: "max_output_tokens" } },
      },
      finish: "length",
      raw: "response.incomplete",
    },
    // SDKのstopはresponse.completedの証拠にならないことを固定する。
    {
      name: "理由欠落の不完全終了",
      terminal: { type: "response.incomplete", response: {} },
      finish: "stop",
      raw: "response.incomplete",
    },
    {
      name: "途中の正常EOF",
      terminal: undefined,
      finish: "other",
      raw: undefined,
    },
    {
      name: "利用枠エラー",
      terminal: {
        type: "response.failed",
        sequence_number: 3,
        response: {
          error: {
            code: "subscription_sharing_usage_limit_exceeded",
            message: "Synthetic quota error",
          },
        },
      },
      finish: "error",
      raw: "response.failed",
    },
  ])("$name を生イベントで識別する", async ({ terminal, finish, raw }) => {
    const harness = createHarness([
      sse([...textEvents("partial"), ...(terminal ? [terminal] : [])]),
    ]);
    const result = streamText({
      model: harness.model,
      prompt: "hello",
      providerOptions,
      include: { rawChunks: true },
      maxRetries: 0,
      streamRetries: 0,
      onError: () => {},
    });
    const rawTypes: (string | undefined)[] = [];
    const errors: unknown[] = [];
    for await (const part of result.stream) {
      if (part.type === "raw") rawTypes.push(rawType(part.rawValue));
      if (part.type === "error") errors.push(part.error);
    }
    expect(await result.finishReason).toBe(finish);
    if (raw) expect(rawTypes).toContain(raw);
    if (raw !== "response.completed")
      expect(rawTypes).not.toContain("response.completed");
    if (raw === "response.failed") expect(errors).toHaveLength(1);
    expect(harness.requests).toHaveLength(1);
  });

  it.each([401, 403, 429, 503])(
    "HTTP %i のdetailエラーを自動再試行しない",
    async (status) => {
      const harness = createHarness([
        Response.json({ detail: "Synthetic admission error" }, { status }),
      ]);
      const result = streamText({
        model: harness.model,
        prompt: "hello",
        providerOptions,
        maxRetries: 0,
        streamRetries: 0,
        onError: () => {},
      });
      const errors: unknown[] = [];
      for await (const part of result.stream)
        if (part.type === "error") errors.push(part.error);
      expect(errors.length).toBeGreaterThan(0);
      expect(harness.requests).toHaveLength(1);
    },
  );
});
