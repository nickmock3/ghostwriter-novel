import { expect, test } from "@playwright/test";

test("aligns empty chat guidance inside its message column", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  // API-mocked UI E2E: workspace and conversation APIs are replaced; browser layout is real.
  const workspaceRoot = "/tmp/ghostwriter-chat-guidance-layout";
  await page.route("**/api/workspace/select**", async (route) => {
    await route.fulfill({ contentType: "application/json", json: { workspaceRoot } });
  });
  await page.route("**/api/files/tree**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { items: [], limit: 100, truncated: false },
    });
  });
  await page.route("**/api/conversations**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { activeConversation: null, conversations: [], errors: [] },
    });
  });

  await page.goto("/chat");
  await page.waitForFunction(() => window.__GHOSTWRITER_HYDRATED__ === true);
  await page
    .getByLabel("ワークスペース操作")
    .getByRole("button", { name: "ワークスペースを開く" })
    .click();

  const guidanceText = page.getByText("小説づくりをチャットで進めましょう。", { exact: true });
  await expect(guidanceText).toBeVisible();
  const layout = await guidanceText.evaluate((element) => {
    const message = element.closest("article");
    const scrollArea = element.closest(".chat-scroll-area");
    if (!(message instanceof HTMLElement) || !(scrollArea instanceof HTMLElement)) {
      throw new Error("Missing empty chat guidance layout elements");
    }
    const messageRect = message.getBoundingClientRect();
    const scrollRect = scrollArea.getBoundingClientRect();
    return {
      centerOffset: Math.abs(messageRect.left + messageRect.width / 2 - (scrollRect.left + scrollRect.width / 2)),
      textAlign: getComputedStyle(message).textAlign,
      width: messageRect.width,
    };
  });

  expect(layout.textAlign).toBe("left");
  expect(layout.width).toBeLessThanOrEqual(560);
  expect(layout.centerOffset).toBeLessThanOrEqual(1);
});
