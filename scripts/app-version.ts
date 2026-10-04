import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ParsedApplicationVersion = {
  raw: string;
  major: number;
  minor: number;
  patch: number;
  preview: number | null;
};

export type SetApplicationVersionOptions = {
  refreshCargoLock?: (args: {
    cargoLockPath: string;
    expectedVersion: string;
  }) => Promise<void>;
};

const SEGMENT_PATTERN = "0|[1-9]\\d*";
const STABLE_VERSION_PATTERN = new RegExp(
  `^(${SEGMENT_PATTERN})\\.(${SEGMENT_PATTERN})\\.(${SEGMENT_PATTERN})$`,
);
const PREVIEW_VERSION_PATTERN = new RegExp(
  `^(${SEGMENT_PATTERN})\\.(${SEGMENT_PATTERN})\\.(${SEGMENT_PATTERN})-preview\\.(${SEGMENT_PATTERN})$`,
);

const PACKAGE_JSON_PATH = "package.json";
const TAURI_CONFIG_PATH = "src-tauri/tauri.conf.json";
const TAURI_WINDOWS_CONFIG_PATH = "src-tauri/tauri.windows.conf.json";
const CARGO_TOML_PATH = "src-tauri/Cargo.toml";
const CARGO_LOCK_PATH = "src-tauri/Cargo.lock";
const TAURI_VERSION_REFERENCE = "../package.json";

const MSI_MAJOR_MINOR_MAX = 255;
const MSI_PATCH_MAX = 64;
const MSI_BUILD_MAX = 65535;
const PREVIEW_NUMBER_MIN = 1;
const PREVIEW_NUMBER_MAX = 998;

function readText(projectRoot: string, relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), "utf8");
}

function writeText(projectRoot: string, relativePath: string, content: string): void {
  writeFileSync(join(projectRoot, relativePath), content, "utf8");
}

function parseNumericSegment(value: string): number {
  return Number.parseInt(value, 10);
}

export function parseApplicationVersion(version: string): ParsedApplicationVersion {
  if (version !== version.trim() || version.length === 0) {
    throw new Error(`Unsupported application version: ${version}`);
  }

  const previewMatch = version.match(PREVIEW_VERSION_PATTERN);
  if (previewMatch) {
    const preview = parseNumericSegment(previewMatch[4]);
    if (preview < PREVIEW_NUMBER_MIN || preview > PREVIEW_NUMBER_MAX) {
      throw new Error(`Unsupported application version: ${version}`);
    }

    return {
      raw: version,
      major: parseNumericSegment(previewMatch[1]),
      minor: parseNumericSegment(previewMatch[2]),
      patch: parseNumericSegment(previewMatch[3]),
      preview,
    };
  }

  const stableMatch = version.match(STABLE_VERSION_PATTERN);
  if (!stableMatch) {
    throw new Error(`Unsupported application version: ${version}`);
  }

  return {
    raw: version,
    major: parseNumericSegment(stableMatch[1]),
    minor: parseNumericSegment(stableMatch[2]),
    patch: parseNumericSegment(stableMatch[3]),
    preview: null,
  };
}

function assertMsiMappingRange(parsed: ParsedApplicationVersion): void {
  if (parsed.major > MSI_MAJOR_MINOR_MAX || parsed.minor > MSI_MAJOR_MINOR_MAX) {
    throw new Error(`Windows MSI version is out of range for ${parsed.raw}`);
  }
  if (parsed.patch > MSI_PATCH_MAX) {
    throw new Error(`Windows MSI version is out of range for ${parsed.raw}`);
  }
}

export function toWindowsMsiVersion(version: string): string {
  const parsed = parseApplicationVersion(version);
  assertMsiMappingRange(parsed);

  const build =
    parsed.preview === null
      ? parsed.patch * 1000 + 999
      : parsed.patch * 1000 + parsed.preview;

  if (build > MSI_BUILD_MAX) {
    throw new Error(`Windows MSI version is out of range for ${parsed.raw}`);
  }

  return `${parsed.major}.${parsed.minor}.${build}`;
}

