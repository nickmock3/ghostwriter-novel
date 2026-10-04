import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  findApplicationVersionMismatches,
  parseApplicationVersion,
  readApplicationVersion,
} from "./app-version";

export const WINDOWS_MSIX_IDENTITY = {
  name: "RyoHeiguchi.Ghostwriter-Novel",
  publisher: "CN=8A2DE4F5-8A62-43C8-83DF-8E6AD96575D9",
  publisherDisplayName: "Ryo Heiguchi",
} as const;

const WINDOWS_MSIX_TARGET = "x86_64-pc-windows-msvc";
const WINDOWS_MSIX_DISPLAY_NAME = "Ghostwriter-Novel";
const WINDOWS_MSIX_LAYOUT_DIRECTORY = join("dist", "windows-msix", "layout");
const WINDOWS_MSIX_OUTPUT_DIRECTORY = join("dist", "windows-msix");
const REQUIRED_LAYOUT_FILES = [
  "AppxManifest.xml",
  "ghostwriter.exe",
  "ghostwriter-sidecar.exe",
  "rg.exe",
  "SIWC-LICENSE.txt",
  join("Assets", "Square44x44Logo.png"),
  join("Assets", "Square150x150Logo.png"),
] as const;

function assertWindowsX64Host(): void {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("Windows MSIX packaging is supported only on Windows x64 hosts");
  }
}

function xmlAttribute(manifest: string, element: string, attribute: string): string | null {
  const match = manifest.match(new RegExp(`<${element}\\b[^>]*\\b${attribute}="([^"]*)"`, "i"));
  return match?.[1] ?? null;
}

export function toWindowsMsixVersion(version: string): string {
  const parsed = parseApplicationVersion(version);
  if (parsed.preview !== null) {
    throw new Error(
      `Windows Store MSIX requires a stable version with Revision 0: ${parsed.raw}`,
    );
  }

  if (parsed.major < 1) {
    throw new Error(`Windows Store MSIX major version must be at least 1: ${parsed.raw}`);
  }

  const numericFields = [parsed.major, parsed.minor, parsed.patch];
  if (numericFields.some((field) => field > 65535)) {
    throw new Error(`Windows MSIX version is out of range for ${parsed.raw}`);
  }

  return `${parsed.major}.${parsed.minor}.${parsed.patch}.0`;
}

export function createWindowsMsixManifest(version: string): string {
  const msixVersion = toWindowsMsixVersion(version);

  return `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">
  <Identity Name="${WINDOWS_MSIX_IDENTITY.name}" Publisher="${WINDOWS_MSIX_IDENTITY.publisher}" Version="${msixVersion}" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>${WINDOWS_MSIX_DISPLAY_NAME}</DisplayName>
    <PublisherDisplayName>${WINDOWS_MSIX_IDENTITY.publisherDisplayName}</PublisherDisplayName>
    <Logo>Assets\\Square150x150Logo.png</Logo>
  </Properties>
  <Resources>
    <Resource Language="ja-jp" />
  </Resources>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Applications>
    <Application Id="Ghostwriter" Executable="ghostwriter.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="${WINDOWS_MSIX_DISPLAY_NAME}" Description="AI-assisted local novel editor" BackgroundColor="transparent" Square150x150Logo="Assets\\Square150x150Logo.png" Square44x44Logo="Assets\\Square44x44Logo.png" />
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
`;
}

export function validateWindowsMsixManifest(manifest: string, version: string): void {
  const expectedVersion = toWindowsMsixVersion(version);
  const identityName = xmlAttribute(manifest, "Identity", "Name");
  if (identityName !== WINDOWS_MSIX_IDENTITY.name) {
    throw new Error(`Identity Name must be ${WINDOWS_MSIX_IDENTITY.name}`);
  }

  const publisher = xmlAttribute(manifest, "Identity", "Publisher");
  if (publisher !== WINDOWS_MSIX_IDENTITY.publisher) {
    throw new Error(`Identity Publisher must be ${WINDOWS_MSIX_IDENTITY.publisher}`);
  }

  if (xmlAttribute(manifest, "Identity", "Version") !== expectedVersion) {
    throw new Error(`Identity Version must be ${expectedVersion}`);
  }
  if (xmlAttribute(manifest, "Identity", "ProcessorArchitecture") !== "x64") {
    throw new Error("Identity ProcessorArchitecture must be x64");
  }
  if (!manifest.includes(`<PublisherDisplayName>${WINDOWS_MSIX_IDENTITY.publisherDisplayName}</PublisherDisplayName>`)) {
    throw new Error("PublisherDisplayName must match the Partner Center identity");
  }
  if (!manifest.includes(`<DisplayName>${WINDOWS_MSIX_DISPLAY_NAME}</DisplayName>`)) {
    throw new Error(`Properties DisplayName must be ${WINDOWS_MSIX_DISPLAY_NAME}`);
  }
  if (xmlAttribute(manifest, "uap:VisualElements", "DisplayName") !== WINDOWS_MSIX_DISPLAY_NAME) {
    throw new Error(`VisualElements DisplayName must be ${WINDOWS_MSIX_DISPLAY_NAME}`);
  }
  if (!/EntryPoint="Windows\.FullTrustApplication"/.test(manifest)) {
    throw new Error("MSIX application must use Windows.FullTrustApplication");
  }
  if (!/<rescap:Capability\s+Name="runFullTrust"\s*\/>/.test(manifest)) {
    throw new Error("MSIX manifest must declare the runFullTrust capability");
  }
  if (/broadFileSystemAccess/i.test(manifest)) {
    throw new Error("MSIX manifest must not declare broadFileSystemAccess");
  }
}

