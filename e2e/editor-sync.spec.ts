import { expect, test } from "@playwright/test";
import { conversationSchema } from "../src/features/ai-chat/conversationSchemas";
import { editProposalSchema } from "../src/features/edit-proposals/editProposalSchemas";

// API-mocked UI integration; server persistence and LLM execution are outside this test.
for (const dirty of [false, true]) {
  test(`chat updates retained editor tabs (unsaved: ${dirty})`, async ({ page }, testInfo) => {
    const workspaceRoot = "/tmp/editor-sync";
    let manuscript = "original manuscript";
    const date = "2026-09-25T00:00:00.000Z";
    let conversation = conversationSchema.parse({
      id: "sync", workspaceId: "sync", title: "同期", createdAt: date,
      updatedAt: date, lastOpenedAt: date, messages: [], editProposals: [],
    });
    await page.addInitScript((root) => {
      localStorage.setItem("ghostwriter:last-workspace-root", root);
      localStorage.setItem(`ghostwriter:start-guide-dismissed:${root}`, "true");
    }, workspaceRoot);
    await page.route("**/api/workspace/validate", (route) => route.fulfill({ json: { workspaceRoot } }));
    await page.route("**/api/files/tree**", (route) => route.fulfill({ json: {
      items: ["manuscript.txt", "notes.txt"].map((path) => ({ kind: "file", path })), limit: 100, truncated: false,
    } }));
    await page.route("**/api/files/content**", (route) => {
      const path = new URL(route.request().url()).searchParams.get("path");
      return route.fulfill({ json: { path, content: path === "manuscript.txt" ? manuscript : "my notes" } });
    });
    await page.route("**/api/conversations**", (route) => {
      if (route.request().method() === "PATCH") {
        manuscript = "original manuscript";
        conversation = { ...conversation, editProposals: conversation.editProposals.map((proposal) => ({ ...proposal, status: "undone" })) };
        return route.fulfill({ json: { conversation } });
      }
      return route.fulfill({ json: { activeConversation: conversation, conversations: [conversation], errors: [] } });
    });
    await page.route("**/api/chat/messages", (route) => {
      manuscript = "updated by chat";
      conversation = { ...conversation, messages: [{ id: "reply", role: "assistant", content: "更新しました", createdAt: date }], editProposals: [editProposalSchema.parse({
        id: "edit", path: "manuscript.txt", title: "原稿更新", oldText: "original manuscript", newText: manuscript,
        diff: "", status: "applied", createdAt: date, updatedAt: date, assistantMessageId: "reply",
        undoSnapshot: { beforeContent: "original manuscript", afterContent: manuscript },
      })] };
      return route.fulfill({ json: { conversation } });
    });
    await page.goto("/editor");
    await page.waitForFunction(() => window.__GHOSTWRITER_HYDRATED__ === true);
    await page.getByRole("treeitem", { name: "manuscript.txt" }).click();
    const editor = page.locator(".cm-content");
    await expect(editor).toHaveText("original manuscript");
    if (dirty) await editor.fill("my unsaved draft");
    await page.getByRole("treeitem", { name: "notes.txt" }).click();
    await expect(editor).toHaveText("my notes");
    await page.getByRole("link", { name: "チャットモード", exact: true }).click();
    await expect(page).toHaveURL(/\/chat$/);
    await page.getByRole("complementary", { name: "AIチャット", exact: true }).getByRole("textbox").fill("原稿を更新して");
    await page.getByRole("button", { name: "送信", exact: true }).click();
    await expect(page.getByText("更新しました", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "エディットモード", exact: true }).click();
    await expect(page.getByRole("tab", { name: "notes.txt", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: /^manuscript.txt/ }).click();
    await expect(editor).toHaveText(dirty ? "my unsaved draft" : "updated by chat");
    if (dirty) {
      await expect(page.getByRole("alert")).toContainText("別の操作で更新");
      await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
      await page.screenshot({ path: testInfo.outputPath("editor-conflict.png") });
      page.once("dialog", (dialog) => dialog.dismiss());
      await page.getByRole("button", { name: "更新内容を読み込む" }).click();
      await expect(editor).toHaveText("my unsaved draft");
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "更新内容を読み込む" }).click();
      await expect(editor).toHaveText("updated by chat");
      await expect(page.getByRole("alert")).toHaveCount(0);
    }
    await page.getByRole("link", { name: "チャットモード", exact: true }).click();
    await expect(page).toHaveURL(/\/chat$/);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.getByRole("link", { name: "エディットモード", exact: true }).click();
    await expect(editor).toHaveText("original manuscript");
  });
}