export function readApplicationVersion(projectRoot: string): string {
  const packageJson = JSON.parse(readText(projectRoot, PACKAGE_JSON_PATH)) as { version?: string };
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error(`${PACKAGE_JSON_PATH} is missing a valid version`);
  }
  return parseApplicationVersion(packageJson.version).raw;
}

function readCargoTomlVersion(cargoToml: string): string | null {
  const match = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
  return match?.[1] ?? null;
}

function readCargoLockGhostwriterVersion(cargoLock: string): string | null {
  const match = cargoLock.match(
    /\[\[package\]\]\r?\nname = "ghostwriter"\r?\nversion = "([^"]+)"/,
  );
  return match?.[1] ?? null;
}

function readWindowsWixVersion(windowsConfig: {
  bundle?: { windows?: { wix?: { version?: string } } };
}): string | null {
  const version = windowsConfig.bundle?.windows?.wix?.version;
  return typeof version === "string" ? version : null;
}

export function findApplicationVersionMismatches(projectRoot: string): string[] {
  const expectedVersion = readApplicationVersion(projectRoot);
  const mismatches: string[] = [];

  const tauriConfig = JSON.parse(readText(projectRoot, TAURI_CONFIG_PATH)) as { version?: string };
  if (tauriConfig.version !== TAURI_VERSION_REFERENCE) {
    mismatches.push(
      `${TAURI_CONFIG_PATH} version must reference ${TAURI_VERSION_REFERENCE}`,
    );
  }

  const cargoTomlVersion = readCargoTomlVersion(readText(projectRoot, CARGO_TOML_PATH));
  if (cargoTomlVersion !== expectedVersion) {
    mismatches.push(
      `${CARGO_TOML_PATH} version is ${cargoTomlVersion ?? "missing"}; expected ${expectedVersion}`,
    );
  }

  const cargoLockVersion = readCargoLockGhostwriterVersion(readText(projectRoot, CARGO_LOCK_PATH));
  if (cargoLockVersion !== expectedVersion) {
    mismatches.push(
      `${CARGO_LOCK_PATH} ghostwriter version is ${cargoLockVersion ?? "missing"}; expected ${expectedVersion}`,
    );
  }

  let expectedMsiVersion: string;
  try {
    expectedMsiVersion = toWindowsMsiVersion(expectedVersion);
  } catch {
    mismatches.push(`${PACKAGE_JSON_PATH} version cannot be mapped to a Windows MSI version`);
    return mismatches;
  }

  const windowsConfig = JSON.parse(readText(projectRoot, TAURI_WINDOWS_CONFIG_PATH)) as {
    bundle?: { windows?: { wix?: { version?: string } } };
  };
  const windowsWixVersion = readWindowsWixVersion(windowsConfig);
  if (windowsWixVersion !== expectedMsiVersion) {
    mismatches.push(
      `${TAURI_WINDOWS_CONFIG_PATH} bundle.windows.wix.version is ${windowsWixVersion ?? "missing"}; expected ${expectedMsiVersion}`,
    );
  }

  return mismatches;
}

