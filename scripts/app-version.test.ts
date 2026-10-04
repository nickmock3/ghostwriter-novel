import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertReleaseTagMatches,
  findApplicationVersionMismatches,
  parseApplicationVersion,
  readApplicationVersion,
  setApplicationVersion,
  toWindowsMsiVersion,
} from "./app-version";

const temporaryDirectories: string[] = [];

async function createVersionFixture(options?: {
  missingWindowsConfig?: boolean;
  tauriVersion?: string;
}): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "ghostwriter-app-version-"));
  temporaryDirectories.push(projectRoot);

  await mkdir(join(projectRoot, "src-tauri"), { recursive: true });
  await writeFile(
    join(projectRoot, "package.json"),
    `${JSON.stringify({ name: "ghostwriter", version: "0.1.0-preview.1" }, null, 2)}\n`,
  );
  await writeFile(
    join(projectRoot, "src-tauri", "tauri.conf.json"),
    `${JSON.stringify({ version: options?.tauriVersion ?? "../package.json" }, null, 2)}\n`,
  );
  if (!options?.missingWindowsConfig) {
    await writeFile(
      join(projectRoot, "src-tauri", "tauri.windows.conf.json"),
      `${JSON.stringify(
        { bundle: { targets: ["msi"], windows: { wix: { version: "0.1.1" } } } },
        null,
        2,
      )}\n`,
    );
  }
  await writeFile(
    join(projectRoot, "src-tauri", "Cargo.toml"),
    '[package]\nname = "ghostwriter"\nversion = "0.1.0-preview.1"\nedition = "2021"\n',
  );
  await writeFile(
    join(projectRoot, "src-tauri", "Cargo.lock"),
    'version = 4\n\n[[package]]\nname = "ghostwriter"\nversion = "0.1.0-preview.1"\n',
  );

  return projectRoot;
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("application version parsing", () => {
  it.each([
    ["0.1.0-preview.1", { major: 0, minor: 1, patch: 0, preview: 1 }],
    ["12.34.56-preview.998", { major: 12, minor: 34, patch: 56, preview: 998 }],
    ["1.2.3", { major: 1, minor: 2, patch: 3, preview: null }],
  ])("parses supported version %s", (version, expected) => {
    expect(parseApplicationVersion(version)).toEqual({ raw: version, ...expected });
  });

  it.each([
    "",
    " 0.1.0-preview.1",
    "0.1.0-preview.1 ",
    "v0.1.0-preview.1",
    "0.1",
    "0.1.0-preview",
    "0.1.0-preview.0",
    "0.1.0-preview.999",
    "0.1.0-beta.1",
    "0.1.0+build.1",
    "01.1.0-preview.1",
  ])("rejects unsupported version %s", (version) => {
    expect(() => parseApplicationVersion(version)).toThrow();
  });
});

describe("Windows MSI version mapping", () => {
  it.each([
    ["0.1.0-preview.1", "0.1.1"],
    ["0.1.0-preview.2", "0.1.2"],
    ["0.1.0", "0.1.999"],
    ["0.1.1-preview.1", "0.1.1001"],
    ["0.2.0-preview.1", "0.2.1"],
  ])("maps %s to %s", (version, expected) => {
    expect(toWindowsMsiVersion(version)).toBe(expected);
  });

  it.each(["256.0.0-preview.1", "0.256.0-preview.1", "0.1.65-preview.1"])(
    "rejects values outside the MSI mapping range: %s",
    (version) => {
      expect(() => toWindowsMsiVersion(version)).toThrow();
    },
  );
});

