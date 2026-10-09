import { expect, test, type Page } from "@playwright/test";

// API-mocked UI integration coverage; real persistence is covered by workspace-persistence.spec.ts.

async function gotoEditor(page: Page) {
  await page.goto("/editor");
  await expect(page.getByRole("region", { name: "エディターワークスペース" })).toBeVisible();
  await page.waitForFunction(() => window.__GHOSTWRITER_HYDRATED__ === true);
}

async function dismissStartGuideIfVisible(page: Page) {
  const startGuide = page.getByRole("dialog", { name: "何から始めますか？" });
  try {
    await expect(startGuide).toBeVisible({ timeout: 3000 });
  } catch {
    return;
  }
  await page.getByRole("button", { name: "開始ガイドを閉じる" }).click();
  await expect(startGuide).toHaveCount(0);
}

async function openExistingWorkspaceFromFirstRunModal(
  page: Page,
  workspaceRoot = "/tmp/ghostwriter-e2e-workspace",
) {
  await page.route("**/api/workspace/select**", async (route) => {
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
    await route.fulfill({
      contentType: "application/json",
      json: { activeConversation: null, conversations: [], errors: [] },
    });
  });

  await page.getByRole("button", { name: "既存のフォルダを開く" }).click();
  await expect(page.locator(".workspace-summary h1")).toHaveAttribute("title", workspaceRoot);
  await dismissStartGuideIfVisible(page);
}

async function openChatWorkspaceWithMessages(
  page: Page,
  messages: readonly Record<string, unknown>[],
) {
  const workspaceRoot = "/tmp/ghostwriter-chat-layout-e2e";
  const now = "2026-07-14T00:00:00.000Z";
  const conversation = {
    createdAt: now,
    editProposals: [],
    id: "conversation-chat-layout",
    lastOpenedAt: now,
    messages,
    title: "Chat layout",
    updatedAt: now,
    workspaceId: "workspace-chat-layout",
  };
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
      json: { activeConversation: conversation, conversations: [conversation], errors: [] },
    });
  });
  await page.goto("/editor");
  await page.waitForFunction(() => window.__GHOSTWRITER_HYDRATED__ === true);
  await page.getByRole("button", { name: "既存のフォルダを開く" }).click();
  await dismissStartGuideIfVisible(page);
  await page.getByRole("link", { name: "チャットモード" }).click();
  await expect(page.getByRole("region", { exact: true, name: "チャットモード" })).toBeVisible();
}

test("opens the app shell", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/chat$/);
  await expect(page).toHaveTitle("Ghostwriter");
  await expect(page.getByRole("main", { name: "Ghostwriter" })).toBeVisible();
  await expect(
    page
      .getByLabel("ワークスペース操作")
      .getByRole("button", { name: "ワークスペースを開く" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { exact: true, name: "チャットモード" })).toBeVisible();
  await expect(page.getByRole("region", { name: "チャットモードを始める" })).toBeVisible();
});

