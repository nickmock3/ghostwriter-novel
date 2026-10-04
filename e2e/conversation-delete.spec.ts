import { expect, test } from "@playwright/test";

// API-mocked UI integration coverage; real persistence is covered by workspace-persistence.spec.ts.

test("deletes the active conversation and selects the latest remaining conversation", async ({
  page,
}) => {
  const workspaceRoot = "/tmp/ghostwriter-conversation-delete-e2e";
  const activeConversation = {
    agentRuntime: "vercel-ai",
    codexTurnState: { phase: "idle" },
    conversationCompactions: [],
    createdAt: "2026-07-23T02:00:00.000Z",
    editProposals: [],
    id: "conversation-active",
    lastOpenedAt: "2026-07-23T02:00:00.000Z",
    messages: [
      {
        content: "削除対象の会話本文",
        createdAt: "2026-07-23T02:01:00.000Z",
        id: "message-active",
        role: "user",
      },
    ],
    plans: [],
    title: "削除する会話",
    toolActivities: [],
    toolResultSummaries: [],
    updatedAt: "2026-07-23T02:01:00.000Z",
    workspaceId: "workspace-delete-e2e",
  };
  const remainingConversation = {
    ...activeConversation,
    createdAt: "2026-07-23T01:00:00.000Z",
    id: "conversation-remaining",
    lastOpenedAt: "2026-07-23T01:00:00.000Z",
    messages: [
      {
        content: "残存する最新会話の本文",
        createdAt: "2026-07-23T01:01:00.000Z",
        id: "message-remaining",
        role: "assistant",
      },
    ],
    title: "残存する最新会話",
    updatedAt: "2026-07-23T01:01:00.000Z",
  };
  let deleteRequestBody: unknown = null;

  await page.addInitScript((root) => {
    window.localStorage.setItem("ghostwriter:last-workspace-root", root);
    window.localStorage.setItem(`ghostwriter:start-guide-dismissed:${root}`, "true");
  }, workspaceRoot);
  await page.route("**/api/workspace/validate", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { workspaceRoot },
    });
  });
  await page.route("**/api/files/tree**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { items: [], limit: 100, truncated: false },
    });
  });
  await page.route("**/api/conversations**", async (route) => {
    if (route.request().method() === "PATCH") {
      deleteRequestBody = route.request().postDataJSON();
      await route.fulfill({
        contentType: "application/json",
        json: { conversationId: activeConversation.id },
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      json: {
        activeConversation,
        conversations: [activeConversation, remainingConversation],
        errors: [],
      },
    });
  });

  await page.goto("/chat");
  await page.waitForFunction(() => window.__GHOSTWRITER_HYDRATED__ === true);
  await expect(page.getByText("削除対象の会話本文")).toBeVisible();

  await page.getByRole("button", { name: "会話履歴を開く" }).click();
  const historyDialog = page.getByRole("dialog", { name: "会話履歴" });
  await expect(historyDialog).toBeVisible();

  const dialogPromise = page.waitForEvent("dialog");
  const deleteClickPromise = historyDialog
    .getByRole("button", { name: "削除する会話 を削除" })
    .click();
  const confirmDialog = await dialogPromise;
  expect(confirmDialog.message()).toContain(activeConversation.title);
  await confirmDialog.accept();
  await deleteClickPromise;

  await expect
    .poll(() => deleteRequestBody)
    .toEqual({
      action: "deleteConversation",
      conversationId: activeConversation.id,
      workspaceRoot,
    });
  const remainingRow = historyDialog
    .getByRole("button", { name: remainingConversation.title })
    .locator("..");
  await expect(remainingRow).toHaveAttribute("aria-current", "true");
  await historyDialog.getByRole("button", { name: "会話履歴を閉じる" }).click();
  await expect(page.getByText("残存する最新会話の本文")).toBeVisible();
  await expect(page.getByText("削除対象の会話本文")).toHaveCount(0);
});
