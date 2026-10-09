import { startStandaloneServer } from "../../src/shared/server/standaloneServer";
// Dedicated HTTP server: real routing, SIWC runtime, tools and persistence;
// only OAuth credentials and upstream model HTTP/SSE are synthetic.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiRouter, createProductionApiHandlers } from "../../src/shared/server/apiRouter";
import { createSiwcService } from "../../src/features/siwc/service";
import { createCredentialStore } from "../../src/features/siwc/store";
import { createSiwcApiHandler } from "../../src/features/siwc/api";
import { createModelProviderApiHandler } from "../../src/features/llm/modelProviderApi";
import { createAgentChatApiHandler } from "../../src/features/ai-chat/agentChatApi";
import { createProductionAiAssistApiHandler } from "../../src/features/ai-assist/aiAssistApi";
import { createConversationApiHandler } from "../../src/features/ai-chat/conversationApi";
import { testAccount, testNow, sse, textEvents, complete } from "../../src/features/siwc/test-support";
const dataRoot = await mkdtemp(join(tmpdir(), "ghostwriter-siwc-e2e-data-"));
await createCredentialStore(join(dataRoot, "siwc")).update(async state => ({ state: { ...state, accounts: [testAccount], activeAccountId: testAccount.id }, value: undefined }));
const call = (name: string, input: unknown, id: string) => {
  const item = { type: "function_call", id: `fc_${id}`, call_id: id, name, namespace: "local", arguments: JSON.stringify(input), status: "completed" };
  return sse([{ type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "" } }, { type: "response.function_call_arguments.delta", item_id: item.id, output_index: 0, delta: item.arguments }, { type: "response.output_item.done", output_index: 0, item }, complete]);
};
let chatStep = 0;
const siwcService = createSiwcService({ dataRoot, now: () => testNow, fetch: async (url, init) => {
  if (url.endsWith("/models")) return Response.json({ models: [{ slug: "test-model", display_name: "Test ChatGPT", visibility: "list" }] });
  if (!url.endsWith("/responses")) throw new Error("Unexpected upstream request");
  const body = JSON.parse(String(init.body));
  if (body.text?.format?.type === "json_schema") return sse([...textEvents('{"newText":"assisted"}'), complete]);
  chatStep++;
  if (chatStep === 1) return call("Read", { path: "draft.txt" }, "read");
  if (chatStep === 2) return call("Edit", { path: "draft.txt", oldText: "before", newText: "after" }, "edit");
  return sse([...textEvents(chatStep === 3 ? "編集しました" : "履歴を引き継ぎました"), complete]);
} });
const handlers = createProductionApiHandlers({ dataRoot, env: {} });
const router = createApiRouter({ handlers: { ...handlers,
  siwc: createSiwcApiHandler({ service: siwcService, enabled: true }),
  modelProviders: createModelProviderApiHandler({ siwcService }),
  agentChat: createAgentChatApiHandler({ siwcService, dataRoot }),
  aiAssists: createProductionAiAssistApiHandler({ siwcService, dataRoot }),
  conversations: createConversationApiHandler({ siwcService, dataRoot }),
} });
const server = await startStandaloneServer({ port: 0, hostname: "127.0.0.1", handler: router });
console.log(JSON.stringify({ port: server.port }));
async function stop() { await server.stop(true); await rm(dataRoot, { recursive: true, force: true }); process.exit(0); }
process.on("SIGTERM", () => { void stop(); });
