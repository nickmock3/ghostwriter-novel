import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDefaultRoleAssignments } from "../src/features/ai-agent/llmProfiles";
import { llmProfilesResponseSchema } from "../src/features/ai-agent/llmProfileStorage";
import { conversationListResponseSchema, conversationSchema } from "../src/features/ai-chat/conversationSchemas";

// Real API and filesystem E2E coverage. Only unrelated LLM inventory/health endpoints are mocked;
// workspace validation, file I/O, conversation history, and proposal actions stay real.

const filePath = "本文.txt";

async function createWorkspace(initialContent: string) {
  const root = await mkdtemp(path.join(tmpdir(), "ghostwriter-persistence-workspace-"));
  await writeFile(path.join(root, filePath), initialContent, "utf8");
  // Match the real API canonical root (macOS tmp paths can contain symlink aliases).
  return realpath(root);
}

async function seedWorkspaceRestore(page: Page, root: string) {
  await page.addInitScript((workspaceRoot) => {
    window.localStorage.setItem("ghostwriter:last-workspace-root", workspaceRoot);
    window.localStorage.setItem(`ghostwriter:start-guide-dismissed:${workspaceRoot}`, "true");
  }, root);
}

async function mockUnrelatedRuntimeInventory(page: Page) {
  await page.route("**/api/llm/providers", (route) =>
    route.fulfill({ contentType: "application/json", json: { providers: [] } }),
  );
  await page.route("**/api/llm/profiles", (route) =>
    route.fulfill({ contentType: "application/json", json: llmProfilesResponseSchema.parse({ profiles: [], roleAssignments: createDefaultRoleAssignments({ providers: [] }) }) }),
  );
  await page.route("**/api/llm/secrets", (route) =>
    route.fulfill({ contentType: "application/json", json: { providers: [] } }),
  );
}

test("opens, edits, saves, and reloads a real workspace file", async ({ page }) => {
  const root = await createWorkspace("before");
  try {
    await seedWorkspaceRestore(page, root);
    await mockUnrelatedRuntimeInventory(page);
    await page.goto("/editor");
    await page.waitForFunction(() => window.__GHOSTWRITER_HYDRATED__ === true);
    await expect(page.getByRole("treeitem", { name: filePath })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "何から始めますか？" })).toHaveCount(0);
    await page.getByRole("treeitem", { name: filePath }).click();

    const editor = page.locator(".cm-content");
    await expect(editor).toContainText("before");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("after");
    await expect(page.getByText("Unsaved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect.poll(() => readFile(path.join(root, filePath), "utf8")).toBe("after");

    const persisted = await page.request.get(`/api/files/content?workspaceRoot=${encodeURIComponent(root)}&path=${encodeURIComponent(filePath)}`);
    expect(persisted.ok()).toBe(true);
    expect((await persisted.json()).content).toBe("after");

    await page.getByRole("link", { name: "チャットモード" }).click();
    await expect(page.getByRole("region", { exact: true, name: "チャットモード" })).toBeVisible();
    await page.getByRole("link", { name: "エディット画面" }).click();
    await page.reload();
    await page.waitForFunction(() => window.__GHOSTWRITER_HYDRATED__ === true);
    await page.getByRole("treeitem", { name: filePath }).click();
    await expect(page.locator(".cm-content")).toContainText("after");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("applies and undoes a seeded proposal through real conversation persistence", async ({ page }) => {
  const oldText = "before proposal";
  const newText = "after proposal";
  const root = await createWorkspace(oldText);
  try {
    const created = await page.request.post("/api/conversations", {
      data: { agentRuntime: "vercel-ai", workspaceRoot: root },
    });
    expect(created.status()).toBe(201);
    const conversation = conversationSchema.parse((await created.json()).conversation);
    const message = await page.request.patch("/api/conversations", {
      data: {
        action: "appendMessage",
        content: "提案を確認してください",
        conversationId: conversation.id,
        role: "assistant",
        workspaceRoot: root,
      },
    });
    expect(message.ok()).toBe(true);
    const proposalResponse = await page.request.patch("/api/conversations", {
      data: {
        action: "appendEditProposal",
        conversationId: conversation.id,
        newText,
        oldText,
        path: filePath,
        workspaceRoot: root,
      },
    });
    expect(proposalResponse.ok()).toBe(true);
    const seededConversation = conversationSchema.parse((await proposalResponse.json()).conversation);
    const proposal = seededConversation.editProposals.at(-1);
    expect(proposal).toBeDefined();
    if (!proposal) throw new Error("Proposal was not seeded");
    expect(proposal.status).toBe("pending");

    await seedWorkspaceRestore(page, root);
    await mockUnrelatedRuntimeInventory(page);
    await page.goto("/chat");
    await page.waitForFunction(() => window.__GHOSTWRITER_HYDRATED__ === true);
    await expect(page.getByText("提案を確認してください")).toBeVisible();
    await page.getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => readFile(path.join(root, filePath), "utf8")).toBe(newText);
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();

    const applied = await page.request.get(`/api/conversations?workspaceRoot=${encodeURIComponent(root)}`);
    expect(applied.ok()).toBe(true);
    expect(conversationListResponseSchema.parse(await applied.json()).activeConversation?.editProposals.find((item) => item.id === proposal.id)?.status).toBe("applied");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => readFile(path.join(root, filePath), "utf8")).toBe(oldText);

    const undone = await page.request.get(`/api/conversations?workspaceRoot=${encodeURIComponent(root)}`);
    expect(undone.ok()).toBe(true);
    expect(conversationListResponseSchema.parse(await undone.json()).activeConversation?.editProposals.find((item) => item.id === proposal.id)?.status).toBe("undone");
    await page.reload();
    await page.waitForFunction(() => window.__GHOSTWRITER_HYDRATED__ === true);
    const reloaded = await page.request.get(`/api/conversations?workspaceRoot=${encodeURIComponent(root)}`);
    expect(reloaded.ok()).toBe(true);
    expect(conversationListResponseSchema.parse(await reloaded.json()).activeConversation?.editProposals.find((item) => item.id === proposal.id)?.status).toBe("undone");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
