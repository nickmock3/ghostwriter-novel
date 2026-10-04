import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertWindowsMsixLayout,
  createWindowsMsixManifest,
  toWindowsMsixVersion,
  validateWindowsMsixManifest,
  WINDOWS_MSIX_IDENTITY,
} from "./windows-msix";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("Windows MSIX version mapping", () => {
  it("maps the 1.0.0 stable release to a Store-compatible zero revision", () => {
    expect(toWindowsMsixVersion("1.0.0")).toBe("1.0.0.0");
  });

  it.each(["0.2.0-preview.5", "1.0.0-preview.1"] as const)(
    "rejects preview versions because the Store requires Revision to be zero: %s",
    (version) => {
      expect(() => toWindowsMsixVersion(version)).toThrow(/revision.*zero|stable/i);
    },
  );

  it.each([
    ["1.0.0", "1.0.0.0"],
    ["1.2.3", "1.2.3.0"],
    ["65535.65535.65535", "65535.65535.65535.0"],
  ])("maps the stable version %s to Store MSIX version %s", (version, expected) => {
    expect(toWindowsMsixVersion(version)).toBe(expected);
  });

  it.each(["0.2.0", "0.65535.65535", "0.0.0"] as const)(
    "rejects a version whose Store MSIX major field is below 1: %s",
    (version) => {
      expect(() => toWindowsMsixVersion(version)).toThrow(/major.*at least 1/i);
    },
  );

  it.each(["65536.0.0", "1.65536.0", "1.0.65536"] as const)(
    "rejects a version outside the Store MSIX range: %s",
    (version) => {
      expect(() => toWindowsMsixVersion(version)).toThrow(/MSIX version is out of range/i);
    },
  );
});

describe("Windows MSIX manifest", () => {
  it("uses the reserved Partner Center identity and the minimum full-trust capability", () => {
    const manifest = createWindowsMsixManifest("1.0.0");

    expect(manifest).toContain(`Name="${WINDOWS_MSIX_IDENTITY.name}"`);
    expect(manifest).toContain(`Publisher="${WINDOWS_MSIX_IDENTITY.publisher}"`);
    expect(manifest).toContain('Version="1.0.0.0"');
    expect(manifest).toContain("<DisplayName>Ghostwriter-Novel</DisplayName>");
    expect(manifest).toContain('ProcessorArchitecture="x64"');
    expect(manifest).toContain(
      `<PublisherDisplayName>${WINDOWS_MSIX_IDENTITY.publisherDisplayName}</PublisherDisplayName>`,
    );
    expect(manifest).toContain('EntryPoint="Windows.FullTrustApplication"');
    expect(manifest).toContain('uap:VisualElements DisplayName="Ghostwriter-Novel"');
    expect(manifest).toContain('<Resource Language="ja-jp" />');
    expect(manifest).not.toContain('<Resource Language="en-us" />');
    expect(manifest).toContain('Name="runFullTrust"');
    expect(manifest).not.toContain("broadFileSystemAccess");
  });

  it("rejects identity drift and forbidden broad file-system access", () => {
    const manifest = createWindowsMsixManifest("1.0.0");

    expect(() =>
      validateWindowsMsixManifest(
        manifest.replace(WINDOWS_MSIX_IDENTITY.name, "Unreserved.Name"),
        "1.0.0",
      ),
    ).toThrow(/Identity Name/i);
    expect(() =>
      validateWindowsMsixManifest(
        manifest.replace(
          '<rescap:Capability Name="runFullTrust" />',
          '<rescap:Capability Name="runFullTrust" /><rescap:Capability Name="broadFileSystemAccess" />',
        ),
        "1.0.0",
      ),
    ).toThrow(/broadFileSystemAccess/i);
  });

  it("rejects manifest display names that differ from the reserved product name", () => {
    const manifest = createWindowsMsixManifest("1.0.0");

    expect(() =>
      validateWindowsMsixManifest(
        manifest.replace(
          "<DisplayName>Ghostwriter-Novel</DisplayName>",
          "<DisplayName>Ghostwriter</DisplayName>",
        ),
        "1.0.0",
      ),
    ).toThrow(/Properties DisplayName/i);
    expect(() =>
      validateWindowsMsixManifest(
        manifest.replace(
          'uap:VisualElements DisplayName="Ghostwriter-Novel"',
          'uap:VisualElements DisplayName="Ghostwriter"',
        ),
        "1.0.0",
      ),
    ).toThrow(/VisualElements DisplayName/i);
  });
});