describe("application version synchronization", () => {
  it("reads package.json as the source of truth", async () => {
    const projectRoot = await createVersionFixture();

    expect(readApplicationVersion(projectRoot)).toBe("0.1.0-preview.1");
    expect(findApplicationVersionMismatches(projectRoot)).toEqual([]);
  });

  it("reads Ghostwriter metadata from a CRLF Cargo.lock", async () => {
    const projectRoot = await createVersionFixture();
    const cargoLockPath = join(projectRoot, "src-tauri", "Cargo.lock");
    await writeFile(cargoLockPath, readText(cargoLockPath).replaceAll("\n", "\r\n"));

    expect(findApplicationVersionMismatches(projectRoot)).toEqual([]);
  });

  it("rejects an unsupported version stored in package.json", async () => {
    const projectRoot = await createVersionFixture();
    await writeFile(
      join(projectRoot, "package.json"),
      `${JSON.stringify({ name: "ghostwriter", version: "0.1.0-beta.1" }, null, 2)}\n`,
    );

    expect(() => readApplicationVersion(projectRoot)).toThrow("Unsupported application version");
  });

  it("updates package, Cargo, Cargo.lock, and Windows metadata together", async () => {
    const projectRoot = await createVersionFixture();

    await setApplicationVersion(projectRoot, "0.2.0-preview.2", {
      refreshCargoLock: async ({ cargoLockPath, expectedVersion }) => {
        const current = readText(cargoLockPath);
        await writeFile(
          cargoLockPath,
          current.replace('version = "0.1.0-preview.1"', `version = "${expectedVersion}"`),
        );
      },
    });

    expect(readApplicationVersion(projectRoot)).toBe("0.2.0-preview.2");
    expect(readText(join(projectRoot, "src-tauri", "Cargo.toml"))).toContain(
      'version = "0.2.0-preview.2"',
    );
    expect(readText(join(projectRoot, "src-tauri", "Cargo.lock"))).toContain(
      'version = "0.2.0-preview.2"',
    );
    expect(
      JSON.parse(readText(join(projectRoot, "src-tauri", "tauri.windows.conf.json"))),
    ).toMatchObject({ bundle: { windows: { wix: { version: "0.2.2" } } } });
    expect(findApplicationVersionMismatches(projectRoot)).toEqual([]);
  });

  it("is idempotent when setting the current version", async () => {
    const projectRoot = await createVersionFixture();
    const tauriConfigPath = join(projectRoot, "src-tauri", "tauri.conf.json");
    await writeFile(
      tauriConfigPath,
      '{\n  "version": "../package.json",\n  "app": { "windows": [{ "width": 1280 }] }\n}\n',
    );
    const trackedPaths = [
      "package.json",
      "src-tauri/tauri.conf.json",
      "src-tauri/tauri.windows.conf.json",
      "src-tauri/Cargo.toml",
      "src-tauri/Cargo.lock",
    ];
    const originals = new Map(
      trackedPaths.map((path) => [path, readText(join(projectRoot, path))]),
    );

    await setApplicationVersion(projectRoot, "0.1.0-preview.1", {
      refreshCargoLock: async () => undefined,
    });

    expect(readApplicationVersion(projectRoot)).toBe("0.1.0-preview.1");
    expect(findApplicationVersionMismatches(projectRoot)).toEqual([]);
    expect(
      new Map(trackedPaths.map((path) => [path, readText(join(projectRoot, path))])),
    ).toEqual(originals);
  });

  it("detects metadata drift without modifying files", async () => {
    const projectRoot = await createVersionFixture();
    const cargoTomlPath = join(projectRoot, "src-tauri", "Cargo.toml");
    await writeFile(
      cargoTomlPath,
      readText(cargoTomlPath).replace("0.1.0-preview.1", "0.1.0-preview.2"),
    );

    expect(findApplicationVersionMismatches(projectRoot)).toEqual([
      "src-tauri/Cargo.toml version is 0.1.0-preview.2; expected 0.1.0-preview.1",
    ]);
  });

  it("does not write anything when preflight validation fails", async () => {
    const projectRoot = await createVersionFixture({ missingWindowsConfig: true });
    const packageJsonPath = join(projectRoot, "package.json");
    const originalPackageJson = readText(packageJsonPath);

    await expect(setApplicationVersion(projectRoot, "0.2.0-preview.1")).rejects.toThrow(
      "src-tauri/tauri.windows.conf.json",
    );
    expect(readText(packageJsonPath)).toBe(originalPackageJson);
  });

  it("repairs a stale Tauri version reference as part of synchronization", async () => {
    const projectRoot = await createVersionFixture({ tauriVersion: "0.1.0-preview.1" });

    await setApplicationVersion(projectRoot, "0.2.0-preview.1", {
      refreshCargoLock: async ({ cargoLockPath, expectedVersion }) => {
        const current = readText(cargoLockPath);
        await writeFile(
          cargoLockPath,
          current.replace('version = "0.1.0-preview.1"', `version = "${expectedVersion}"`),
        );
      },
    });

    expect(
      JSON.parse(readText(join(projectRoot, "src-tauri", "tauri.conf.json"))),
    ).toMatchObject({ version: "../package.json" });
    expect(findApplicationVersionMismatches(projectRoot)).toEqual([]);
  });

  it("verifies Cargo.lock after the refresh command and rolls back on drift", async () => {
    const projectRoot = await createVersionFixture();
    const packageJsonPath = join(projectRoot, "package.json");
    const originalPackageJson = readText(packageJsonPath);

    await expect(
      setApplicationVersion(projectRoot, "0.2.0-preview.1", {
        refreshCargoLock: async () => undefined,
      }),
    ).rejects.toThrow("src-tauri/Cargo.lock");
    expect(readText(packageJsonPath)).toBe(originalPackageJson);
    expect(findApplicationVersionMismatches(projectRoot)).toEqual([]);
  });

  it("restores every file when Cargo lock refresh fails", async () => {
    const projectRoot = await createVersionFixture();
    const trackedPaths = [
      "package.json",
      "src-tauri/tauri.conf.json",
      "src-tauri/tauri.windows.conf.json",
      "src-tauri/Cargo.toml",
      "src-tauri/Cargo.lock",
    ];
    const originals = new Map(
      trackedPaths.map((path) => [path, readText(join(projectRoot, path))]),
    );

    await expect(
      setApplicationVersion(projectRoot, "0.2.0-preview.1", {
        refreshCargoLock: async () => {
          throw new Error("cargo metadata failed");
        },
      }),
    ).rejects.toThrow("cargo metadata failed");

    expect(
      new Map(trackedPaths.map((path) => [path, readText(join(projectRoot, path))])),
    ).toEqual(originals);
  });
});

describe("release tag validation", () => {
  it("accepts the v-prefixed source version", () => {
    expect(() =>
      assertReleaseTagMatches("v0.1.0-preview.1", "0.1.0-preview.1"),
    ).not.toThrow();
  });

  it("rejects a tag that does not match the source version", () => {
    expect(() =>
      assertReleaseTagMatches("v0.1.0-preview.2", "0.1.0-preview.1"),
    ).toThrow("does not match");
  });

  it("rejects a mismatched GitHub tag push through the CLI", () => {
    const result = spawnSync("bun", ["run", "scripts/app-version.ts", "check"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: "refs/tags/v0.1.0-preview.2",
        GITHUB_REF_NAME: "v0.1.0-preview.2",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not match");
  });

  it("does not require a tag for workflow_dispatch", () => {
    const result = spawnSync("bun", ["run", "scripts/app-version.ts", "check"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "workflow_dispatch",
        GITHUB_REF: "refs/heads/main",
        GITHUB_REF_NAME: "main",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("is consistent");
  });
});
