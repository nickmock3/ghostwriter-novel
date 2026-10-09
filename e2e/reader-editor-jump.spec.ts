import { expect, test, type Page } from "@playwright/test";

// API-mocked UI integration coverage; real persistence is covered by workspace-persistence.spec.ts.

const workspaceRoot = "/tmp/ghostwriter-reader-jump-e2e";
const manuscriptPath = "小説/第001章/本文.txt";
const manuscript = "第一章　星の港\n前｜漢字《かんじ》後の一意な文。";
const localBaseUrl = process.env.GHOSTWRITER_E2E_BASE_URL;

async function openWorkspace(page: Page) {
  // The nearly empty fixture tree always triggers the start guide; keep it out of the reader flow.
  await page.addInitScript((root) => {
    localStorage.setItem(`ghostwriter:start-guide-dismissed:${root}`, "true");
  }, workspaceRoot);
  await page.route("**/api/workspace/select**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { workspaceRoot },
    });
  });
  await page.route("**/api/files/tree**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        items: [
          { kind: "directory", path: "小説" },
          { kind: "directory", path: "小説/第001章" },
          { kind: "file", path: manuscriptPath },
        ],
        limit: 100,
        truncated: false,
      },
    });
  });
  await page.route("**/api/files/content**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const requestedPath = requestUrl.searchParams.get("path") ?? "";
    await route.fulfill({
      contentType: "application/json",
      json: {
        content: requestedPath === manuscriptPath ? manuscript : "",
        path: requestedPath,
      },
    });
  });

  await page.goto(localBaseUrl ? new URL("/editor", localBaseUrl).href : "/editor");
  await page.waitForFunction(() => window.__GHOSTWRITER_HYDRATED__ === true);
  await page.getByRole("button", { name: "既存のフォルダを開く" }).click();
  await expect(page.locator(".workspace-summary h1")).toHaveAttribute("title", workspaceRoot);
}

test("jumps from a reader DOM selection to the matching CodeMirror source range", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByRole("link", { name: "リーダーモード" }).click();
  await expect(page).toHaveURL(/\/reader$/);
  await expect(page.getByLabel("章本文").getByText("漢字", { exact: true })).toBeVisible();
  await expect(page.getByLabel("章本文").getByText("後の一意な文。", { exact: true })).toBeVisible();

  await page.getByLabel("章本文").evaluate((body) => {
    const mappedSpans = Array.from(
      body.querySelectorAll<HTMLElement>("[data-reader-visible-start]"),
    );
    const startSpan = mappedSpans.find((element) => element.textContent === "前");
    const endSpan = mappedSpans.find((element) => element.textContent?.startsWith("後の一意な文"));
    const startNode = startSpan?.firstChild;
    const endNode = endSpan?.firstChild;
    if (!startNode || !endNode) {
      throw new Error("Reader selection endpoints are missing");
    }

    const range = document.createRange();
    range.setStart(startNode, 0);
    range.setEnd(endNode, 1);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const rect = range.getBoundingClientRect();
    body.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left,
        clientY: rect.bottom,
      }),
    );
  });

  await page.getByRole("menuitem", { name: "エディットモードで開く" }).click();

  await expect(page).toHaveURL(/\/editor$/);
  await expect(page.getByRole("tab", { name: manuscriptPath })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".cm-line").nth(0)).toHaveText("第一章　星の港");
  await expect(page.locator(".cm-line").nth(1)).toHaveText(
    "前｜漢字《かんじ》後の一意な文。",
  );
  await expect(page.locator(".cm-editor")).toHaveClass(/cm-focused/);
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toBe("前｜漢字《かんじ》後");
});
