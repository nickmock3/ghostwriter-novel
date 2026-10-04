import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join, posix, relative } from "node:path";
import { desktopRuntimeTarget, type SupportedDesktopTarget } from "./desktop-runtime";
import { readApplicationVersion } from "./app-version";

export type PreviewArtifact = {
  fileName: string;
  relativePath: string;
  sourcePath: string;
};

function assertSupportedTarget(target: string): SupportedDesktopTarget {
  if (target in desktopRuntimeTarget) {
    return target as SupportedDesktopTarget;
  }
  throw new Error(
    `Unsupported desktop preview target: ${target}. Use aarch64-apple-darwin or x86_64-pc-windows-msvc.`,
  );
}

function findBundleRoot(projectRoot: string, target: SupportedDesktopTarget): string {
  const bundleRoot = join(
    projectRoot,
    "src-tauri",
    "target",
    target,
    "release",
    "bundle",
  );
  if (!existsSync(bundleRoot)) {
    throw new Error(`Desktop bundle directory not found: ${bundleRoot}`);
  }
  return bundleRoot;
}

function findPrimaryArtifact(
  projectRoot: string,
  target: SupportedDesktopTarget,
  previewVersion: string,
): PreviewArtifact {
  const bundleRoot = findBundleRoot(projectRoot, target);

  if (target === "aarch64-apple-darwin") {
    const dmgDir = join(bundleRoot, "dmg");
    const dmgFiles = existsSync(dmgDir)
      ? readdirSync(dmgDir).filter((name) => name.endsWith(".dmg"))
      : [];
    if (dmgFiles.length > 0) {
      const fileName = dmgFiles[0];
      return {
        fileName,
        relativePath: posix.join("aarch64-apple-darwin", fileName),
        sourcePath: join(dmgDir, fileName),
      };
    }

    const macosDir = join(bundleRoot, "macos");
    const appBundles = existsSync(macosDir)
      ? readdirSync(macosDir).filter((name) => name.endsWith(".app"))
      : [];
    if (appBundles.length === 0) {
      throw new Error(`No macOS preview artifact found under ${bundleRoot}`);
    }

    const fileName = `${appBundles[0].replace(/\.app$/, "")}-${previewVersion}-aarch64-apple-darwin.app.tar.gz`;
    return {
      fileName,
      relativePath: posix.join("aarch64-apple-darwin", fileName),
      sourcePath: join(macosDir, appBundles[0]),
    };
  }

  const msiDir = join(bundleRoot, "msi");
  const msiFiles = existsSync(msiDir)
    ? readdirSync(msiDir).filter((name) => name.endsWith(".msi"))
    : [];
  if (msiFiles.length === 0) {
    throw new Error(`No Windows MSI preview installer found under ${bundleRoot}`);
  }

  const fileName = `Ghostwriter-${previewVersion}-x86_64-pc-windows-msvc.msi`;
  return {
    fileName,
    relativePath: posix.join("x86_64-pc-windows-msvc", fileName),
    sourcePath: join(msiDir, msiFiles[0]),
  };
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

export async function packageDesktopPreviewArtifacts(
  projectRoot: string,
  target: SupportedDesktopTarget,
  outputRoot = join(projectRoot, "dist", "desktop-preview"),
): Promise<{ artifact: PreviewArtifact; outputDir: string; sha256SumsPath: string }> {
  const previewVersion = readApplicationVersion(projectRoot);
  const artifact = findPrimaryArtifact(projectRoot, target, previewVersion);
  const outputDir = join(outputRoot, target);
  mkdirSync(outputDir, { recursive: true });

  const outputPath = join(outputDir, artifact.fileName);
  if (artifact.sourcePath.endsWith(".app")) {
    const archiveResult = spawnSync(
      "tar",
      ["-czf", outputPath, "-C", join(artifact.sourcePath, ".."), basename(artifact.sourcePath)],
      {
        stderr: "inherit",
        stdout: "inherit",
      },
    );
    if (archiveResult.status !== 0) {
      throw new Error(`Failed to archive macOS app bundle: ${artifact.sourcePath}`);
    }
  } else {
    copyFileSync(artifact.sourcePath, outputPath);
  }

  const digest = await sha256File(outputPath);
  const sha256SumsPath = join(outputDir, "SHA256SUMS");
  writeFileSync(sha256SumsPath, `${digest}  ${artifact.fileName}\n`, "utf8");

  return { artifact: { ...artifact, sourcePath: outputPath }, outputDir, sha256SumsPath };
}

export function getR2ObjectKeys(version: string, artifact: PreviewArtifact): {
  versionedKey: string;
  latestKey: string;
  versionedChecksumKey: string;
  latestChecksumKey: string;
} {
  const targetSegment = artifact.relativePath.split("/")[0];
  const fileName = posix.basename(artifact.relativePath);
  const versionPrefix = `ghostwriter/preview/versions/${version}/${targetSegment}`;
  const latestPrefix = `ghostwriter/preview/latest/${targetSegment}`;

  return {
    versionedKey: `${versionPrefix}/${fileName}`,
    latestKey: `${latestPrefix}/${fileName}`,
    versionedChecksumKey: `ghostwriter/preview/versions/${version}/SHA256SUMS`,
    latestChecksumKey: "ghostwriter/preview/latest/SHA256SUMS",
  };
}

async function runCli(argv: string[]): Promise<void> {
  const targetArgIndex = argv.findIndex((arg) => arg === "--target");
  const target = assertSupportedTarget(argv[targetArgIndex + 1] ?? "");
  const projectRoot = join(import.meta.dir, "..");
  const previewVersion = readApplicationVersion(projectRoot);
  const result = await packageDesktopPreviewArtifacts(projectRoot, target);

  console.log(`Packaged ${result.artifact.fileName}`);
  console.log(`Output: ${relative(projectRoot, result.outputDir)}`);
  console.log(`SHA256SUMS: ${relative(projectRoot, result.sha256SumsPath)}`);

  const keys = getR2ObjectKeys(previewVersion, result.artifact);
  console.log(`R2 versioned key: ${keys.versionedKey}`);
  console.log(`R2 latest key: ${keys.latestKey}`);
}

if (import.meta.main) {
  void runCli(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
