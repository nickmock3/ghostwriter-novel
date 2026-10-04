// @vitest-environment node
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createSiwcService } from "./service";
import { resolveWorkspaceRoot } from "../workspace/workspacePaths";
import { createFileContentApiHandler } from "../editor/fileContentApi";
it("資格情報を含むroot・その子・symlink aliasを原稿として開かせない", async () => {
  const parent = await mkdtemp(join(tmpdir(), "ghostwriter-siwc-isolation-"));
  const dataRoot = join(parent, "private");
  const novel = join(parent, "novel");
  try {
    await mkdir(dataRoot); await mkdir(novel);
    createSiwcService({ dataRoot });
    // loginによるcredentials作成より前から保護する。
    await expect(resolveWorkspaceRoot(parent)).rejects.toThrow("private application data");
    await expect(resolveWorkspaceRoot(novel)).resolves.toBeTruthy();
    await mkdir(join(dataRoot, "siwc"));
    await expect(resolveWorkspaceRoot(join(dataRoot, "siwc"))).rejects.toThrow("private application data");
    await symlink(dataRoot, join(parent, "alias"), process.platform === "win32" ? "junction" : "dir");
    await expect(resolveWorkspaceRoot(join(parent, "alias"))).rejects.toThrow("private application data");
    const response = await createFileContentApiHandler()(new Request(`http://localhost/api/files/content?workspaceRoot=${encodeURIComponent(dataRoot)}&path=siwc%2Fcredentials.json`));
    expect(response.ok).toBe(false);
  } finally { await rm(parent, { recursive: true, force: true }); }
});