export function assertWindowsMsixLayout(layoutRoot: string, version: string): void {
  for (const relativePath of REQUIRED_LAYOUT_FILES) {
    const filePath = join(layoutRoot, relativePath);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      throw new Error(`Required Windows MSIX layout file is missing: ${relativePath}`);
    }
  }

  validateWindowsMsixManifest(readFileSync(join(layoutRoot, "AppxManifest.xml"), "utf8"), version);
}

function findMakeAppx(): string {
  const configuredPath = process.env.MAKEAPPX_PATH;
  if (configuredPath && existsSync(configuredPath)) {
    return configuredPath;
  }

  const sdkRoot = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits", "10", "bin");
  if (existsSync(sdkRoot)) {
    const versions = readdirSync(sdkRoot)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
    for (const sdkVersion of versions) {
      const candidate = join(sdkRoot, sdkVersion, "x64", "MakeAppx.exe");
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error("MakeAppx.exe was not found. Install the Windows 10/11 SDK or set MAKEAPPX_PATH.");
}

function runCommand(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} failed`);
  }
}

function generateVisualAssets(projectRoot: string, assetsDirectory: string): void {
  const sourceIcon = join(projectRoot, "src-tauri", "icons", "icon-source.png");
  if (!existsSync(sourceIcon)) {
    throw new Error(`Required MSIX source icon is missing: ${sourceIcon}`);
  }

  const helper = join(projectRoot, "scripts", "generate-windows-msix-assets.ps1");
  runCommand(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      helper,
      "-SourceIcon",
      sourceIcon,
      "-OutputDirectory",
      assetsDirectory,
    ],
    projectRoot,
  );
}

export function createWindowsMsixLayout(projectRoot: string, version: string): string {
  const layoutRoot = join(projectRoot, WINDOWS_MSIX_LAYOUT_DIRECTORY);
  const releaseRoot = join(projectRoot, "src-tauri", "target", WINDOWS_MSIX_TARGET, "release");
  const sourceFiles = [
    [join(projectRoot, "src", "features", "siwc", "LICENSE"), "SIWC-LICENSE.txt"],
    [join(releaseRoot, "ghostwriter.exe"), "ghostwriter.exe"],
    [join(releaseRoot, "ghostwriter-sidecar.exe"), "ghostwriter-sidecar.exe"],
    [join(releaseRoot, "runtime-artifacts", "ripgrep", "current", "rg.exe"), "rg.exe"],
  ] as const;

  rmSync(layoutRoot, { force: true, recursive: true });
  mkdirSync(join(layoutRoot, "Assets"), { recursive: true });
  for (const [source, destination] of sourceFiles) {
    if (!existsSync(source)) {
      throw new Error(`Required Windows release artifact is missing: ${source}`);
    }
    copyFileSync(source, join(layoutRoot, destination));
  }
  writeFileSync(join(layoutRoot, "AppxManifest.xml"), createWindowsMsixManifest(version), "utf8");
  generateVisualAssets(projectRoot, join(layoutRoot, "Assets"));
  assertWindowsMsixLayout(layoutRoot, version);
  return layoutRoot;
}

function outputMsixPath(projectRoot: string, version: string): string {
  return join(projectRoot, WINDOWS_MSIX_OUTPUT_DIRECTORY, `Ghostwriter_${toWindowsMsixVersion(version)}_x64.msix`);
}

function packageWindowsMsix(projectRoot: string): void {
  assertWindowsX64Host();
  const mismatches = findApplicationVersionMismatches(projectRoot);
  if (mismatches.length > 0) {
    throw new Error(`Application version metadata is inconsistent:\n${mismatches.join("\n")}`);
  }

  const version = readApplicationVersion(projectRoot);
  const layoutRoot = createWindowsMsixLayout(projectRoot, version);
  const msixPath = outputMsixPath(projectRoot, version);
  mkdirSync(join(msixPath, ".."), { recursive: true });
  rmSync(msixPath, { force: true });

  const makeAppx = findMakeAppx();
  runCommand(makeAppx, ["pack", "/d", layoutRoot, "/p", msixPath, "/o"], projectRoot);

  const validationRoot = join(projectRoot, WINDOWS_MSIX_OUTPUT_DIRECTORY, "validation-layout");
  rmSync(validationRoot, { force: true, recursive: true });
  runCommand(makeAppx, ["unpack", "/p", msixPath, "/d", validationRoot, "/o"], projectRoot);
  assertWindowsMsixLayout(validationRoot, version);
  rmSync(validationRoot, { force: true, recursive: true });
  console.log(`Created unsigned Store MSIX: ${msixPath}`);
}

function validateWindowsMsix(projectRoot: string): void {
  assertWindowsX64Host();
  const version = readApplicationVersion(projectRoot);
  assertWindowsMsixLayout(join(projectRoot, WINDOWS_MSIX_LAYOUT_DIRECTORY), version);
  console.log("Windows MSIX layout is valid");
}

export async function runWindowsMsixCli(argv: string[]): Promise<void> {
  const command = argv[2] ?? "package";
  const projectRoot = join(import.meta.dir, "..");
  switch (command) {
    case "package":
      packageWindowsMsix(projectRoot);
      return;
    case "validate":
      validateWindowsMsix(projectRoot);
      return;
    default:
      throw new Error("Usage: bun run scripts/windows-msix.ts <package|validate>");
  }
}

if (import.meta.main) {
  void runWindowsMsixCli(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
