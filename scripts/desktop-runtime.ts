import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

export type SupportedDesktopTarget = "aarch64-apple-darwin" | "x86_64-pc-windows-msvc";

export type ExecutableArchitecture = "arm64" | "x64";

export type DesktopRuntimeTargetMetadata = {
  bunTarget: string;
  executableArchitecture: ExecutableArchitecture;
  packagedSidecarFileName: string;
  ripgrepArchiveSha256: string;
  ripgrepArchiveUrl: string;
  ripgrepExecutableName: string;
  ripgrepVersion: string;
  sidecarExternalBaseName: string;
  sidecarFileName: string;
  targetTriple: SupportedDesktopTarget;
};

const RIPGREP_VERSION = "15.1.0";
const SIDECAR_ENTRYPOINT = "src/shared/server/standaloneServer.ts";
const SIDECAR_EXTERNAL_BASE_NAME = "ghostwriter-sidecar";

export const desktopRuntimeTarget: Record<
  SupportedDesktopTarget,
  DesktopRuntimeTargetMetadata
> = {
  "aarch64-apple-darwin": {
    bunTarget: "bun-darwin-arm64",
    executableArchitecture: "arm64",
    ripgrepArchiveSha256:
      "378e973289176ca0c6054054ee7f631a065874a352bf43f0fa60ef079b6ba715",
    ripgrepArchiveUrl: `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/ripgrep-${RIPGREP_VERSION}-aarch64-apple-darwin.tar.gz`,
    ripgrepExecutableName: "rg",
    ripgrepVersion: RIPGREP_VERSION,
    sidecarExternalBaseName: SIDECAR_EXTERNAL_BASE_NAME,
    sidecarFileName: "ghostwriter-sidecar-aarch64-apple-darwin",
    packagedSidecarFileName: "ghostwriter-sidecar",
    targetTriple: "aarch64-apple-darwin",
  },
  "x86_64-pc-windows-msvc": {
    bunTarget: "bun-windows-x64",
    executableArchitecture: "x64",
    ripgrepArchiveSha256:
      "124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a",
    ripgrepArchiveUrl: `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/ripgrep-${RIPGREP_VERSION}-x86_64-pc-windows-msvc.zip`,
    ripgrepExecutableName: "rg.exe",
    ripgrepVersion: RIPGREP_VERSION,
    sidecarExternalBaseName: SIDECAR_EXTERNAL_BASE_NAME,
    sidecarFileName: "ghostwriter-sidecar-x86_64-pc-windows-msvc.exe",
    packagedSidecarFileName: "ghostwriter-sidecar.exe",
    targetTriple: "x86_64-pc-windows-msvc",
  },
};

const UNSUPPORTED_TARGET_TRIPLES = [
  "x86_64-apple-darwin",
  "aarch64-pc-windows-msvc",
] as const;

export function detectHostTarget(): SupportedDesktopTarget | null {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "aarch64-apple-darwin";
  }

  if (process.platform === "win32" && process.arch === "x64") {
    return "x86_64-pc-windows-msvc";
  }

  return null;
}

export function assertHostMatchesTarget(target: SupportedDesktopTarget): void {
  const hostTarget = detectHostTarget();
  if (!hostTarget) {
    throw new Error(
      `Unsupported build host ${process.platform}/${process.arch}. Use a native macOS Apple Silicon or Windows x64 runner.`,
    );
  }

  if (hostTarget !== target) {
    throw new Error(
      `Desktop target ${target} requires a native ${hostTarget} runner, not ${process.platform}/${process.arch}.`,
    );
  }
}

export function assertSupportedDesktopTarget(
  target: string,
): asserts target is SupportedDesktopTarget {
  if (UNSUPPORTED_TARGET_TRIPLES.includes(target as (typeof UNSUPPORTED_TARGET_TRIPLES)[number])) {
    throw new Error(`Unsupported desktop target: ${target}`);
  }

  if (!(target in desktopRuntimeTarget)) {
    throw new Error(`Unsupported desktop target: ${target}`);
  }
}