test("replaces the editor chat pane with AI assists and follows the CodeMirror selection", async ({
  page,
}) => {
  const workspaceRoot = "/tmp/ghostwriter-ai-assist-e2e";
  const manuscript = "星の港に朝が来た。";

  await page.route("**/api/workspace/select**", async (route) => {
    await route.fulfill({ contentType: "application/json", json: { workspaceRoot } });
  });
  await page.route("**/api/files/tree**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        items: [
          { kind: "directory", path: "小説" },
          { kind: "directory", path: "小説/第001章" },
          { kind: "file", path: "小説/第001章/本文.txt" },
        ],
        limit: 100,
        truncated: false,
      },
    });
  });
  await page.route("**/api/files/content**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      contentType: "application/json",
      json: { content: manuscript, path: url.searchParams.get("path") },
    });
  });
  await page.route("**/api/llm/providers", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        providers: [
          {
            displayName: "OpenAI",
            id: "openai",
            models: [
              {
                available: true,
                displayName: "GPT 5.5",
                id: "gpt-5.5",
                supportsTools: true,
              },
            ],
          },
        ],
      },
    });
  });
  await page.route("**/api/llm/profiles", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        profiles: [
          {
            available: true,
            id: "builtin:openai:writing",
            llmProfileRole: "writing",
            maxOutputTokens: 65536,
            modelId: "gpt-5.5",
            name: "OpenAI 執筆",
            providerId: "openai",
            source: "built-in",
            temperature: 0.7,
          },
        ],
        roleAssignments: {
          main: { kind: "model", providerId: "openai", modelId: "gpt-5.5" },
          search: { kind: "model", providerId: "openai", modelId: "gpt-5.5" },
          simple: { kind: "model", providerId: "openai", modelId: "gpt-5.5" },
          writing: { kind: "model", providerId: "openai", modelId: "gpt-5.5" },
        },
      },
    });
  });
  await page.route("**/api/llm/secrets", async (route) => {
    await route.fulfill({ contentType: "application/json", json: { providers: [] } });
  });
  await gotoEditor(page);
  await page.getByRole("button", { name: "既存のフォルダを開く" }).click();
  await dismissStartGuideIfVisible(page);

  const assistPane = page.getByRole("complementary", { name: "AIアシスト" });
  await expect(assistPane).toBeVisible();
  await expect(page.getByRole("complementary", { name: "AIチャット" })).toHaveCount(0);
  await expect(assistPane.getByRole("combobox", { name: "実行方式" })).toHaveValue("standard");
  const polishAssist = assistPane.getByRole("button", { name: "推敲を実行", exact: true });
  await expect(polishAssist).toBeVisible();
  const headingSpacing = await assistPane.locator(".ai-assist-heading").evaluate((heading) => ({
    alignItems: getComputedStyle(heading).alignItems,
    marginTop: Number.parseFloat(getComputedStyle(heading).marginTop),
  }));
  expect(headingSpacing.alignItems).toBe("center");
  expect(headingSpacing.marginTop).toBeGreaterThanOrEqual(4);
  await expect(assistPane.getByRole("button", { name: "校正を実行", exact: true })).toBeVisible();
  await expect(
    assistPane.getByRole("button", { name: "ルビ候補を実行", exact: true }),
  ).toBeVisible();
  await expect(assistPane.getByRole("group", { name: "AIアシスト設定" })).toBeVisible();
  await expect(assistPane.locator(".ai-assist-execute-button")).toHaveCount(0);
  const compactLayout = await assistPane.evaluate((pane) => {
    const card = pane.querySelector<HTMLElement>(".ai-assist-item");
    const composer = pane.querySelector<HTMLElement>(".ai-assist-composer");
    const model = pane.querySelector<HTMLElement>(".ai-assist-composer-runtime");
    if (!card || !composer || !model) {
      throw new Error("AI assist compact layout controls are missing");
    }
    return {
      cardAlignItems: getComputedStyle(card).alignItems,
      composerWidth: composer.getBoundingClientRect().width,
      modelHeight: model.getBoundingClientRect().height,
      modelWidth: model.getBoundingClientRect().width,
    };
  });
  expect(compactLayout.cardAlignItems).toBe("center");
  expect(compactLayout.modelHeight).toBeLessThanOrEqual(30);
  expect(compactLayout.modelWidth).toBeLessThan(compactLayout.composerWidth * 0.9);
  await polishAssist.hover();
  await expect(
    assistPane.getByRole("tooltip", { name: "文章表現を改善する編集案を作成します。" }),
  ).toBeVisible();

  await page.getByRole("treeitem", { name: "本文.txt" }).click();
  await expect(page.locator(".cm-content")).toContainText(manuscript);
  await expect(assistPane.getByText("ファイル全体", { exact: true })).toBeVisible();
  await expect(assistPane.locator(".ai-assist-target-meta svg")).toHaveCount(0);

  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Home");
  await page.keyboard.down("Shift");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");

  await expect(assistPane.getByText("選択範囲（3文字）")).toBeVisible();
  await expect(assistPane.getByRole("button", { name: "推敲を実行" })).toBeEnabled();
});

