import { expect, test, type Page } from "@playwright/test";

// API-mocked UI integration coverage; real persistence is covered by workspace-persistence.spec.ts.

const workspaceRoot = "/tmp/ghostwriter-dropped-files-e2e";

type WorkspaceState = {
  contents: Map<string, string>;
  fileOrder: string[];
  importRequests: number;
  saveRequests: number;
  treeRequests: number;
};

async function installWorkspaceRoutes(page: Page, state: WorkspaceState) {
  await page.route("**/api/workspace/select**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { workspaceRoot },
    });
  });
  await page.route("**/api/workspace/validate**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { workspaceRoot },
    });
  });
  await page.route("**/api/files/tree**", async (route) => {
    state.treeRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      json: {
        items: state.fileOrder.map((path) => ({ kind: "file", path })),
        limit: 100,
        truncated: false,
      },
    });
  });
  await page.route("**/api/files/content**", async (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      state.saveRequests += 1;
      const body = request.postDataJSON() as { content: string; path: string };
      state.contents.set(body.path, body.content);
      await route.fulfill({
        contentType: "application/json",
        json: { content: body.content, path: body.path },
      });
      return;
    }

    const path = new URL(request.url()).searchParams.get("path") ?? "";
    const content = state.contents.get(path);
    await route.fulfill({
      contentType: "application/json",
      json:
        content === undefined
          ? { message: "not found" }
          : { content, path },
      status: content === undefined ? 404 : 200,
    });
  });
  await page.route("**/api/files/import", async (route) => {
    const body = route.request().postDataJSON() as {
      contentBase64: string;
      insertBeforePath?: string;
      name: string;
      parentPath: string;
    };
    state.importRequests += 1;
    const importedPath = body.parentPath
      ? `${body.parentPath}/${body.name}`
      : body.name;
    const insertionIndex =
      body.insertBeforePath === undefined
        ? state.fileOrder.length
        : state.fileOrder.indexOf(body.insertBeforePath);
    state.fileOrder.splice(
      insertionIndex < 0 ? state.fileOrder.length : insertionIndex,
      0,
      importedPath,
    );
    state.contents.set(
      importedPath,
      Buffer.from(body.contentBase64, "base64").toString("utf8"),
    );
    await route.fulfill({
      contentType: "application/json",
      json: {
        operation: "import",
        orderedFilePaths: [...state.fileOrder],
        parentPath: body.parentPath,
        path: importedPath,
      },
    });
  });
  await page.route("**/api/conversations**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { activeConversation: null, conversations: [], errors: [] },
    });
  });
}

async function openWorkspace(page: Page) {
  await page.goto("/editor");
  await page.waitForFunction(() => window.__GHOSTWRITER_HYDRATED__ === true);
  await page.getByRole("button", { name: "既存のフォルダを開く" }).click();

  const startGuide = page.getByRole("dialog", { name: "何から始めますか？" });
  try {
    await expect(startGuide).toBeVisible({ timeout: 3000 });
    await page.getByRole("button", { name: "開始ガイドを閉じる" }).click();
  } catch {
    // A non-empty fixture may skip the start guide.
  }
}

async function createTextFileTransfer(page: Page, name: string, content: string) {
  return page.evaluateHandle(
    ({ fileContent, fileName }) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([fileContent], fileName, { type: "text/plain" }),
      );
      return transfer;
    },
    { fileContent: content, fileName: name },
  );
}

async function visibleFileOrder(page: Page) {
  return page
    .getByRole("tree", { name: "ファイルツリー" })
    .locator(".file-tree-row-label")
    .allTextContents();
}

test("drops a text file into CodeMirror as an unsaved edit", async ({ page }) => {
  const state: WorkspaceState = {
    contents: new Map([
      ["A.txt", "ALPHA"],
      ["B.txt", "BRAVO"],
    ]),
    fileOrder: ["A.txt", "B.txt"],
    importRequests: 0,
    saveRequests: 0,
    treeRequests: 0,
  };
  await installWorkspaceRoutes(page, state);
  await openWorkspace(page);

  await page.getByRole("treeitem", { name: "A.txt" }).click();
  const editorContent = page.locator(".cm-content");
  await expect(editorContent).toContainText("ALPHA");
  const editorBox = await editorContent.boundingBox();
  if (!editorBox) {
    throw new Error("CodeMirror content is not visible");
  }
  const dataTransfer = await createTextFileTransfer(
    page,
    "dropped.txt",
    "DROP",
  );

  await page.locator(".editor-surface").dispatchEvent("drop", {
    clientX: editorBox.x + 4,
    clientY: editorBox.y + 8,
    dataTransfer,
  });

  await expect(editorContent).toContainText("DROP");
  await expect(page.getByText("Unsaved", { exact: true })).toBeVisible();
  expect(state.saveRequests).toBe(0);
});

test("keeps a dropped tree file between siblings after refresh, mode changes, and reload", async ({
  page,
}) => {
  const state: WorkspaceState = {
    contents: new Map([
      ["A.txt", "A"],
      ["B.txt", "B"],
    ]),
    fileOrder: ["A.txt", "B.txt"],
    importRequests: 0,
    saveRequests: 0,
    treeRequests: 0,
  };
  await installWorkspaceRoutes(page, state);
  await openWorkspace(page);
  await expect.poll(() => visibleFileOrder(page)).toEqual(["A.txt", "B.txt"]);

  const dataTransfer = await createTextFileTransfer(page, "C.txt", "C");
  await page
    .getByLabel("A.txt と B.txt の間にファイルを追加")
    .dispatchEvent("drop", { dataTransfer });

  await expect.poll(() => state.importRequests).toBe(1);
  await expect.poll(() => state.treeRequests).toBeGreaterThanOrEqual(2);
  await expect.poll(() => visibleFileOrder(page)).toEqual([
    "A.txt",
    "C.txt",
    "B.txt",
  ]);
  await expect(page.getByRole("tab", { name: "C.txt" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.getByRole("link", { name: "チャットモード" }).click();
  await expect(
    page.getByRole("region", { exact: true, name: "チャットモード" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "エディット画面" }).click();
  await expect.poll(() => visibleFileOrder(page)).toEqual([
    "A.txt",
    "C.txt",
    "B.txt",
  ]);

  await page.reload();
  await page.waitForFunction(() => window.__GHOSTWRITER_HYDRATED__ === true);
  await expect.poll(() => visibleFileOrder(page)).toEqual([
    "A.txt",
    "C.txt",
    "B.txt",
  ]);
});
