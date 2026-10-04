// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createConversation, getConversation } from "./conversationHistory";
import { createAgentChatApplicationService } from "./agentChatApplicationService";
import { createConversationApiHandler } from "./conversationApi";
import { createProductionApiRouter } from "../../shared/server/apiRouter";

it("旧Codex会話を読めるが送信で履歴を変更・別AIを実行しない", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "retired-codex-data-"));
  const workspaceRoot = await mkdtemp(join(tmpdir(), "retired-codex-work-"));
  try {
    const conversation = await createConversation({ dataRoot, workspaceRoot, agentRuntime: "codex-app-server" });
    const runAgentLoop = vi.fn(async function* () {});
    const service = createAgentChatApplicationService({ dataRoot, runAgentLoop });
    await expect(service.runAgentChat({ workspaceRoot, conversationId: conversation.id, content: "test", autoCompactEnabled: false, autoCompactThresholdRatio: 0.7 })).rejects.toThrow("廃止");
    expect(runAgentLoop).not.toHaveBeenCalled();
    expect(await getConversation({ dataRoot, workspaceRoot, conversationId: conversation.id })).toEqual(conversation);
    const handler = createConversationApiHandler({ dataRoot });
    const result = await handler(new Request("http://localhost/api/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceRoot, agentRuntime: "codex-app-server" }) }));
    expect(result.status).toBe(400);
    const compact = await handler(new Request("http://localhost/api/conversations", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "compactConversation", workspaceRoot, conversationId: conversation.id }) }));
    expect(compact.status).toBe(400);
    expect(await compact.json()).toEqual({ message: expect.stringContaining("廃止") });
    expect(await getConversation({ dataRoot, workspaceRoot, conversationId: conversation.id })).toEqual(conversation);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

it("旧Codex APIを提供しない", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "retired-codex-api-"));
  try {
    const router = createProductionApiRouter({ dataRoot, env: {} });
    for (const path of ["/api/codex/cli/health", "/api/codex/account", "/api/codex/models"]) {
      expect((await router(new Request(`http://localhost${path}`))).status).toBe(404);
    }
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});