test("routes between editor and settings as full pages", async ({ page }) => {
  await page.goto("/editor");

  await expect(page.getByRole("link", { name: "エディット画面" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("region", { name: "エディターワークスペース" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "小説ワークスペースを準備する" })).toBeVisible();

  await openExistingWorkspaceFromFirstRunModal(page);

  await page.getByRole("link", { name: "設定ページ" }).click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("link", { name: "設定ページ" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("region", { name: "設定" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "ファイルツリー" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "テキストエディター" })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "AIチャット" })).toHaveCount(0);

  await page.getByRole("link", { name: "エディット画面" }).click();

  await expect(page).toHaveURL(/\/editor$/);
  await expect(page.getByRole("link", { name: "エディット画面" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("region", { name: "エディターワークスペース" })).toBeVisible();
});

test("never shows the first-run modal or unselected header while restoring the last workspace", async ({
  page,
}) => {
  const workspaceRoot = "/tmp/ghostwriter-restore-e2e";
  await page.addInitScript((root) => {
    window.localStorage.setItem("ghostwriter:last-workspace-root", root);
    window.localStorage.setItem(`ghostwriter:start-guide-dismissed:${root}`, "true");
    // Record parser-inserted SPA shell nodes too, so a one-frame flash is still detected.
    new MutationObserver(() => {
      const text = document.body?.textContent ?? "";
      if (text.includes("小説ワークスペースを準備する")) {
        document.documentElement.dataset.sawFirstRunModal = "true";
      }
      if (document.querySelector(".workspace-status")?.textContent === "未選択") {
        document.documentElement.dataset.sawUnselected = "true";
      }
    }).observe(document, { childList: true, characterData: true, subtree: true });
  }, workspaceRoot);
  let releaseValidation!: () => void;
  const validationReleased = new Promise<void>((resolve) => {
    releaseValidation = resolve;
  });
  await page.route("**/api/workspace/validate", async (route) => {
    await validationReleased;
    await route.fulfill({ contentType: "application/json", json: { workspaceRoot } });
  });
  await page.route("**/api/files/tree**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { items: [], limit: 100, truncated: false },
    });
  });

  await page.goto("/editor");

  await expect(page.locator(".workspace-bar").getByRole("status")).toHaveText(
    "前回のワークスペースを開いています…",
  );
  await expect(page.locator(".app-view-stack").getByRole("status")).toHaveText(
    "前回のワークスペースを開いています…",
  );
  releaseValidation();
  await expect(page.locator(".workspace-summary h1")).toHaveAttribute("title", workspaceRoot);
  await expect(page.getByRole("complementary", { name: "ファイルツリー" })).toBeVisible();
  await expect(page.getByText("前回のワークスペースを開いています…")).toHaveCount(0);
  expect(await page.evaluate(() => ({ ...document.documentElement.dataset }))).toEqual({});
});