export function detectExecutableArchitecture(
  bytes: Uint8Array,
): ExecutableArchitecture | null {
  if (bytes.length >= 8) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = view.getUint32(0, true);
    if (magic === 0xfeedfacf) {
      const cpuType = view.getUint32(4, true);
      if (cpuType === 0x0100_000c) {
        return "arm64";
      }
      if (cpuType === 0x0100_0007) {
        return "x64";
      }
      return null;
    }
  }

  if (bytes.length >= 0x46 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const peOffset = view.getUint32(0x3c, true);
    if (
      peOffset + 6 <= bytes.length &&
      bytes[peOffset] === 0x50 &&
      bytes[peOffset + 1] === 0x45 &&
      bytes[peOffset + 2] === 0x00 &&
      bytes[peOffset + 3] === 0x00
    ) {
      const machine = view.getUint16(peOffset + 4, true);
      if (machine === 0x8664) {
        return "x64";
      }
      if (machine === 0xaa64) {
        return "arm64";
      }
    }
  }

  return null;
}

const INITIAL_EXECUTABLE_READ_SIZE = 0x40;
const MAX_PE_HEADER_OFFSET = 4096;

async function readExecutablePrefix(filePath: string, length: number): Promise<Uint8Array> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function detectExecutableArchitectureAtPath(
  filePath: string,
): Promise<ExecutableArchitecture | null> {
  const { size: fileSize } = await stat(filePath);

  if (fileSize < 8) {
    return null;
  }

  const initialSize = Math.min(INITIAL_EXECUTABLE_READ_SIZE, fileSize);
  let bytes = await readExecutablePrefix(filePath, initialSize);
  const initialArchitecture = detectExecutableArchitecture(bytes);
  if (initialArchitecture !== null) {
    return initialArchitecture;
  }

  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const peOffset = view.getUint32(0x3c, true);
  if (peOffset > MAX_PE_HEADER_OFFSET) {
    return null;
  }

  const requiredSize = peOffset + 6;
  if (requiredSize > fileSize) {
    return null;
  }

  if (requiredSize > bytes.length) {
    bytes = await readExecutablePrefix(filePath, requiredSize);
  }

  return detectExecutableArchitecture(bytes);
}

export type DesktopRuntimePaths = {
  currentRipgrepPath: string;
  projectRoot: string;
  ripgrepArchivePath: string;
  ripgrepDirectory: string;
  ripgrepExecutablePath: string;
  sidecarDirectory: string;
  sidecarExecutablePath: string;
  tauriRoot: string;
};

export function getDesktopRuntimePaths(
  projectRoot: string,
  target: SupportedDesktopTarget,
): DesktopRuntimePaths {
  const metadata = desktopRuntimeTarget[target];
  const tauriRoot = join(projectRoot, "src-tauri");
  const sidecarDirectory = join(tauriRoot, "runtime-artifacts", "sidecar");
  const ripgrepDirectory = join(tauriRoot, "runtime-artifacts", "ripgrep", target);
  const currentRipgrepDirectory = join(tauriRoot, "runtime-artifacts", "ripgrep", "current");
  const archiveExtension = target === "aarch64-apple-darwin" ? ".tar.gz" : ".zip";

  return {
    currentRipgrepPath: join(currentRipgrepDirectory, metadata.ripgrepExecutableName),
    projectRoot,
    ripgrepArchivePath: join(
      tauriRoot,
      "runtime-artifacts",
      "downloads",
      `ripgrep-${metadata.ripgrepVersion}-${target}${archiveExtension}`,
    ),
    ripgrepDirectory,
    ripgrepExecutablePath: join(ripgrepDirectory, metadata.ripgrepExecutableName),
    sidecarDirectory,
    sidecarExecutablePath: join(sidecarDirectory, metadata.sidecarFileName),
    tauriRoot,
  };
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = Bun.file(filePath).stream();
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    hash.update(value);
  }

  return hash.digest("hex");
}