function updateTauriConfigVersion(projectRoot: string): void {
  const tauriConfigPath = join(projectRoot, TAURI_CONFIG_PATH);
  const tauriConfig = readFileSync(tauriConfigPath, "utf8");
  const versionMatch = tauriConfig.match(/^(\s*"version"\s*:\s*")([^"]+)(")/m);
  if (!versionMatch) {
    throw new Error(`${TAURI_CONFIG_PATH} is missing a version field`);
  }
  if (versionMatch[2] === TAURI_VERSION_REFERENCE) {
    return;
  }
  const updated = tauriConfig.replace(
    /^(\s*"version"\s*:\s*")([^"]+)(")/m,
    `$1${TAURI_VERSION_REFERENCE}$3`,
  );
  writeFileSync(tauriConfigPath, updated, "utf8");
}

function updatePackageJsonVersion(projectRoot: string, version: string): void {
  const packageJsonPath = join(projectRoot, PACKAGE_JSON_PATH);
  const packageJson = readFileSync(packageJsonPath, "utf8");
  const versionMatch = packageJson.match(/^(\s*"version"\s*:\s*")([^"]+)(")/m);
  if (!versionMatch) {
    throw new Error(`${PACKAGE_JSON_PATH} is missing a version field`);
  }
  if (versionMatch[2] === version) {
    return;
  }
  const updated = packageJson.replace(/^(\s*"version"\s*:\s*")([^"]+)(")/m, `$1${version}$3`);
  writeFileSync(packageJsonPath, updated, "utf8");
}

function updateCargoTomlVersion(projectRoot: string, version: string): void {
  const cargoTomlPath = join(projectRoot, CARGO_TOML_PATH);
  const cargoToml = readFileSync(cargoTomlPath, "utf8");
  const versionMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
  if (!versionMatch) {
    throw new Error(`${CARGO_TOML_PATH} is missing a package version field`);
  }
  if (versionMatch[1] === version) {
    return;
  }
  const updated = cargoToml.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
  writeFileSync(cargoTomlPath, updated, "utf8");
}

function updateWindowsWixVersion(projectRoot: string, msiVersion: string): void {
  const windowsConfigPath = join(projectRoot, TAURI_WINDOWS_CONFIG_PATH);
  const windowsConfig = readFileSync(windowsConfigPath, "utf8");
  const versionMatch = windowsConfig.match(
    /("wix"\s*:\s*\{[^}]*"version"\s*:\s*")([^"]+)(")/s,
  );
  if (!versionMatch) {
    throw new Error(`${TAURI_WINDOWS_CONFIG_PATH} is missing bundle.windows.wix.version`);
  }
  if (versionMatch[2] === msiVersion) {
    return;
  }
  const updated = windowsConfig.replace(
    /("wix"\s*:\s*\{[^}]*"version"\s*:\s*")([^"]+)(")/s,
    `$1${msiVersion}$3`,
  );
  writeFileSync(windowsConfigPath, updated, "utf8");
}

async function defaultRefreshCargoLock({
  cargoLockPath,
  expectedVersion,
}: {
  cargoLockPath: string;
  expectedVersion: string;
}): Promise<void> {
  const manifestPath = join(dirname(cargoLockPath), "Cargo.toml");
  const result = spawnSync(
    "cargo",
    ["update", "--workspace", "--manifest-path", manifestPath],
    {
      cwd: dirname(manifestPath),
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "cargo update --workspace failed");
  }

  const ghostwriterVersion = readCargoLockGhostwriterVersion(readFileSync(cargoLockPath, "utf8"));
  if (ghostwriterVersion !== expectedVersion) {
    throw new Error(
      `${CARGO_LOCK_PATH} ghostwriter version is ${ghostwriterVersion ?? "missing"}; expected ${expectedVersion}`,
    );
  }
}

function assertWindowsConfigExists(projectRoot: string): void {
  try {
    readFileSync(join(projectRoot, TAURI_WINDOWS_CONFIG_PATH), "utf8");
  } catch {
    throw new Error(`Missing required file: ${TAURI_WINDOWS_CONFIG_PATH}`);
  }
}

function preflightValidateSyncTargets(projectRoot: string): void {
  assertWindowsConfigExists(projectRoot);

  const packageJson = JSON.parse(readText(projectRoot, PACKAGE_JSON_PATH)) as unknown;
  if (typeof packageJson !== "object" || packageJson === null) {
    throw new Error(`${PACKAGE_JSON_PATH} is not a valid JSON object`);
  }

  JSON.parse(readText(projectRoot, TAURI_CONFIG_PATH)) as unknown;

  const windowsConfig = JSON.parse(readText(projectRoot, TAURI_WINDOWS_CONFIG_PATH)) as unknown;
  if (typeof windowsConfig !== "object" || windowsConfig === null) {
    throw new Error(`${TAURI_WINDOWS_CONFIG_PATH} is not a valid JSON object`);
  }

  const cargoTomlVersion = readCargoTomlVersion(readText(projectRoot, CARGO_TOML_PATH));
  if (cargoTomlVersion === null) {
    throw new Error(`${CARGO_TOML_PATH} is missing a package version field`);
  }

  const cargoLockVersion = readCargoLockGhostwriterVersion(readText(projectRoot, CARGO_LOCK_PATH));
  if (cargoLockVersion === null) {
    throw new Error(`${CARGO_LOCK_PATH} is missing ghostwriter package metadata`);
  }
}

export async function setApplicationVersion(
  projectRoot: string,
  version: string,
  options: SetApplicationVersionOptions = {},
): Promise<void> {
  parseApplicationVersion(version);
  const msiVersion = toWindowsMsiVersion(version);
  preflightValidateSyncTargets(projectRoot);

  const trackedPaths = [
    PACKAGE_JSON_PATH,
    TAURI_CONFIG_PATH,
    CARGO_TOML_PATH,
    TAURI_WINDOWS_CONFIG_PATH,
    CARGO_LOCK_PATH,
  ] as const;
  const originals = new Map(
    trackedPaths.map((relativePath) => [relativePath, readText(projectRoot, relativePath)]),
  );

  const refreshCargoLock = options.refreshCargoLock ?? defaultRefreshCargoLock;

  try {
    updatePackageJsonVersion(projectRoot, version);
    updateTauriConfigVersion(projectRoot);
    updateCargoTomlVersion(projectRoot, version);
    updateWindowsWixVersion(projectRoot, msiVersion);
    await refreshCargoLock({
      cargoLockPath: join(projectRoot, CARGO_LOCK_PATH),
      expectedVersion: version,
    });

    const mismatches = findApplicationVersionMismatches(projectRoot);
    if (mismatches.length > 0) {
      throw new Error(mismatches.join("\n"));
    }
  } catch (error) {
    for (const [relativePath, content] of originals) {
      writeText(projectRoot, relativePath, content);
    }
    throw error;
  }
}

export function assertReleaseTagMatches(tag: string, sourceVersion: string): void {
  const normalizedTag = tag.startsWith("v") ? tag.slice(1) : tag;
  if (normalizedTag !== sourceVersion) {
    throw new Error(`Release tag ${tag} does not match application version ${sourceVersion}`);
  }
}

function shouldValidateReleaseTag(argv: string[]): boolean {
  if (argv.includes("--tag")) {
    return true;
  }
  return (
    process.env.GITHUB_EVENT_NAME === "push" &&
    process.env.GITHUB_REF?.startsWith("refs/tags/") === true
  );
}

function resolveReleaseTag(argv: string[]): string | undefined {
  const tagIndex = argv.indexOf("--tag");
  if (tagIndex >= 0) {
    return argv[tagIndex + 1];
  }
  if (process.env.GITHUB_REF?.startsWith("refs/tags/")) {
    return process.env.GITHUB_REF_NAME;
  }
  return undefined;
}

async function runCheckCli(argv: string[]): Promise<void> {
  const projectRoot = join(import.meta.dir, "..");
  const mismatches = findApplicationVersionMismatches(projectRoot);
  if (mismatches.length > 0) {
    for (const mismatch of mismatches) {
      console.error(mismatch);
    }
    process.exit(1);
  }

  if (shouldValidateReleaseTag(argv)) {
    const tag = resolveReleaseTag(argv);
    if (!tag) {
      throw new Error("Release tag is required when --tag is specified");
    }
    assertReleaseTagMatches(tag, readApplicationVersion(projectRoot));
  }

  console.log(`Application version ${readApplicationVersion(projectRoot)} is consistent`);
}

async function runSetCli(argv: string[]): Promise<void> {
  const version = argv[1];
  if (!version) {
    throw new Error("Usage: bun run version:set <version>");
  }

  const projectRoot = join(import.meta.dir, "..");
  await setApplicationVersion(projectRoot, version);
  console.log(`Updated application version to ${version}`);
}

async function runCli(argv: string[]): Promise<void> {
  const command = argv[0] ?? "check";
  if (command === "set") {
    await runSetCli(argv);
    return;
  }
  if (command === "check") {
    await runCheckCli(argv.slice(1));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (import.meta.main) {
  void runCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