test("keeps the templates page list compact and avoids duplicate validation text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/workspace/templates**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        templates: [
          {
            id: "template-layout-check",
            items: [
              { content: "hello", kind: "file", path: "AGENTS.md" },
              { kind: "directory", path: "notes" },
              { kind: "directory", path: ".invalid" },
              { kind: "directory", path: "tasks/open" },
              { kind: "directory", path: "tasks/done" },
            ],
            name: "Layout check",
            source: "user",
          },
        ],
      },
    });
  });

  await page.goto("/templates");
  await page.waitForFunction(() => window.__GHOSTWRITER_HYDRATED__ === true);
  await expect(page.getByRole("region", { name: "テンプレート管理" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Layout check" })).toBeVisible();

  const layoutMetrics = await page.evaluate(() => {
    const listPanel = document.querySelector(".templates-list-panel");
    const listButton = document.querySelector(".template-list-button");
    const entries = document.querySelector(".templates-entries");
    const thirdItem = document.querySelectorAll(".template-item")[2];

    if (
      !(listPanel instanceof HTMLElement) ||
      !(listButton instanceof HTMLElement) ||
      !(entries instanceof HTMLElement) ||
      !(thirdItem instanceof HTMLElement)
    ) {
      throw new Error("Missing templates page element");
    }

    return {
      entriesLeft: entries.getBoundingClientRect().left,
      listButtonHeight: listButton.getBoundingClientRect().height,
      listPanelHeight: listPanel.getBoundingClientRect().height,
      thirdItemLeft: thirdItem.getBoundingClientRect().left,
    };
  });

  expect(layoutMetrics.listButtonHeight).toBeLessThan(96);
  expect(layoutMetrics.listPanelHeight).toBeGreaterThan(layoutMetrics.listButtonHeight * 3);
  expect(layoutMetrics.thirdItemLeft).toBeGreaterThanOrEqual(layoutMetrics.entriesLeft);
  await expect(page.locator(".templates-validation-summary")).toHaveCount(0);
});

test("uses a light IDE chrome with a light writing surface", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoEditor(page);

  const visualShell = await page.evaluate(() => {
    const styleOf = (selector: string) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing element: ${selector}`);
      }
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        borderRadius: style.borderRadius,
        color: style.color,
        height: rect.height,
        width: rect.width,
      };
    };

    return {
      chatPane: styleOf(".chat-pane"),
      editorSurface: styleOf(".editor-surface"),
      fileTreePane: styleOf(".file-tree-pane"),
      layout: styleOf(".three-pane-layout"),
      topBar: styleOf(".workspace-bar"),
      viewportHeight: window.innerHeight,
    };
  });

  expect(visualShell.layout.height).toBeGreaterThanOrEqual(visualShell.viewportHeight * 0.75);
  expect(visualShell.layout.height).toBeGreaterThan(visualShell.topBar.height);
  expect(visualShell.layout.backgroundColor).toBe("rgb(226, 231, 238)");
  expect(visualShell.fileTreePane.backgroundColor).toBe("rgb(250, 251, 253)");
  expect(visualShell.editorSurface.backgroundColor).toBe("rgb(255, 253, 248)");
  expect(visualShell.editorSurface.borderRadius).toBe("6px");
  expect(visualShell.chatPane.backgroundColor).toBe("rgb(255, 255, 255)");
  expect(visualShell.chatPane.width).toBeGreaterThan(340);
});

test("keeps editor file tabs compact while preserving tab actions", async ({ page }) => {
  const workspaceRoot = "/tmp/ghostwriter-tab-fixture";
  const longPath = "src/features/editor/very-long-file-name-for-tab-density-check.ts";

  await page.setViewportSize({ width: 1280, height: 720 });
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
          { kind: "file", path: "src/app.ts" },
          { kind: "file", path: longPath },
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
        content: requestedPath === longPath ? "export const value = 1;" : "console.log('app');",
        path: requestedPath,
      },
    });
  });

  await gotoEditor(page);
  await page.getByRole("button", { name: "既存のフォルダを開く" }).click();
  await dismissStartGuideIfVisible(page);
  await page.getByRole("treeitem", { name: "app.ts" }).click();
  await expect(page.getByRole("tab", { name: "src/app.ts" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("treeitem", { name: "very-long-file-name-for-tab-density-check.ts" }).click();

  const tabMetrics = await page.locator(".editor-tab-item").first().evaluate((element) => {
    const tab = element.querySelector(".editor-tab");
    const label = element.querySelector(".editor-tab strong");
    const closeButton = element.querySelector(".editor-tab-close-button");
    const tabList = document.querySelector(".editor-tabs");

    if (
      !(tab instanceof HTMLElement) ||
      !(label instanceof HTMLElement) ||
      !(closeButton instanceof HTMLElement) ||
      !(tabList instanceof HTMLElement)
    ) {
      throw new Error("Missing tab element");
    }

    const tabStyle = getComputedStyle(tab);
    const labelStyle = getComputedStyle(label);

    return {
      closeButtonHeight: closeButton.getBoundingClientRect().height,
      closeButtonWidth: closeButton.getBoundingClientRect().width,
      closeButtonInsideTab: tab.contains(closeButton),
      closeButtonRightWithinTab:
        closeButton.getBoundingClientRect().right <= tab.getBoundingClientRect().right,
      labelOverflow: labelStyle.overflow,
      labelTextOverflow: labelStyle.textOverflow,
      maxWidth: tab.getBoundingClientRect().width,
      paddingLeft: Number.parseFloat(tabStyle.paddingLeft),
      tabHeight: tab.getBoundingClientRect().height,
      tabListHeight: tabList.getBoundingClientRect().height,
      tabMinWidth: Number.parseFloat(tabStyle.minWidth),
    };
  });

  expect(tabMetrics.tabListHeight).toBeLessThanOrEqual(40);
  expect(tabMetrics.tabHeight).toBeLessThanOrEqual(32);
  expect(tabMetrics.paddingLeft).toBeLessThanOrEqual(10);
  expect(tabMetrics.tabMinWidth).toBeLessThanOrEqual(132);
  expect(tabMetrics.maxWidth).toBeLessThanOrEqual(220);
  expect(tabMetrics.closeButtonWidth).toBeLessThanOrEqual(20);
  expect(tabMetrics.closeButtonHeight).toBeLessThanOrEqual(20);
  expect(tabMetrics.closeButtonInsideTab).toBe(true);
  expect(tabMetrics.closeButtonRightWithinTab).toBe(true);
  expect(tabMetrics.labelOverflow).toBe("hidden");
  expect(tabMetrics.labelTextOverflow).toBe("ellipsis");

  await page.getByRole("button", { name: "src/app.ts を閉じる" }).click();
  await expect(page.getByRole("tab", { name: "src/app.ts" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: longPath })).toHaveAttribute("aria-selected", "true");
});

test("uses a narrower file tree by default and keeps the editor wider", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoEditor(page);

  const paneMetrics = await page.evaluate(() => {
    const readWidth = (selector: string) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing element: ${selector}`);
      }

      return Math.round(element.getBoundingClientRect().width);
    };

    return {
      chat: readWidth(".chat-pane"),
      editor: readWidth(".editor-pane"),
      fileTree: readWidth(".file-tree-pane"),
    };
  });

  expect(paneMetrics.fileTree).toBeGreaterThanOrEqual(250);
  expect(paneMetrics.fileTree).toBeLessThanOrEqual(290);
  expect(paneMetrics.editor).toBeGreaterThan(paneMetrics.fileTree * 2.1);
  expect(paneMetrics.chat).toBeGreaterThanOrEqual(320);
});