async function downloadFile(url: string, destination: string): Promise<void> {
  mkdirSync(join(destination, ".."), { recursive: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }

  await pipeline(response.body, createWriteStream(destination));
}

async function extractRipgrepArchive(
  target: SupportedDesktopTarget,
  archivePath: string,
  destinationDirectory: string,
): Promise<void> {
  mkdirSync(destinationDirectory, { recursive: true });
  rmSync(destinationDirectory, { force: true, recursive: true });
  mkdirSync(destinationDirectory, { recursive: true });

  if (target === "aarch64-apple-darwin") {
    const extractDirectory = join(destinationDirectory, "extract");
    mkdirSync(extractDirectory, { recursive: true });
    const result = Bun.spawnSync(["tar", "-xzf", archivePath, "-C", extractDirectory]);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.toString() || "Failed to extract ripgrep archive");
    }

    const extractedRoot = readdirSync(extractDirectory).find((entry) =>
      entry.startsWith("ripgrep-"),
    );
    if (!extractedRoot) {
      throw new Error("ripgrep archive did not contain an expected directory");
    }

    copyFileSync(join(extractDirectory, extractedRoot, "rg"), join(destinationDirectory, "rg"));
    chmodSync(join(destinationDirectory, "rg"), 0o755);
    rmSync(extractDirectory, { force: true, recursive: true });
    return;
  }

  const extractDirectory = join(destinationDirectory, "extract");
  mkdirSync(extractDirectory, { recursive: true });
  const result = Bun.spawnSync([
    "powershell.exe",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${extractDirectory.replace(/'/g, "''")}' -Force`,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString() || "Failed to extract ripgrep archive");
  }

  const extractedRoot = readdirSync(extractDirectory).find((entry) =>
    entry.startsWith("ripgrep-"),
  );
  if (!extractedRoot) {
    throw new Error("ripgrep archive did not contain an expected directory");
  }

  copyFileSync(
    join(extractDirectory, extractedRoot, "rg.exe"),
    join(destinationDirectory, "rg.exe"),
  );
  rmSync(extractDirectory, { force: true, recursive: true });
}

async function validateExecutableAtPath(
  filePath: string,
  expectedArchitecture: ExecutableArchitecture,
  label: string,
): Promise<void> {
  if (!existsSync(filePath)) {
    throw new Error(`${label} is missing: ${filePath}`);
  }

  const architecture = await detectExecutableArchitectureAtPath(filePath);
  if (architecture !== expectedArchitecture) {
    throw new Error(
      `${label} has unexpected architecture ${architecture ?? "unknown"} (expected ${expectedArchitecture})`,
    );
  }
}

export async function validateDesktopArtifacts(
  projectRoot: string,
  target: SupportedDesktopTarget,
): Promise<void> {
  const metadata = desktopRuntimeTarget[target];
  const paths = getDesktopRuntimePaths(projectRoot, target);

  await validateExecutableAtPath(
    paths.sidecarExecutablePath,
    metadata.executableArchitecture,
    "Sidecar executable",
  );
  await validateExecutableAtPath(
    paths.ripgrepExecutablePath,
    metadata.executableArchitecture,
    "Ripgrep executable",
  );
  await validateExecutableAtPath(
    paths.currentRipgrepPath,
    metadata.executableArchitecture,
    "Current ripgrep resource",
  );

  const excludedSidecars = [
    join(paths.sidecarDirectory, "ghostwriter-sidecar-x86_64-apple-darwin"),
    join(paths.sidecarDirectory, "ghostwriter-sidecar-aarch64-pc-windows-msvc.exe"),
  ];
  for (const excludedSidecar of excludedSidecars) {
    if (existsSync(excludedSidecar)) {
      throw new Error(`Excluded desktop artifact must not be present: ${excludedSidecar}`);
    }
  }

  const excludedRipgrepTargets = [
    {
      executableName: "rg",
      targetTriple: "x86_64-apple-darwin",
    },
    {
      executableName: "rg.exe",
      targetTriple: "aarch64-pc-windows-msvc",
    },
  ] as const;

  for (const excluded of excludedRipgrepTargets) {
    const excludedRipgrep = join(
      paths.tauriRoot,
      "runtime-artifacts",
      "ripgrep",
      excluded.targetTriple,
      excluded.executableName,
    );
    if (existsSync(excludedRipgrep)) {
      throw new Error(`Excluded desktop artifact must not be present: ${excludedRipgrep}`);
    }
  }
}

export function buildSidecarCompileCommand(
  target: SupportedDesktopTarget,
  outputPath: string,
): string[] {
  const metadata = desktopRuntimeTarget[target];
  const command = [
    "bun",
    "build",
    "--compile",
    "--minify",
    SIDECAR_ENTRYPOINT,
    "--outfile",
    outputPath,
    "--target",
    metadata.bunTarget,
  ];

  if (target === "x86_64-pc-windows-msvc") {
    command.push("--windows-hide-console");
  }

  return command;
}

async function compileSidecar(
  projectRoot: string,
  target: SupportedDesktopTarget,
  outputPath: string,
): Promise<void> {
  mkdirSync(join(outputPath, ".."), { recursive: true });

  const result = Bun.spawnSync(buildSidecarCompileCommand(target, outputPath), {
    cwd: projectRoot,
    stderr: "inherit",
    stdout: "inherit",
  });

  if (result.exitCode !== 0) {
    throw new Error(`Failed to compile desktop sidecar for ${target}`);
  }
}

async function prepareRipgrep(
  projectRoot: string,
  target: SupportedDesktopTarget,
): Promise<void> {
  const metadata = desktopRuntimeTarget[target];
  const paths = getDesktopRuntimePaths(projectRoot, target);

  if (!existsSync(paths.ripgrepArchivePath)) {
    await downloadFile(metadata.ripgrepArchiveUrl, paths.ripgrepArchivePath);
  }

  const archiveDigest = await sha256File(paths.ripgrepArchivePath);
  if (archiveDigest !== metadata.ripgrepArchiveSha256) {
    throw new Error(
      `Ripgrep archive checksum mismatch for ${target}: expected ${metadata.ripgrepArchiveSha256}, got ${archiveDigest}`,
    );
  }

  await extractRipgrepArchive(target, paths.ripgrepArchivePath, paths.ripgrepDirectory);
  mkdirSync(join(paths.currentRipgrepPath, ".."), { recursive: true });
  copyFileSync(paths.ripgrepExecutablePath, paths.currentRipgrepPath);
  if (target === "aarch64-apple-darwin") {
    chmodSync(paths.currentRipgrepPath, 0o755);
  }
}

export async function prepareDesktopRuntime(
  projectRoot: string,
  target: SupportedDesktopTarget,
): Promise<void> {
  assertHostMatchesTarget(target);
  const paths = getDesktopRuntimePaths(projectRoot, target);
  mkdirSync(paths.sidecarDirectory, { recursive: true });
  await compileSidecar(projectRoot, target, paths.sidecarExecutablePath);
  await prepareRipgrep(projectRoot, target);
  await validateDesktopArtifacts(projectRoot, target);
}

function parseTargetArg(args: string[]): SupportedDesktopTarget {
  const targetIndex = args.findIndex((arg) => arg === "--target");
  const target = targetIndex >= 0 ? args[targetIndex + 1] : undefined;
  if (!target) {
    throw new Error(
      "Missing required --target <aarch64-apple-darwin|x86_64-pc-windows-msvc>",
    );
  }

  assertSupportedDesktopTarget(target);
  return target;
}

async function runDesktopBuild(
  projectRoot: string,
  target: SupportedDesktopTarget,
  noBundle = false,
): Promise<void> {
  assertHostMatchesTarget(target);
  await prepareDesktopRuntime(projectRoot, target);

  const bundleResult = Bun.spawnSync(
    ["tauri", "build", "--target", target, ...(noBundle ? ["--no-bundle"] : [])],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        GHOSTWRITER_DESKTOP_TARGET: target,
      },
      stderr: "inherit",
      stdout: "inherit",
    },
  );

  if (bundleResult.exitCode !== 0) {
    throw new Error(`Tauri build failed for ${target}`);
  }
}

export async function runDesktopRuntimeCli(argv: string[]): Promise<void> {
  const [, , command, ...args] = argv;
  const projectRoot = join(import.meta.dir, "..");

  switch (command) {
    case "prepare": {
      const target = parseTargetArg(args);
      await prepareDesktopRuntime(projectRoot, target);
      return;
    }
    case "validate": {
      const target = parseTargetArg(args);
      await validateDesktopArtifacts(projectRoot, target);
      return;
    }
    case "build": {
      const target = parseTargetArg(args);
      const noBundle = args.includes("--no-bundle");
      const webBuild = Bun.spawnSync(["bun", "run", "build:desktop:web"], {
        cwd: projectRoot,
        stderr: "inherit",
        stdout: "inherit",
      });
      if (webBuild.exitCode !== 0) {
        throw new Error("Desktop web build failed");
      }
      await runDesktopBuild(projectRoot, target, noBundle);
      return;
    }
    case "prepare-for-tauri-build": {
      const target = process.env.GHOSTWRITER_DESKTOP_TARGET;
      if (!target) {
        throw new Error(
          "GHOSTWRITER_DESKTOP_TARGET is required for Tauri packaging (aarch64-apple-darwin or x86_64-pc-windows-msvc)",
        );
      }
      assertSupportedDesktopTarget(target);
      assertHostMatchesTarget(target);
      await prepareDesktopRuntime(projectRoot, target);
      return;
    }
    default:
      throw new Error(
        "Usage: bun run scripts/desktop-runtime.ts <prepare|validate|build|prepare-for-tauri-build> --target <triple>",
      );
  }
}

if (import.meta.main) {
  void runDesktopRuntimeCli(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