describe("Windows MSIX layout validation", () => {
  it("requires executables, manifest, visual assets, and the upstream SIWC notice", async () => {
    const layoutRoot = await mkdtemp(join(tmpdir(), "ghostwriter-msix-layout-"));
    temporaryDirectories.push(layoutRoot);
    await mkdir(join(layoutRoot, "Assets"), { recursive: true });
    await Promise.all([
      writeFile(join(layoutRoot, "ghostwriter.exe"), "tauri"),
      writeFile(join(layoutRoot, "ghostwriter-sidecar.exe"), "sidecar"),
      writeFile(join(layoutRoot, "rg.exe"), "ripgrep"),
      writeFile(join(layoutRoot, "SIWC-LICENSE.txt"), readFileSync(join(process.cwd(), "src/features/siwc/LICENSE"))),
      writeFile(
        join(layoutRoot, "AppxManifest.xml"),
        createWindowsMsixManifest("1.0.0"),
      ),
      writeFile(join(layoutRoot, "Assets", "Square44x44Logo.png"), "logo"),
      writeFile(join(layoutRoot, "Assets", "Square150x150Logo.png"), "logo"),
    ]);

    expect(() => assertWindowsMsixLayout(layoutRoot, "1.0.0")).not.toThrow();

    await rm(join(layoutRoot, "SIWC-LICENSE.txt"));
    expect(() => assertWindowsMsixLayout(layoutRoot, "1.0.0")).toThrow(/SIWC-LICENSE/);
    await writeFile(join(layoutRoot, "SIWC-LICENSE.txt"), readFileSync(join(process.cwd(), "src/features/siwc/LICENSE")));

    await rm(join(layoutRoot, "ghostwriter-sidecar.exe"));
    expect(() => assertWindowsMsixLayout(layoutRoot, "1.0.0")).toThrow(
      /ghostwriter-sidecar\.exe/i,
    );
  });
});

describe("Windows MSIX release integration", () => {
  it("exposes package and validation commands", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["package:windows:msix"]).toBe(
      "bun run scripts/windows-msix.ts package",
    );
    expect(packageJson.scripts?.["validate:windows:msix"]).toBe(
      "bun run scripts/windows-msix.ts validate",
    );
    expect(packageJson.scripts?.["build:desktop:windows:msix"]).toBe(
      "bun run scripts/desktop-runtime.ts build --target x86_64-pc-windows-msvc --no-bundle",
    );
  });

  it("builds, packages, and uploads the unsigned Store MSIX without an MSI bundle", () => {
    const workflow = readFileSync(
      join(process.cwd(), ".github", "workflows", "desktop-preview.yml"),
      "utf8",
    );

    expect(workflow).toContain("bun run package:windows:msix");
    expect(workflow).toContain("bun run validate:windows:msix");
    expect(workflow).toContain("bun run build:desktop:windows:msix");
    expect(workflow).toContain("name: windows-store-msix");
    expect(workflow).not.toContain("bundle.msi");
    expect(workflow).toContain("build-windows-store-msix:");
    expect(workflow).toMatch(
      /build-windows-store-msix:[\s\S]*Package unsigned Store MSIX[\s\S]*Validate Windows MSIX layout[\s\S]*Upload unsigned Store MSIX/,
    );
  });
});