test("removes duplicate chat model chrome and assistant message border", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openChatWorkspaceWithMessages(page, [
    {
      content: "レイアウト確認用の回答",
      createdAt: "2026-07-14T00:00:01.000Z",
      id: "assistant-layout",
      role: "assistant",
    },
  ]);

  await expect(page.getByLabel("チャットLLMモデル")).toBeVisible();
  await expect(page.getByText("チャットLLMモデル")).toHaveCount(0);
  await expect(page.locator(".chat-disclaimer")).toHaveCount(0);

  const assistantChrome = await page.locator(".assistant-message").first().evaluate((element) => {
    const style = getComputedStyle(element);

    return {
      borderStyle: style.borderStyle,
      borderWidth: style.borderWidth,
      paddingLeft: style.paddingLeft,
    };
  });

  expect(assistantChrome.borderStyle).toBe("none");
  expect(assistantChrome.borderWidth).toBe("0px");
  expect(Number.parseFloat(assistantChrome.paddingLeft)).toBeGreaterThan(0);
});

test("keeps chat composer controls on one row at the default pane width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openChatWorkspaceWithMessages(page, [
    {
      content: "使用量表示用の回答",
      createdAt: "2026-07-14T00:00:01.000Z",
      id: "assistant-usage",
      mainContextSnapshot: {
        contextWindowTokens: 1000,
        inputTokens: 100,
        llmProfileRole: "main",
        modelId: "deepseek-v4-pro",
        providerId: "deepseek",
      },
      role: "assistant",
    },
  ]);

  const footerLayout = await page.evaluate(() => {
    const footer = document.querySelector(".chat-form-footer");
    const selector = document.querySelector(".chat-model-selector");
    const tokenMeter = document.querySelector(".chat-token-usage");
    const sendButton = document.querySelector(".send-action");

    if (
      !(footer instanceof HTMLElement) ||
      !(selector instanceof HTMLElement) ||
      !(tokenMeter instanceof HTMLElement) ||
      !(sendButton instanceof HTMLElement)
    ) {
      throw new Error("Missing chat composer footer element");
    }

    const footerRect = footer.getBoundingClientRect();
    const selectorRect = selector.getBoundingClientRect();
    const tokenRect = tokenMeter.getBoundingClientRect();
    const sendRect = sendButton.getBoundingClientRect();
    const tallestControlHeight = Math.max(selectorRect.height, tokenRect.height, sendRect.height);

    return {
      controlsShareRow:
        Math.abs(selectorRect.bottom - tokenRect.bottom) <= 1 &&
        Math.abs(selectorRect.bottom - sendRect.bottom) <= 1 &&
        footerRect.height <= tallestControlHeight + 1,
      meterNarrowerThanSend: tokenRect.width < sendRect.width,
      selectorInsideFooter:
        selectorRect.left >= footerRect.left &&
        selectorRect.right <= footerRect.right,
      selectorWidth: Math.round(selectorRect.width),
    };
  });

  expect(footerLayout.controlsShareRow).toBe(true);
  expect(footerLayout.meterNarrowerThanSend).toBe(true);
  expect(footerLayout.selectorInsideFooter).toBe(true);
  expect(footerLayout.selectorWidth).toBeLessThanOrEqual(180);
});

