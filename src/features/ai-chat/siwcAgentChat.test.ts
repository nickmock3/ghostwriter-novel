// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { createSiwcService } from "../siwc/service";
import { createCredentialStore } from "../siwc/store";
import { testAccount, testNow, sse, textEvents, complete } from "../siwc/test-support";
import { appendConversationMessage, applyConversationEditProposal, createConversation, getConversation, undoConversationEditProposal } from "./conversationHistory";
import { runSiwcAgentChat } from "./siwcAgentChat";
import type { Fetch } from "../siwc/oidc";
// 合成HTTPでもWindowsの資格情報保存・ACL・複数stepは実経路を通す。
if (process.platform === "win32") vi.setConfig({ testTimeout: 60_000 });
let dataRoot: string; let workspaceRoot: string;
beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), "ghostwriter-siwc-chat-"));
  workspaceRoot = await mkdtemp(join(tmpdir(), "ghostwriter-siwc-draft-"));
  await writeFile(join(workspaceRoot, "draft.txt"), "before");
  await createCredentialStore(join(dataRoot, "siwc")).update(async state => ({ state: { ...state, accounts: [testAccount], activeAccountId: testAccount.id }, value: undefined }));
});
afterEach(async () => { await Promise.all([rm(dataRoot, { recursive: true, force: true }), rm(workspaceRoot, { recursive: true, force: true })]); vi.restoreAllMocks(); });
const call = (name: string, input: unknown, id: string) => {
  const item = { type: "function_call", id: `fc_${id}`, call_id: id, name, namespace: "local", arguments: JSON.stringify(input), status: "completed" };
  return [ { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "" } }, { type: "response.function_call_arguments.delta", item_id: item.id, output_index: 0, delta: item.arguments }, { type: "response.output_item.done", output_index: 0, item }, complete ];
};
const reasoning = [
  { type: "response.output_item.added", output_index: 1, item: { type: "reasoning", id: "rs_1", summary: [] } },
  { type: "response.output_item.done", output_index: 1, item: { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "encrypted-fixture" } },
];
function harness(responses: Response[]) {
  const bodies: Record<string, unknown>[] = [];
  const fetcher = vi.fn<Fetch>(async (url, init) => {
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer dummy-access-token");
    if (url.endsWith("/models")) return Response.json({ models: [{ slug: "test-model", display_name: "Test", visibility: "list" }] });
    bodies.push(z.record(z.string(), z.unknown()).parse(JSON.parse(String(init.body))));
    const response = responses.shift();
    if (!response) throw new Error("Unexpected request");
    return response;
  });
  const service = createSiwcService({ dataRoot, fetch: fetcher, now: () => testNow });
  return { service, bodies, fetcher };
}
const input = (conversationId: string, mode: "chat" | "editor" = "editor") => ({ conversationId, workspaceRoot, content: "Edit draft", autoCompactEnabled: false, autoCompactThresholdRatio: 0.7, mode, modelSelection: { providerId: "openai-chatgpt", modelId: "test-model" } });
it("実Read→提案→未保存拒否→Apply→Undo→再起動相当の追質問を共通経路で行う", async () => {
  const conversation = await createConversation({ dataRoot, workspaceRoot });
  const setup = harness([
    sse([...reasoning, ...call("Read", { path: "draft.txt" }, "read")]),
    sse(call("Edit", { path: "draft.txt", oldText: "before", newText: "after" }, "edit")),
    sse([...textEvents("Proposed"), complete]),
    sse([...textEvents("Continued"), complete]),
  ]);
  const first = await runSiwcAgentChat({ ...setup, dataRoot, input: input(conversation.id) });
  expect(first.conversation.editProposals).toHaveLength(1);
  const proposal = first.conversation.editProposals[0]!;
  expect(proposal.status).toBe("pending");
  expect(await readFile(join(workspaceRoot, "draft.txt"), "utf8")).toBe("before");
  const target = { dataRoot, workspaceRoot, conversationId: conversation.id, proposalId: proposal.id };
  await expect(applyConversationEditProposal({ ...target, dirtyPaths: ["draft.txt"] })).rejects.toThrow();
  await applyConversationEditProposal({ ...target, dirtyPaths: [] });
  expect(await readFile(join(workspaceRoot, "draft.txt"), "utf8")).toBe("after");
  await undoConversationEditProposal(target);
  expect(await readFile(join(workspaceRoot, "draft.txt"), "utf8")).toBe("before");
  const restored = await getConversation({ dataRoot, workspaceRoot, conversationId: conversation.id });
  expect(restored.messages.at(-1)?.siwcHistory?.messages).toHaveLength(5);
  await runSiwcAgentChat({ ...setup, dataRoot, input: { ...input(conversation.id), content: "Continue" } });
  expect(JSON.stringify(setup.bodies[3]?.input)).toContain("encrypted-fixture");
  expect(setup.bodies[3]?.input).toEqual(expect.arrayContaining([expect.objectContaining({ type: "function_call_output", call_id: "read" }), expect.objectContaining({ type: "function_call_output", call_id: "edit" })]));
});
it("自動Apply後の切断でも一度だけ保存しUndoできる", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const conversation = await createConversation({ dataRoot, workspaceRoot });
  const setup = harness([sse(call("Read", { path: "draft.txt" }, "read")), sse(call("Edit", { path: "draft.txt", oldText: "before", newText: "after" }, "edit")), sse(textEvents("partial"))]);
  await expect(runSiwcAgentChat({ ...setup, dataRoot, input: input(conversation.id, "chat") })).rejects.toThrow("disconnected");
  const saved = await getConversation({ dataRoot, workspaceRoot, conversationId: conversation.id });
  expect(setup.bodies).toHaveLength(3);
  expect(saved.editProposals).toHaveLength(1);
  expect(saved.editProposals[0]?.status).toBe("applied");
  expect(await readFile(join(workspaceRoot, "draft.txt"), "utf8")).toBe("after");
  await undoConversationEditProposal({ dataRoot, workspaceRoot, conversationId: conversation.id, proposalId: saved.editProposals[0]!.id });
  expect(await readFile(join(workspaceRoot, "draft.txt"), "utf8")).toBe("before");
});
it("既存APIキー会話をSIWCへ自動移行しない", async () => {
  const conversation = await createConversation({ dataRoot, workspaceRoot });
  await appendConversationMessage({ dataRoot, workspaceRoot, conversationId: conversation.id, role: "user", content: "Existing" });
  const setup = harness([]);
  await expect(runSiwcAgentChat({ ...setup, dataRoot, input: input(conversation.id) })).rejects.toThrow();
  const saved = await getConversation({ dataRoot, workspaceRoot, conversationId: conversation.id });
  expect(saved.messages).toHaveLength(1);
  expect(saved.siwc).toBeUndefined();
  expect(setup.bodies).toHaveLength(0);
});
it("AIアシストはstream推論から承認待ちproposalを作り、原稿を直接変更しない", async () => {
  const { createStandardAiAssistExecutionService } = await import("../ai-assist/aiAssistExecutionService");
  const setup = harness([sse([...textEvents('{"newText":"polished"}'), complete])]);
  const assist = createStandardAiAssistExecutionService({ siwcService: setup.service });
  const result = await assist.run({ workspaceRoot, workspaceRelativePath: "draft.txt", editorContent: "before", targetRange: { start: 0, end: 6 }, assistId: "polish", standardModelSelection: { kind: "model", providerId: "openai-chatgpt", modelId: "test-model" } });
  expect(result).toMatchObject({ status: "completed", proposal: { newText: "polished", status: "pending" }, llmProfile: { providerId: "openai-chatgpt" } });
  expect(await readFile(join(workspaceRoot, "draft.txt"), "utf8")).toBe("before");
  expect(setup.bodies[0]).toMatchObject({ stream: true, store: false });
});
it("次のtool stepはrefresh後のtokenを使い、古いtokenを再送しない", async () => {
  const conversation = await createConversation({ dataRoot, workspaceRoot });
  const store = createCredentialStore(join(dataRoot, "siwc"));
  const tokens: string[] = [];
  let responseCount = 0;
  let refreshCount = 0;
  const fetcher: Fetch = async (url, init) => {
    if (url.endsWith("openid-configuration")) return Response.json({ issuer: "https://auth.openai.com", authorization_endpoint: "https://auth.openai.com/auth", token_endpoint: "https://auth.openai.com/token", jwks_uri: "https://auth.openai.com/keys" });
    if (url.endsWith("/token")) { refreshCount++; return Response.json({ access_token: "rotated", refresh_token: "rotated-refresh", expires_in: 3600, token_type: "Bearer" }); }
    if (url.endsWith("/models")) return Response.json({ models: [{ slug: "test-model", display_name: "Test", visibility: "list" }] });
    tokens.push(new Headers(init.headers).get("authorization") ?? "");
    if (++responseCount === 1) {
      await store.update(async state => ({ state: { ...state, accounts: state.accounts.map(account => ({ ...account, session: { ...account.session!, expiresAt: testNow - 1 } })) }, value: undefined }));
      return sse(call("Read", { path: "draft.txt" }, "read"));
    }
    return sse([...textEvents("Read"), complete]);
  };
  const service = createSiwcService({ dataRoot, fetch: fetcher, now: () => testNow });
  await runSiwcAgentChat({ dataRoot, service, input: input(conversation.id) });
  expect(tokens).toEqual(["Bearer dummy-access-token", "Bearer rotated"]);
  expect(refreshCount).toBe(1);
});
it("利用中のアカウント変更を拒否し、別登録で既存会話を継続しない", async () => {
  const conversation = await createConversation({ dataRoot, workspaceRoot });
  const setup = harness([sse([...textEvents("hello"), complete])]);
  let mutation: Promise<unknown> | undefined;
  await runSiwcAgentChat({ ...setup, dataRoot, input: input(conversation.id), onEvent: () => { mutation ??= setup.service.logout(new AbortController().signal); } });
  expect(await mutation).toEqual({ ok: false, error: "busy" });
  const other = { ...testAccount, id: "00000000-0000-4000-8000-000000000002", clientId: "oaiapp_other" };
  await createCredentialStore(join(dataRoot, "siwc")).update(async state => ({ state: { ...state, accounts: [...state.accounts, other], activeAccountId: other.id }, value: undefined }));
  await expect(runSiwcAgentChat({ ...setup, dataRoot, input: input(conversation.id) })).rejects.toThrow();
  expect(setup.bodies).toHaveLength(1);
});
it("手動圧縮もSIWC bindingを使い、streamによる要約を保存する", async () => {
  const { bindConversationSiwc } = await import("./conversationHistory");
  const { createConversationApiHandler } = await import("./conversationApi");
  const conversation = await createConversation({ dataRoot, workspaceRoot });
  await bindConversationSiwc({ dataRoot, workspaceRoot, conversationId: conversation.id, accountId: testAccount.id, modelId: "test-model" });
  await appendConversationMessage({ dataRoot, workspaceRoot, conversationId: conversation.id, role: "user", content: "Plan" });
  await appendConversationMessage({ dataRoot, workspaceRoot, conversationId: conversation.id, role: "assistant", content: "Outline" });
  const setup = harness([sse([...textEvents('{"summary":"Plan summary"}'), complete])]);
  const handler = createConversationApiHandler({ dataRoot, siwcService: setup.service });
  const response = await handler(new Request("http://localhost/api/conversations", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "compactConversation", conversationId: conversation.id, workspaceRoot }) }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "compacted" });
  expect(setup.bodies[0]).toMatchObject({ stream: true, store: false });
  const saved = await getConversation({ dataRoot, workspaceRoot, conversationId: conversation.id });
  expect(saved.conversationCompactions).toHaveLength(1);
});
