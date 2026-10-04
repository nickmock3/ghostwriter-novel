import { expect, test } from "@playwright/test";
// API-mocked UI integration only. OAuth, token storage and live inference are not exercised.
test("SIWC設定でサインイン・アカウント状態・モデル更新・サインアウトを扱う", async ({ page }, testInfo) => {
  const workspaceRoot = "/tmp/ghostwriter-siwc-ui";
  let signedIn = false;
  let registered = false;
  const accountId = "00000000-0000-4000-8000-000000000001";
  const loginBodies: unknown[] = [];
  let providerReads = 0;
  await page.addInitScript(root => {
    localStorage.setItem("ghostwriter:last-workspace-root", root);
    localStorage.setItem(`ghostwriter:start-guide-dismissed:${root}`, "true");
  }, workspaceRoot);
  await page.route("**/api/workspace/validate", route => route.fulfill({ json: { workspaceRoot } }));
  await page.route("**/api/files/tree**", route => route.fulfill({ json: { items: [], limit: 100, truncated: false } }));
  await page.route("**/api/conversations**", route => route.fulfill({ json: { activeConversation: null, conversations: [], errors: [] } }));
  await page.route("**/api/llm/providers", route => {
    providerReads++;
    return route.fulfill({ json: { providers: [{ id: "openai-chatgpt", displayName: "ChatGPT プラン", models: signedIn ? [{ id: "test-model", displayName: "Test model", available: true, supportsTools: true }] : [] }] } });
  });
  await page.route("**/api/siwc/status", route => route.fulfill({ json: { ok: true, value: { busy: false, accounts: registered ? [{ id: accountId, active: true, status: signedIn ? "signed-in" : "signed-out", directPermission: signedIn, expiresAt: signedIn ? 2000000000000 : null }] : [] } } }));
  await page.route("**/api/siwc/login", route => { loginBodies.push(route.request().postDataJSON()); signedIn = true; registered = true; return route.fulfill({ json: { ok: true, value: accountId } }); });
  await page.route("**/api/siwc/logout", route => { signedIn = false; return route.fulfill({ json: { ok: true, value: { remoteRevocationConfirmed: true } } }); });
  await page.goto("/settings");
  await page.waitForFunction(() => window.__GHOSTWRITER_HYDRATED__ === true);
  const section = page.getByRole("region", { name: "ChatGPTプラン接続" });
  await expect(section.getByText("サインインしていません。")).toBeVisible();
  const reads = providerReads;
  await section.getByRole("button", { name: "ChatGPTでログイン" }).click();
  await expect(section.getByText("サインイン済み", { exact: true })).toBeVisible();
  await expect.poll(() => providerReads).toBeGreaterThan(reads);
  await page.screenshot({ path: testInfo.outputPath("siwc-settings.png"), fullPage: true });
  await expect(section.getByRole("button", { name: "ChatGPTでログイン" })).toHaveCount(0);
  await expect(section.getByRole("button", { name: "別のアカウントを追加" })).toHaveCount(0);
  await section.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(section.getByText("サインアウト済み", { exact: true })).toBeVisible();
  await section.getByRole("button", { name: "ChatGPTでログイン" }).click();
  await expect(section.getByText("サインイン済み", { exact: true })).toBeVisible();
  expect(loginBodies).toEqual([{}, { accountId }]);
  await expect(section.getByRole("combobox", { name: "ChatGPTアカウント" })).toHaveCount(0);
  await expect(section.getByRole("button", { name: "別のアカウントを追加" })).toHaveCount(0);
});