test("keeps header actions readable at a narrow width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await gotoEditor(page);

  const headerLayout = await page.evaluate(() => {
    const header = document.querySelector(".workspace-bar");
    const summary = document.querySelector(".workspace-summary");
    const actions = document.querySelector(".workspace-actions");
    const newButton = document.querySelector(".workspace-new-action");
    const openButton = document.querySelector(".workspace-open-action");

    if (
      !(header instanceof HTMLElement) ||
      !(summary instanceof HTMLElement) ||
      !(actions instanceof HTMLElement) ||
      !(newButton instanceof HTMLElement) ||
      !(openButton instanceof HTMLElement)
    ) {
      throw new Error("Missing header element");
    }

    const summaryRect = summary.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const newButtonRect = newButton.getBoundingClientRect();
    const openButtonRect = openButton.getBoundingClientRect();

    return {
      actionsInsideHeader:
        actionsRect.right <= header.getBoundingClientRect().right &&
        actionsRect.left >= header.getBoundingClientRect().left,
      buttonsDoNotOverlap:
        newButtonRect.right <= openButtonRect.left ||
        newButtonRect.bottom <= openButtonRect.top ||
        openButtonRect.right <= newButtonRect.left ||
        openButtonRect.bottom <= newButtonRect.top,
      summaryActionsDoNotOverlap:
        summaryRect.right <= actionsRect.left ||
        summaryRect.bottom <= actionsRect.top ||
        actionsRect.right <= summaryRect.left ||
        actionsRect.bottom <= summaryRect.top,
    };
  });

  expect(headerLayout).toEqual({
    actionsInsideHeader: true,
    buttonsDoNotOverlap: true,
    summaryActionsDoNotOverlap: true,
  });
});

test("keeps pane resize reset control out of the divider and fills the right edge", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoEditor(page);

  const divider = page.getByRole("separator", { name: "中央ペインとAIアシストの幅を調整" });
  const dividerBox = await divider.boundingBox();
  expect(dividerBox).not.toBeNull();

  const startX = dividerBox!.x + dividerBox!.width / 2;
  await divider.dispatchEvent("pointerdown", {
    button: 0,
    clientX: startX,
    pointerId: 1,
    pointerType: "mouse",
  });
  await page.dispatchEvent("body", "pointermove", {
    clientX: startX - 120,
    pointerId: 1,
    pointerType: "mouse",
  });
  await page.dispatchEvent("body", "pointerup", {
    pointerId: 1,
    pointerType: "mouse",
  });

  const resetButton = page.getByRole("button", { name: "中央ペインとAIアシストの幅をリセット" });
  await expect(resetButton).toBeVisible();

  const resizeLayout = await page.evaluate(() => {
    const layout = document.querySelector(".three-pane-layout");
    const chatPane = document.querySelector(".chat-pane");
    const resetButton = document.querySelector(".pane-layout-reset-button");
    const divider = document.querySelector(".pane-resize-handle");

    if (
      !(layout instanceof HTMLElement) ||
      !(chatPane instanceof HTMLElement) ||
      !(resetButton instanceof HTMLElement) ||
      !(divider instanceof HTMLElement)
    ) {
      throw new Error("Missing pane resize element");
    }

    const layoutRect = layout.getBoundingClientRect();
    const chatRect = chatPane.getBoundingClientRect();
    const resetRect = resetButton.getBoundingClientRect();
    const dividerRect = divider.getBoundingClientRect();

    const overlapsDivider =
      resetRect.left < dividerRect.right &&
      resetRect.right > dividerRect.left &&
      resetRect.top < dividerRect.bottom &&
      resetRect.bottom > dividerRect.top;

    return {
      chatRightGap: Math.round(layoutRect.right - chatRect.right),
      resetInsideChat:
        resetRect.left >= chatRect.left &&
        resetRect.right <= chatRect.right &&
        resetRect.top >= chatRect.top &&
        resetRect.bottom <= chatRect.bottom,
      resetOverlapsDivider: overlapsDivider,
    };
  });

  expect(resizeLayout.chatRightGap).toBeLessThanOrEqual(1);
  expect(resizeLayout.resetInsideChat).toBe(true);
  expect(resizeLayout.resetOverlapsDivider).toBe(false);
});

