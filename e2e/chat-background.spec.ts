import { expect, test } from "@playwright/test";
import type { ToolActivitySummary } from "../src/features/ai-chat/toolActivity";
import { conversationSchema } from "../src/features/ai-chat/conversationSchemas";

declare global {
  interface Window {
    __chatTestStream?: ReadableStreamDefaultController<Uint8Array>;
  }
}

// API-mocked UI integration: verifies route lifetime and notifications, not server persistence.
for (const outcome of ["success", "failure", "return-while-running", "workspace-change"] as const) {
  test(`chat survives navigation: ${outcome}`, async ({ page }, testInfo) => {
    const workspaceRoot = "/tmp/ghostwriter-background-chat";
    const conversation = conversationSchema.parse({
      id: "background-chat", workspaceId: "background-workspace", title: "背景の会話",
      createdAt: "2026-09-25T00:00:00.000Z", updatedAt: "2026-09-25T00:00:00.000Z",
      lastOpenedAt: "2026-09-25T00:00:00.000Z", messages: [], editProposals: [],
    });
    await page.addInitScript((root) => {
      localStorage.setItem("ghostwriter:last-workspace-root", root);
      localStorage.setItem(`ghostwriter:start-guide-dismissed:${root}`, "true");
      localStorage.setItem(`ghostwriter:start-guide-dismissed:${root}-other`, "true");
    }, workspaceRoot);
    await page.route("**/api/workspace/validate", (route) => route.fulfill({ json: { workspaceRoot } }));
    await page.route("**/api/workspace/select", (route) => route.fulfill({ json: { workspaceRoot: `${workspaceRoot}-other` } }));
    await page.route("**/api/files/tree**", (route) => route.fulfill({ json: {
      items: [{ kind: "file", path: "notes.txt" }], limit: 100, truncated: false,
    } }));
    await page.route("**/api/conversations**", (route) => route.fulfill({ json: {
      activeConversation: conversation, conversations: [conversation], errors: [],
    } }));
    let finish!: () => void;
    let requested = false;
    const completion = new Promise<void>((resolve) => { finish = resolve; });
    await page.route("**/api/chat/messages", async (route) => {
      requested = true;
      await completion;
      await route.fulfill(outcome === "failure"
        ? { status: 500, json: { message: "テスト用の応答失敗" } }
        : { json: { conversation: { ...conversation, messages: [{
          id: "answer", role: "assistant", content: "画面移動後の回答です",
          createdAt: "2026-09-25T00:01:00.000Z",
        }] } } });
    });
    await page.goto("/chat");
    await page.waitForFunction(() => window.__GHOSTWRITER_HYDRATED__ === true);
    if (outcome === "return-while-running") {
      // Browser-owned stream lets us deliver deltas separately from completion.
      await page.evaluate(() => {
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
          if (String(args[0]).includes("/api/chat/messages")) {
            return new Response(new ReadableStream<Uint8Array>({
              start(controller) { window.__chatTestStream = controller; },
            }), { headers: { "content-type": "application/x-ndjson" } });
          }
          return originalFetch(...args);
        };
      });
    }
    await page.getByRole("textbox").fill("続きを考えて");
    await page.getByRole("button", { name: "送信", exact: true }).click();
    if (outcome === "return-while-running") {
      await page.waitForFunction(() => Boolean(window.__chatTestStream));
      await page.evaluate(() => window.__chatTestStream?.enqueue(new TextEncoder().encode(
        JSON.stringify({ type: "reasoning-delta", text: "章ごとのつながりを確認しています。" }) + "\n",
      )));
      await expect(page.getByText("章ごとのつながりを確認しています。", { exact: true })).toBeVisible();
      const reasoningToggle = page.getByRole("button", { name: "推論の途中経過" });
      await reasoningToggle.click();
      await expect(reasoningToggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("region", { name: "推論の詳細" })).toHaveText("章ごとのつながりを確認しています。");
      await page.screenshot({ path: testInfo.outputPath("reasoning-progress.png") });
      const activity = {toolCallId: "writing-1", toolName: "DelegateWriting", label: "DelegateWriting 小説/第001章/本文.txt", status: "running", detail: "本文を生成中・1200文字受信"} satisfies ToolActivitySummary;
      await page.evaluate((activity) => window.__chatTestStream?.enqueue(new TextEncoder().encode(
        JSON.stringify({ type: "tool-activity", activity }) + "\n",
      )), activity);
      await expect(page.getByText(/本文を生成中・1200文字受信/)).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("writing-progress.png") });
      await reasoningToggle.click();
      await expect(reasoningToggle).toHaveAttribute("aria-expanded", "false");

      await page.evaluate(() => window.__chatTestStream?.enqueue(new TextEncoder().encode(
        JSON.stringify({ type: "text-delta", text: "途中の応答" }) + "\n",
      )));
      await expect(page.getByText("途中の応答", { exact: true })).toBeVisible();
    } else {
      await expect.poll(() => requested).toBe(true);
    }
    await page.getByRole("link", { name: "設定ページ", exact: true }).click();
    const badge = page.getByRole("status", { name: /チャットの応答/ });
    await expect(badge).toHaveCount(0);
    if (outcome === "workspace-change") {
      await page.getByRole("link", { name: "エディット画面", exact: true }).click();
      await page.getByRole("button", { name: "ワークスペースを開く", exact: true }).click();
      await expect.poll(() => page.evaluate(() => localStorage.getItem("ghostwriter:last-workspace-root"))).toBe(`${workspaceRoot}-other`);
      const response = page.waitForResponse("**/api/chat/messages");
      finish();
      await response;
      await page.getByRole("link", { name: "チャットモード", exact: true }).click();
      await page.getByRole("textbox").fill("別の作品の質問");
      await expect(page.getByText("画面移動後の回答です", { exact: true })).toHaveCount(0);
      await page.getByRole("link", { name: "設定ページ", exact: true }).click();
      await expect(badge).toHaveCount(0);
      return;
    }
    if (outcome === "return-while-running") {
      await page.evaluate(() => window.__chatTestStream?.enqueue(new TextEncoder().encode(
        JSON.stringify({ type: "text-delta", text: "も続きます" }) + "\n",
      )));
      await page.getByRole("link", { name: "チャットモード", exact: true }).click();
      await expect(page.getByText("途中の応答も続きます", { exact: true })).toBeVisible();
      await expect(page.getByText("章ごとのつながりを確認しています。", { exact: true })).toBeVisible();
      await expect(page.getByText(/本文を生成中・1200文字受信/)).toBeVisible();
      await page.getByRole("textbox").fill("次の質問");
      await expect(page.getByRole("button", { name: "送信", exact: true })).toBeDisabled();
      await page.evaluate((conversation) => {
        window.__chatTestStream?.enqueue(new TextEncoder().encode(JSON.stringify({
          type: "conversation", conversation: { ...conversation, messages: [{
            id: "answer", role: "assistant", content: "画面移動後の回答です",
            createdAt: "2026-09-25T00:01:00.000Z",
          }] },
        }) + "\n"));
        window.__chatTestStream?.close();
      }, conversation);
    }
    finish();
    if (outcome !== "return-while-running") {
      await expect(badge).toHaveAttribute("aria-label", outcome === "failure"
        ? "チャットの応答に失敗しました" : "チャットの応答が完了しました");
      await expect(badge).toBeVisible();
      await page.getByRole("navigation", { name: "画面切り替え" }).screenshot({ path: testInfo.outputPath("notification.png") });
      await page.getByRole("link", { name: "チャットモード", exact: true }).click();
    }
    await expect(page.getByText(outcome === "failure" ? "テスト用の応答失敗" : "画面移動後の回答です", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "推論の途中経過" })).toHaveCount(0);
    await expect(page.getByText(/本文を生成中・1200文字受信/)).toHaveCount(0);
    await expect(badge).toHaveCount(0);
    await page.getByRole("link", { name: "設定ページ", exact: true }).click();
    await expect(badge).toHaveCount(0);
  });
}
