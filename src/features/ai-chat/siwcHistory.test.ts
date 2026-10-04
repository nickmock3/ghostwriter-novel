import { expect, it } from "vitest";
import { siwcHistorySchema } from "./siwcHistory";
import { conversationSchema } from "./conversationSchemas";
import { toModelMessages } from "./modelMessages";
const accountId = "00000000-0000-4000-8000-000000000001";
const timestamp = "2026-10-04T00:00:00Z";
const messages = [
  { role: "assistant", content: [{ type: "reasoning", text: "", providerOptions: { openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted-fixture" } } }, { type: "tool-call", toolCallId: "call_1", toolName: "Read", input: { path: "draft.txt" }, providerOptions: { openai: { itemId: "fc_1", namespace: "local" } } }] },
  { role: "tool", content: [{ type: "tool-result", toolCallId: "call_1", toolName: "Read", output: { type: "json", value: { content: "draft" } } }] },
  { role: "assistant", content: [{ type: "text", text: "Read it" }] },
];
const history = () => siwcHistorySchema.parse({ accountId, modelId: "model", messages });
const conversation = () => conversationSchema.parse({
  id: "chat", workspaceId: "workspace", title: "chat", createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp, editProposals: [],
  siwc: { accountId, modelId: "model" },
  messages: [{ id: "u1", role: "user", content: "Read", createdAt: timestamp }, { id: "a1", role: "assistant", content: "Read it", createdAt: timestamp, siwcHistory: history() }, { id: "u2", role: "user", content: "Continue", createdAt: timestamp }],
});
it("全stepのtoolと暗号化reasoningを会話JSONから復元する", () => {
  const restored = conversationSchema.parse(JSON.parse(JSON.stringify(conversation())));
  expect(toModelMessages(restored, { strategy: "conversation-compaction", siwcAccountId: accountId })).toEqual([{ role: "user", content: "Read" }, ...messages, { role: "user", content: "Continue" }]);
});
it("別アカウントへprovider履歴を再送しない", () => {
  expect(() => toModelMessages(conversation(), { siwcAccountId: "00000000-0000-4000-8000-000000000002" })).toThrow("account_changed");
});
it("通常providerはSIWC provider metadataを使わない", () => {
  expect(JSON.stringify(toModelMessages(conversation()))).not.toContain("encrypted-fixture");
});
it("圧縮境界より前のopaque履歴は返さず、summaryから再開する", () => {
  const value = conversation();
  value.conversationCompactions.push({ id: "summary", createdAt: timestamp, compactedThroughCreatedAt: timestamp, compactedThroughMessageId: "a1", sourceMessageIds: ["u1", "a1"], summary: "Summary" });
  expect(toModelMessages(value, { strategy: "conversation-compaction", siwcAccountId: accountId })).toEqual([{ role: "system", content: "Summary" }, { role: "user", content: "Continue" }]);
});
it("provider metadataの不要な秘密を保持せず、不正なcall/resultを拒否する", () => {
  const parsed = siwcHistorySchema.parse({ accountId, modelId: "model", messages: [{ role: "assistant", content: [{ type: "text", text: "ok", providerOptions: { openai: { itemId: "msg_1", accessToken: "dummy-secret" } } }] }] });
  expect(JSON.stringify(parsed)).not.toContain("dummy-secret");
  expect(siwcHistorySchema.safeParse({ accountId, modelId: "model", messages: [{ role: "tool", content: [{ type: "tool-result", toolName: "Read", output: { type: "json", value: null } }] }] }).success).toBe(false);
});
