import { readFileSync } from "node:fs";
import { basename, join, posix } from "node:path";
import { getR2ObjectKeys, type PreviewArtifact } from "./package-desktop-preview";
import { readApplicationVersion } from "./app-version";
import { putR2Object, readR2UploadEnv, readRequiredEnv, type R2UploadEnv } from "./r2-put-object";

type UploadEnv = R2UploadEnv & {
  publicBaseUrl: string;
};

function readUploadEnv(): UploadEnv {
  return {
    ...readR2UploadEnv(),
    publicBaseUrl: readRequiredEnv("R2_PUBLIC_BASE_URL").replace(/\/$/, ""),
  };
}

async function putObject(
  env: UploadEnv,
  objectKey: string,
  filePath: string,
  contentType: string,
): Promise<void> {
  await putR2Object({ contentType, env, filePath, objectKey });
}

export async function uploadDesktopPreviewToR2(options: {
  artifact: PreviewArtifact;
  sha256SumsPath: string;
  env?: UploadEnv;
  projectRoot?: string;
}): Promise<void> {
  const env = options.env ?? readUploadEnv();
  const projectRoot = options.projectRoot ?? join(import.meta.dir, "..");
  const version = readApplicationVersion(projectRoot);
  const keys = getR2ObjectKeys(version, options.artifact);

  await putObject(env, keys.versionedKey, options.artifact.sourcePath, "application/octet-stream");
  await putObject(env, keys.latestKey, options.artifact.sourcePath, "application/octet-stream");
  await putObject(env, keys.versionedChecksumKey, options.sha256SumsPath, "text/plain");
  await putObject(env, keys.latestChecksumKey, options.sha256SumsPath, "text/plain");

  console.log(`Uploaded ${basename(options.artifact.sourcePath)}`);
  console.log(`Versioned URL: ${env.publicBaseUrl}/${keys.versionedKey}`);
  console.log(`Latest URL: ${env.publicBaseUrl}/${keys.latestKey}`);
}

async function runCli(argv: string[]): Promise<void> {
  const targetArgIndex = argv.findIndex((arg) => arg === "--target");
  const target = argv[targetArgIndex + 1];
  if (!target) {
    throw new Error("Usage: bun run scripts/upload-desktop-preview-to-r2.ts --target <triple>");
  }

  const projectRoot = join(import.meta.dir, "..");
  const outputDir = join(projectRoot, "dist", "desktop-preview", target);
  const sha256SumsPath = join(outputDir, "SHA256SUMS");
  const artifactFile = readFileSync(sha256SumsPath, "utf8")
    .trim()
    .split(/\s+/, 2)[1];
  if (!artifactFile) {
    throw new Error(`Could not read artifact file name from ${sha256SumsPath}`);
  }

  const artifact: PreviewArtifact = {
    fileName: artifactFile,
    relativePath: posix.join(target, artifactFile),
    sourcePath: join(outputDir, artifactFile),
  };

  await uploadDesktopPreviewToR2({ artifact, sha256SumsPath });
}

if (import.meta.main) {
  void runCli(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
