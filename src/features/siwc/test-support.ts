import type { Account } from "./credentials";

export const testNow = 1790985600000;
export const testAccount: Account = {
  id: "00000000-0000-4000-8000-000000000001",
  clientId: "oaiapp_test",
  identity: { issuer: "https://auth.openai.com", subject: "synthetic-subject" },
  session: {
    accessToken: "dummy-access-token",
    refreshToken: "dummy-refresh",
    idToken: "dummy-id-token",
    scopes: ["chatgpt.tokens.use.direct"],
    expiresAt: testNow + 3600000,
  },
};
export const complete = { type: "response.completed", response: {} };
export const textEvents = (text: string) => [
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
export const toolEvents = (text: unknown = "あ😀") => {
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
  ];
};
export const sse = (events: readonly unknown[]) =>
  new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
