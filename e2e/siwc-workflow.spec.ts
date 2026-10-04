import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("SIWC UI through real HTTP, runAgentLoop, files and history (synthetic OAuth/LLM)", async ({ page }, testInfo) => {
  // Windowsは各資格情報アクセスで実ACLを確認する。保存・複数turn・画面往復を含む全行程の予算。
  if (process.platform === "win32") test.setTimeout(90_000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "siwc-e2e-workspace-")));
  await writeFile(join(root, "draft.txt"), "before");
  const child = spawn("bun", ["e2e/support/siwc-server.ts"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => reject(new Error(`Fixture server exited: ${code}`)));
      let output = "";
      child.stdout.on("data", chunk => { output += String(chunk); const match = output.match(/\{"port":(\d+)\}/); if (match) resolve(Number(match[1])); });
      child.stderr.on("data", chunk => process.stderr.write(chunk));
    });
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: `http://127.0.0.1:${port}${url.pathname}${url.search}`, headers: { ...route.request().headers(), origin: `http://127.0.0.1:${port}` } });
      await route.fulfill({ response });
    });
    await page.addInitScript(workspaceRoot => {
      localStorage.setItem("ghostwriter:last-workspace-root", workspaceRoot);
      localStorage.setItem(`ghostwriter:start-guide-dismissed:${workspaceRoot}`, "true");
    }, root);
    await page.goto("/settings");
    await expect(page.getByRole("region", { name: "ChatGPTプラン接続" }).getByText("サインイン済み", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "チャットモード" }).click();
    await expect(page.getByLabel("会話の実行方式")).toHaveValue("chatgpt");
    await expect(page.getByLabel("ChatGPTモデル", { exact: true })).toHaveValue("test-model");
    await page.getByPlaceholder("ワークスペースについて質問").fill("draft.txtのbeforeをafterへ変更してください");
    await page.getByRole("button", { name: "送信", exact: true }).click();
    await expect(page.getByText("編集しました", { exact: true })).toBeVisible();
    await expect.poll(() => readFile(join(root, "draft.txt"), "utf8")).toBe("after");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(() => readFile(join(root, "draft.txt"), "utf8")).toBe("before");
    await page.reload();
    await expect(page.getByLabel("会話の実行方式")).toHaveValue("chatgpt");
    await page.getByPlaceholder("ワークスペースについて質問").fill("続けてください");
    await page.getByRole("button", { name: "送信", exact: true }).click();
    await expect(page.getByText("履歴を引き継ぎました", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "エディット画面" }).click();
    await page.getByRole("treeitem", { name: "draft.txt" }).click();
    await expect(page.getByLabel("実行方式", { exact: true })).toHaveValue("chatgpt");
    await expect(page.getByLabel("AIアシストChatGPTモデル")).toHaveValue("test-model");
    await page.getByRole("button", { name: "推敲を実行", exact: true }).click();
    await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
    expect(await readFile(join(root, "draft.txt"), "utf8")).toBe("before");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect.poll(() => readFile(join(root, "draft.txt"), "utf8")).toBe("assisted");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(() => readFile(join(root, "draft.txt"), "utf8")).toBe("before");
    await page.screenshot({ path: testInfo.outputPath("siwc-assist.png"), fullPage: true });
    await page.getByRole("link", { name: "チャットモード" }).click();
    await expect(page.getByText("履歴を引き継ぎました", { exact: true })).toBeVisible();
    await page.getByLabel("会話の実行方式").selectOption("vercel-ai");
    await expect(page.getByText("履歴を引き継ぎました", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel("会話の実行方式")).toHaveValue("vercel-ai");
    await page.getByLabel("会話の実行方式").selectOption("chatgpt");
    await expect(page.getByLabel("ChatGPTモデル", { exact: true })).toHaveValue("test-model");
    await expect(page.getByLabel("ChatGPTモデル", { exact: true })).toBeEnabled();
  } finally {
    // 最後の画面の再取得が残っていても、サーバー停止によるECONNRESETをテスト結果へ混ぜない。
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.close();
    child.kill("SIGTERM");
    await new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once("exit", () => resolve()); });
    await rm(root, { recursive: true, force: true });
  }
});