test("aligns the file tree heading with the editor tabs", async ({ page }) => {
  await gotoEditor(page);
  await openExistingWorkspaceFromFirstRunModal(page);
  await page.waitForSelector(".file-tree-pane .pane-heading");

  const headerMetrics = await page.evaluate(() => {
    const fileTreeHeading = document.querySelector(".file-tree-pane .pane-heading");
    const editorTabs = document.querySelector(".editor-tabs");
    const collapseButton = document.querySelector(".left-pane-collapse-button");

    if (!fileTreeHeading || !editorTabs || !collapseButton) {
      throw new Error("Missing editor header elements");
    }

    const fileTreeRect = fileTreeHeading.getBoundingClientRect();
    const editorTabsRect = editorTabs.getBoundingClientRect();
    const collapseRect = collapseButton.getBoundingClientRect();

    return {
      collapseButtonTop: collapseRect.top,
      editorTabsHeight: editorTabsRect.height,
      editorTabsTop: editorTabsRect.top,
      fileTreeHeadingHeight: fileTreeRect.height,
      fileTreeHeadingTop: fileTreeRect.top,
    };
  });

  expect(headerMetrics.fileTreeHeadingTop).toBeCloseTo(headerMetrics.editorTabsTop, 0);
  expect(headerMetrics.fileTreeHeadingHeight).toBeCloseTo(headerMetrics.editorTabsHeight, 0);

  await page.getByRole("button", { name: "左ペインを折りたたむ" }).click();

  const restoreButtonTop = await page
    .getByRole("button", { name: "左ペインを表示" })
    .evaluate((button) => button.getBoundingClientRect().top);

  expect(headerMetrics.collapseButtonTop).toBeCloseTo(restoreButtonTop, 0);
});

test("collapses the chat pane and restores it from the fixed editor tab action", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoEditor(page);
  await openExistingWorkspaceFromFirstRunModal(page);

  const editorPane = page.locator(".editor-pane");
  const fileTreePane = page.locator(".file-tree-pane");
  const chatPane = page.locator(".chat-pane");
  const collapseButton = page.getByRole("button", { name: "右ペインを折りたたむ" });
  const divider = page.getByRole("separator", { name: "中央ペインとAIアシストの幅を調整" });
  const initialEditorBox = await editorPane.boundingBox();
  const initialFileTreeBox = await fileTreePane.boundingBox();
  const collapseButtonTop = await collapseButton.evaluate(
    (button) => button.getBoundingClientRect().top,
  );

  expect(initialEditorBox).not.toBeNull();
  expect(initialFileTreeBox).not.toBeNull();
  await expect(chatPane).toBeVisible();
  await expect(divider).toBeVisible();

  await collapseButton.click();

  await expect(chatPane).toHaveCount(0);
  await expect(divider).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "中央ペインとAIアシストの幅をリセット" }),
  ).toHaveCount(0);

  const restoreButton = page.getByRole("button", { name: "右ペインを表示" });
  const collapsedEditorBox = await editorPane.boundingBox();
  const collapsedFileTreeBox = await fileTreePane.boundingBox();
  const restoreMetrics = await restoreButton.evaluate((button) => {
    const buttonRect = button.getBoundingClientRect();
    const tabsRect = document.querySelector(".editor-tabs")?.getBoundingClientRect();
    const trailingRect = button.closest(".editor-tabs-trailing")?.getBoundingClientRect();
    if (!tabsRect || !trailingRect) {
      throw new Error("Missing editor tab restore control");
    }
    return {
      buttonTop: buttonRect.top,
      trailingRightGap: Math.round(tabsRect.right - trailingRect.right),
    };
  });

  expect(collapsedEditorBox).not.toBeNull();
  expect(collapsedFileTreeBox).not.toBeNull();
  expect(collapsedEditorBox!.width).toBeGreaterThan(initialEditorBox!.width + 250);
  expect(collapsedFileTreeBox!.width).toBeLessThanOrEqual(290);
  expect(collapsedFileTreeBox!.width).toBeCloseTo(initialFileTreeBox!.width, 0);
  expect(restoreMetrics.buttonTop).toBeCloseTo(collapseButtonTop, 0);
  expect(restoreMetrics.trailingRightGap).toBeLessThanOrEqual(1);

  await restoreButton.click();

  await expect(chatPane).toBeVisible();
  await expect(divider).toBeVisible();
  await expect(page.getByRole("button", { name: "右ペインを表示" })).toHaveCount(0);
});

