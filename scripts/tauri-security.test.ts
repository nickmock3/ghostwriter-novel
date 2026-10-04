import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type TauriConfig = {
  app: {
    security: {
      csp: Record<string, string | string[]>;
      dangerousDisableAssetCspModification?: boolean | string[];
    };
    windows: Array<{
      dragDropEnabled?: boolean;
      label: string;
    }>;
  };
};

type Capability = {
  permissions: string[];
  windows: string[];
};

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), relativePath), "utf8")) as T;
}

describe("Tauri desktop security", () => {
  it("grants the main window only the required app commands, open dialog, and web URL opener", () => {
    const capability = readJson<Capability>(
      "src-tauri/capabilities/default.json",
    );

    expect(capability.windows).toEqual(["main"]);
    expect(capability.permissions).toEqual([
      "allow-get-sidecar-connection",
      "allow-restart-sidecar",
      "dialog:allow-open",
      {
        identifier: "opener:allow-open-url",
        allow: [{ url: "https://*" }, { url: "http://*" }],
      },
    ]);
    expect(
      capability.permissions.some((permission) =>
        /^(core:default|dialog:default|fs:|process:|shell:)/.test(permission),
      ),
    ).toBe(false);
  });

  it("generates ACL permissions for the two exposed application commands", () => {
    const buildScript = readFileSync(
      resolve(process.cwd(), "src-tauri/build.rs"),
      "utf8",
    );

    expect(buildScript).toContain("tauri_build::AppManifest::new().commands(");
    expect(buildScript).toContain('"get_sidecar_connection"');
    expect(buildScript).toContain('"restart_sidecar"');
  });

  it("limits WebView connections to Tauri IPC and the authenticated loopback sidecar", () => {
    const config = readJson<TauriConfig>("src-tauri/tauri.conf.json");
    const { csp, dangerousDisableAssetCspModification } = config.app.security;

    expect(csp).toMatchObject({
      "base-uri": "'self'",
      "connect-src": ["ipc:", "http://ipc.localhost", "http://127.0.0.1:*"],
      "default-src": "'self'",
      "object-src": "'none'",
      "style-src": ["'self'", "'unsafe-inline'"],
    });
    expect(dangerousDisableAssetCspModification).not.toBe(true);

    const serializedCsp = JSON.stringify(csp);
    expect(serializedCsp).not.toMatch(
      /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com/,
    );
    expect(serializedCsp).not.toContain("https:");
  });

  it("uses the shared HTML5 file drop path on desktop, including Windows", () => {
    const config = readJson<TauriConfig>("src-tauri/tauri.conf.json");
    const mainWindow = config.app.windows.find((window) => window.label === "main");

    expect(mainWindow?.dragDropEnabled).toBe(false);
  });
});

// 移植元MIT noticeがbinary配布から欠落することを防ぐ。
it("bundles the SIWC upstream license as a desktop resource", () => {
  const config = readJson<{ bundle: { resources: string[] } }>("src-tauri/tauri.conf.json");
  expect(config.bundle.resources).toContain("../src/features/siwc/LICENSE");
  expect(readFileSync(resolve(process.cwd(), "src/features/siwc/LICENSE"), "utf8")).toContain("ChatGPT Plan Playground contributors");
});
