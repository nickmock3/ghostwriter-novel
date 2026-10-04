import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findApplicationVersionMismatches,
  readApplicationVersion,
  toWindowsMsiVersion,
} from "./app-version";
import {
  getR2ObjectKeys,
  packageDesktopPreviewArtifacts,
} from "./package-desktop-preview";

function readText(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readText(relativePath)) as T;
}

describe("desktop preview release configuration", () => {
  it("uses the same preview version across package, Tauri, and Cargo metadata", () => {
    const projectRoot = process.cwd();
    const version = readApplicationVersion(projectRoot);
    const tauriConfig = readJson<{ version: string }>("src-tauri/tauri.conf.json");
    const windowsTauriConfig = readJson<{
      bundle?: { windows?: { wix?: { version?: string } } };
    }>("src-tauri/tauri.windows.conf.json");
    const cargoToml = readText("src-tauri/Cargo.toml");

    expect(tauriConfig.version).toBe("../package.json");
    expect(windowsTauriConfig.bundle?.windows?.wix?.version).toBe(toWindowsMsiVersion(version));
    expect(cargoToml).toContain(`version = "${version}"`);
    expect(findApplicationVersionMismatches(projectRoot)).toEqual([]);
  });

  it("defines a selectable desktop release workflow for only supported targets", () => {
    const workflowPath = ".github/workflows/desktop-preview.yml";
    expect(existsSync(resolve(process.cwd(), workflowPath))).toBe(true);

    const workflow = readText(workflowPath);
    expect(workflow).toContain("aarch64-apple-darwin");
    expect(workflow).toContain("bun run version:check");
    expect(workflow).toContain("bun run test");
    expect(workflow).toContain("brew install ripgrep");
    expect(workflow).toContain("choco install ripgrep");
    expect(workflow).toContain("bun run typecheck");
    expect(workflow).toContain("bun run test:desktop");
    expect(workflow).toContain("bun run build:desktop:mac");
    expect(workflow).toContain("bun run build:desktop:windows:msix");
    expect(workflow).toContain("build-macos:");
    expect(workflow).toContain("build-windows-store-msix:");
    expect(workflow).toContain("SHA256SUMS");
    expect(workflow).toContain('"v*"');
    expect(workflow).toContain("workflow_dispatch");
    expect(workflow).not.toContain("pull_request");
    expect(workflow).not.toContain("branches:");
    expect(workflow).not.toContain("- main");
    expect(workflow).not.toContain("x86_64-apple-darwin");
    expect(workflow).not.toContain("aarch64-pc-windows-msvc");
  });

  it("documents R2 upload configuration without committing credentials", () => {
    expect(existsSync(resolve(process.cwd(), ".github/workflows/r2-smoke.yml"))).toBe(true);

    const envExample = readText(".env.example");
    expect(envExample).toContain("CLOUDFLARE_ACCOUNT_ID=");
    expect(envExample).toContain("R2_BUCKET=");
    expect(envExample).toContain("R2_PUBLIC_BASE_URL=");
    expect(envExample).toContain("R2_ACCESS_KEY_ID=");
    expect(envExample).not.toMatch(/R2_SECRET_ACCESS_KEY=.+/);

    const previewWorkflow = readText(".github/workflows/desktop-preview.yml");
    expect(previewWorkflow).toContain("R2_ACCESS_KEY_ID");
    expect(previewWorkflow).toContain("R2_SECRET_ACCESS_KEY");
    expect(previewWorkflow).not.toContain("CLOUDFLARE_API_TOKEN");

    const smokeWorkflow = readText(".github/workflows/r2-smoke.yml");
    expect(smokeWorkflow).toContain("scripts/r2-put-object.ts");
    expect(smokeWorkflow).not.toContain("wrangler r2 object put");
  });

  it("documents macOS preview and unsigned Store MSIX distribution", () => {
    const readme = readText("README.md");
    expect(readme).toContain("0.1.0-preview.1");
    expect(readme).toContain("Cloudflare R2");
    expect(readme).toContain("未署名preview");
    expect(readme).toContain("Gatekeeper");
    expect(readme).toContain("SHA256SUMS");
    expect(readme).toContain("手動ダウンロード");
    expect(readme).toContain("Microsoft Store");
    expect(readme).toContain("windows-store-msix");
    expect(readme).toContain("R2");
  });

  it("uses stable POSIX R2 object keys for macOS preview artifacts", () => {
    const version = readApplicationVersion(process.cwd());
    const keys = getR2ObjectKeys(version, {
      fileName: `Ghostwriter-${version}-aarch64-apple-darwin.app.tar.gz`,
      relativePath: `aarch64-apple-darwin/Ghostwriter-${version}-aarch64-apple-darwin.app.tar.gz`,
      sourcePath: `/tmp/Ghostwriter-${version}-aarch64-apple-darwin.app.tar.gz`,
    });

    expect(keys).toEqual({
      latestChecksumKey: "ghostwriter/preview/latest/SHA256SUMS",
      latestKey:
        `ghostwriter/preview/latest/aarch64-apple-darwin/Ghostwriter-${version}-aarch64-apple-darwin.app.tar.gz`,
      versionedChecksumKey: `ghostwriter/preview/versions/${version}/SHA256SUMS`,
      versionedKey:
        `ghostwriter/preview/versions/${version}/aarch64-apple-darwin/Ghostwriter-${version}-aarch64-apple-darwin.app.tar.gz`,
    });
  });
});