test("keeps file tree, editor, and AI assist scrolling independent inside the viewport", async ({
  page,
}) => {
  const now = new Date("2026-05-09T00:00:00.000Z").toISOString();
  const workspaceRoot = "/tmp/ghostwriter-scroll-fixture";
  const longContent = Array.from(
    { length: 180 },
    (_, index) => `line ${String(index + 1).padStart(3, "0")} ${"content ".repeat(12)}`,
  ).join("\n");
  const longDiff = Array.from(
    { length: 80 },
    (_, index) => `+ proposed change ${String(index + 1).padStart(2, "0")}`,
  ).join("\n");

  await page.setViewportSize({ width: 1280, height: 440 });
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
        items: Array.from({ length: 100 }, (_, index) => ({
          kind: "file",
          path: `src/deep/file-${String(index + 1).padStart(3, "0")}.ts`,
        })),
        limit: 100,
        truncated: false,
      },
    });
  });
  await page.route("**/api/files/content**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        content: longContent,
        path: "src/deep/file-001.ts",
      },
    });
  });
  await page.route("**/api/conversations**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        activeConversation: {
          createdAt: now,
          editProposals: [
            {
              createdAt: now,
              diff: longDiff,
              id: "proposal-1",
              newText: "new",
              oldText: "old",
              operation: "edit",
              path: "src/deep/file-001.ts",
              status: "pending",
              title: "Long edit proposal",
              updatedAt: now,
            },
          ],
          id: "conversation-1",
          lastOpenedAt: now,
          messages: Array.from({ length: 45 }, (_, index) => ({
            content: `Assistant message ${index + 1}: ${"details ".repeat(18)}`,
            createdAt: now,
            id: `message-${index + 1}`,
            role: index % 2 === 0 ? "assistant" : "user",
          })),
          title: "Long conversation",
          updatedAt: now,
          workspaceId: "workspace-1",
        },
        conversations: [
          {
            createdAt: now,
            editProposals: [],
            id: "conversation-1",
            lastOpenedAt: now,
            messages: [],
            title: "Long conversation",
            updatedAt: now,
            workspaceId: "workspace-1",
          },
        ],
        errors: [],
      },
    });
  });

  await gotoEditor(page);
  await page.getByRole("button", { name: "既存のフォルダを開く" }).click();
  await dismissStartGuideIfVisible(page);
  const workspaceTitle = page.locator(".workspace-summary h1");
  await expect(workspaceTitle).toHaveText("ghostwriter-scroll-fixture");
  await expect(workspaceTitle).toHaveAttribute("title", workspaceRoot);
  await page.getByRole("treeitem", { name: "file-001.ts" }).click();
  await expect(page.locator(".cm-content")).toContainText("line 001");

  const scrollMetrics = await page.evaluate(() => {
    const readMetrics = (selector: string) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing element: ${selector}`);
      }

      return {
        clientHeight: element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
        scrollHeight: element.scrollHeight,
      };
    };

    return {
      assistContent: readMetrics(".ai-assist-scroll"),
      documentClientHeight: document.documentElement.clientHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
      editor: readMetrics(".editor-surface"),
      fileTree: readMetrics(".file-tree-scroll-area"),
      layout: readMetrics(".three-pane-layout"),
    };
  });

  expect(scrollMetrics.layout.clientHeight).toBeLessThanOrEqual(
    scrollMetrics.documentClientHeight,
  );
  expect(scrollMetrics.documentScrollHeight).toBe(
    scrollMetrics.documentClientHeight,
  );

  for (const [name, metrics] of Object.entries({
    assistContent: scrollMetrics.assistContent,
    editor: scrollMetrics.editor,
    fileTree: scrollMetrics.fileTree,
  })) {
    expect(metrics.overflowY).toMatch(/auto|scroll/);
    expect(metrics.scrollHeight, `${name} should overflow vertically`).toBeGreaterThan(
      metrics.clientHeight,
    );
  }

  const before = await page.evaluate(() => ({
    assist: document.querySelector(".ai-assist-scroll")?.scrollTop ?? 0,
    editor: document.querySelector(".editor-surface")?.scrollTop ?? 0,
    fileTree: document.querySelector(".file-tree-scroll-area")?.scrollTop ?? 0,
  }));

  await page.locator(".file-tree-scroll-area").evaluate((element) => {
    element.scrollTop = 500;
  });
  await page.locator(".editor-surface").evaluate((element) => {
    element.scrollTop = 600;
  });
  await page.locator(".ai-assist-scroll").evaluate((element) => {
    element.scrollTop = 700;
  });

  const after = await page.evaluate(() => ({
    assist: document.querySelector(".ai-assist-scroll")?.scrollTop ?? 0,
    documentTop: document.documentElement.scrollTop,
    editor: document.querySelector(".editor-surface")?.scrollTop ?? 0,
    fileTree: document.querySelector(".file-tree-scroll-area")?.scrollTop ?? 0,
  }));

  expect(before).toEqual({ assist: 0, editor: 0, fileTree: 0 });
  expect(after.fileTree).toBeGreaterThan(0);
  expect(after.editor).toBeGreaterThan(0);
  expect(after.assist).toBeGreaterThan(0);
  expect(after.documentTop).toBe(0);
});
