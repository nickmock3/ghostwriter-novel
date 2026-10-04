import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, opendir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolveWorkspaceRoot } from "../workspace/workspacePaths";
import {
  MAX_DROPPED_TEXT_FILE_BYTES,
  MAX_DROPPED_TEXT_FILE_COUNT,
  MAX_DROPPED_TEXT_FILES_TOTAL_BYTES,
  decodeStrictUtf8Bytes,
  droppedTextFileNameSchema,
  isWithinDroppedTextFileByteLimit,
  isWithinDroppedTextFilesTotalByteLimit,
  strictUtf8DecodeErrorMessage,
} from "./droppedTextFileContracts";

const MAX_DROPPED_FILE_READ_LINES = 2000;
const DEFAULT_DROPPED_FILE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRED_REQUEST_SWEEP_LIMIT = 100;
const MAX_EXPIRED_REQUEST_SWEEP_LIMIT = 1000;

const scopeKeySchema = z.string().regex(/^[a-f0-9]{24}$/);
const requestIdSchema = z.string().uuid();

const droppedTextFileInputSchema = z
  .object({
    contentBase64: z.string(),
    name: droppedTextFileNameSchema,
  })
  .strict();
const droppedTextFileContextSchema = z
  .object({
    conversationKey: scopeKeySchema,
    dataRoot: z.string().min(1),
    expiresAt: z.string().datetime(),
    requestId: requestIdSchema,
    workspaceId: scopeKeySchema,
  })
  .strict();

const droppedTextFileManifestEntrySchema = z
  .object({
    id: requestIdSchema,
    name: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

const droppedTextFileManifestSchema = z
  .object({
    conversationKey: scopeKeySchema,
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    files: z.array(droppedTextFileManifestEntrySchema),
    requestId: requestIdSchema,
    workspaceId: scopeKeySchema,
  })
  .strict();

export type DroppedTextFileInput = z.infer<typeof droppedTextFileInputSchema>;
export type DroppedTextFileContext = z.infer<typeof droppedTextFileContextSchema>;
export type DroppedTextFileMetadata = z.infer<typeof droppedTextFileManifestEntrySchema>;

export type ReadDroppedTextFileResult = {
  content: string;
  name: string;
  sizeBytes: number;
  totalLines: number;
  truncated: boolean;
};

type ValidatedDroppedTextFile = DroppedTextFileInput & {
  bytes: Buffer;
  content: string;
};

function decodeCanonicalBase64(contentBase64: string): Buffer {
  if (
    contentBase64.length % 4 !== 0 ||
    (contentBase64 !== "" && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64))
  ) {
    throw new Error("Dropped file content must use canonical Base64");
  }

  const bytes = Buffer.from(contentBase64, "base64");
  if (bytes.toString("base64") !== contentBase64) {
    throw new Error("Dropped file content must use canonical Base64");
  }
  return bytes;
}

function decodeStrictUtf8(bytes: Buffer): string {
  const decoded = decodeStrictUtf8Bytes(bytes);
  if (!decoded.ok) {
    throw new Error(strictUtf8DecodeErrorMessage(decoded.reason));
  }
  return decoded.content;
}

function validateDroppedTextFile(input: DroppedTextFileInput): ValidatedDroppedTextFile {
  const bytes = decodeCanonicalBase64(input.contentBase64);
  if (!isWithinDroppedTextFileByteLimit(bytes.byteLength)) {
    throw new Error(`Dropped file is too large (max ${MAX_DROPPED_TEXT_FILE_BYTES} bytes)`);
  }

  return {
    ...input,
    bytes,
    content: decodeStrictUtf8(bytes),
  };
}

export const droppedTextFileInputsSchema = z
  .array(droppedTextFileInputSchema)
  .max(MAX_DROPPED_TEXT_FILE_COUNT)
  .superRefine((files, context) => {
    let totalBytes = 0;
    for (const [index, file] of files.entries()) {
      try {
        const validated = validateDroppedTextFile(file);
        totalBytes += validated.bytes.byteLength;
      } catch (error) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: error instanceof Error ? error.message : "Invalid dropped text file",
          path: [index],
        });
      }
    }

    if (!isWithinDroppedTextFilesTotalByteLimit(totalBytes)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Dropped files are too large in total (max ${MAX_DROPPED_TEXT_FILES_TOTAL_BYTES} bytes)`,
      });
    }
  });
function scopeKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function droppedTextFilesRoot(dataRoot: string): string {
  return path.join(path.resolve(dataRoot), "dropped-text-files");
}

function workspaceDirectory(dataRoot: string, workspaceId: string): string {
  return path.join(droppedTextFilesRoot(dataRoot), scopeKeySchema.parse(workspaceId));
}

function conversationDirectory(input: {
  conversationKey: string;
  dataRoot: string;
  workspaceId: string;
}): string {
  return path.join(
    workspaceDirectory(input.dataRoot, input.workspaceId),
    scopeKeySchema.parse(input.conversationKey),
  );
}

function requestDirectory(context: DroppedTextFileContext): string {
  const parsed = droppedTextFileContextSchema.parse(context);
  return path.join(
    conversationDirectory(parsed),
    parsed.requestId,
  );
}

function manifestPath(context: DroppedTextFileContext): string {
  return path.join(requestDirectory(context), "manifest.json");
}

function contentPath(context: DroppedTextFileContext, droppedFileId: string): string {
  const parsedId = requestIdSchema.parse(droppedFileId);
  return path.join(requestDirectory(context), `${parsedId}.bin`);
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function isRealDirectory(directory: string): Promise<boolean> {
  try {
    const stats = await lstat(directory);
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  }
}

async function ensureRealDirectory(directory: string): Promise<void> {
  try {
    await mkdir(directory);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      (error as NodeJS.ErrnoException).code !== "EEXIST"
    ) {
      throw error;
    }
  }

  if (!(await isRealDirectory(directory))) {
    throw new Error("Dropped text file storage path is not a real directory");
  }
}

async function createRequestDirectory(context: DroppedTextFileContext): Promise<string> {
  const parsed = droppedTextFileContextSchema.parse(context);
  const root = droppedTextFilesRoot(parsed.dataRoot);
  const workspace = workspaceDirectory(parsed.dataRoot, parsed.workspaceId);
  const conversation = conversationDirectory(parsed);
  const request = requestDirectory(parsed);

  await ensureRealDirectory(path.resolve(parsed.dataRoot));
  await ensureRealDirectory(root);
  await ensureRealDirectory(workspace);
  await ensureRealDirectory(conversation);
  await ensureRealDirectory(request);
  return request;
}

async function removeRequestDirectory(context: DroppedTextFileContext): Promise<void> {
  const parsed = droppedTextFileContextSchema.parse(context);
  const root = droppedTextFilesRoot(parsed.dataRoot);
  const workspace = workspaceDirectory(parsed.dataRoot, parsed.workspaceId);
  const conversation = conversationDirectory(parsed);
  const request = requestDirectory(parsed);

  for (const parent of [root, workspace, conversation]) {
    if (!(await isRealDirectory(parent))) {
      return;
    }
  }

  try {
    const stats = await lstat(request);
    if (stats.isSymbolicLink()) {
      await unlink(request);
      return;
    }
    if (!stats.isDirectory()) {
      return;
    }
    await rm(request, { force: true, recursive: true });
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }
}

type DirectoryScanBudget = {
  remainingEntries: number;
};

async function readBoundedDirectoryNames(input: {
  budget: DirectoryScanBudget;
  directory: string;
  nameSchema: z.ZodType<string>;
}): Promise<string[]> {
  if (input.budget.remainingEntries <= 0 || !(await isRealDirectory(input.directory))) {
    return [];
  }

  const names: string[] = [];
  let directory;
  try {
    directory = await opendir(input.directory);
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }
    throw error;
  }
  try {
    while (input.budget.remainingEntries > 0) {
      const entry = await directory.read();
      if (!entry) {
        break;
      }
      input.budget.remainingEntries -= 1;
      if (
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        input.nameSchema.safeParse(entry.name).success
      ) {
        names.push(entry.name);
      }
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
  return names;
}

async function readSweepManifest(input: {
  conversationKey: string;
  requestDirectory: string;
  requestId: string;
  workspaceId: string;
}): Promise<z.infer<typeof droppedTextFileManifestSchema> | null> {
  const candidatePath = path.join(input.requestDirectory, "manifest.json");
  try {
    const stats = await lstat(candidatePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      return null;
    }
    const parsed = droppedTextFileManifestSchema.safeParse(
      JSON.parse(await readFile(candidatePath, "utf8")),
    );
    if (
      !parsed.success ||
      parsed.data.workspaceId !== input.workspaceId ||
      parsed.data.conversationKey !== input.conversationKey ||
      parsed.data.requestId !== input.requestId
    ) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function nowIso(now: Date | undefined): string {
  return (now ?? new Date()).toISOString();
}

async function readManifest(
  context: DroppedTextFileContext,
): Promise<z.infer<typeof droppedTextFileManifestSchema>> {
  const parsedContext = droppedTextFileContextSchema.parse(context);
  if (Date.parse(parsedContext.expiresAt) <= Date.now()) {
    await cleanupDroppedTextFiles(parsedContext);
    throw new Error("Dropped text file is not found or is no longer available");
  }

  try {
    const manifest = droppedTextFileManifestSchema.parse(
      JSON.parse(await readFile(manifestPath(parsedContext), "utf8")),
    );
    if (
      manifest.workspaceId !== parsedContext.workspaceId ||
      manifest.conversationKey !== parsedContext.conversationKey ||
      manifest.requestId !== parsedContext.requestId ||
      manifest.expiresAt !== parsedContext.expiresAt
    ) {
      throw new Error("Dropped text file request scope does not match");
    }
    return manifest;
  } catch (error) {
    if (error instanceof Error && error.message === "Dropped text file request scope does not match") {
      throw error;
    }
    throw new Error("Dropped text file is not found or is no longer available");
  }
}

function truncateLines(content: string): {
  content: string;
  totalLines: number;
  truncated: boolean;
} {
  const lines = content.split(/\r\n|\n|\r/);
  if (lines.length <= MAX_DROPPED_FILE_READ_LINES) {
    return {
      content,
      totalLines: lines.length,
      truncated: false,
    };
  }

  return {
    content: [
      ...lines.slice(0, MAX_DROPPED_FILE_READ_LINES),
      `[truncated after ${MAX_DROPPED_FILE_READ_LINES} lines]`,
    ].join("\n"),
    totalLines: lines.length,
    truncated: true,
  };
}

async function resolveDroppedTextFile(input: {
  context: DroppedTextFileContext;
  droppedFileId: string;
}): Promise<{ bytes: Buffer; content: string; metadata: DroppedTextFileMetadata }> {
  const manifest = await readManifest(input.context);
  const metadata = manifest.files.find((file) => file.id === input.droppedFileId);
  if (!metadata) {
    throw new Error("Dropped text file is not found or is no longer available");
  }

  try {
    const bytes = await readFile(contentPath(input.context, metadata.id));
    if (bytes.byteLength !== metadata.sizeBytes) {
      throw new Error("Dropped text file size does not match");
    }
    return {
      bytes,
      content: decodeStrictUtf8(bytes),
      metadata,
    };
  } catch {
    throw new Error("Dropped text file is not found or is no longer available");
  }
}

export async function stageDroppedTextFiles(input: {
  conversationId: string;
  dataRoot: string;
  files: readonly DroppedTextFileInput[];
  now?: Date;
  ttlMs?: number;
  workspaceRoot: string;
}): Promise<{ context: DroppedTextFileContext; files: DroppedTextFileMetadata[] }> {
  const parsedFiles = droppedTextFileInputsSchema.parse(input.files);
  const validatedFiles = parsedFiles.map(validateDroppedTextFile);
  const resolvedWorkspaceRoot = await resolveWorkspaceRoot(input.workspaceRoot);
  const createdAt = nowIso(input.now);
  const ttlMs = input.ttlMs ?? DEFAULT_DROPPED_FILE_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error("Dropped file TTL must be a positive integer");
  }

  await cleanupExpiredDroppedTextFiles({
    dataRoot: input.dataRoot,
    maxRequests: DEFAULT_EXPIRED_REQUEST_SWEEP_LIMIT,
    now: input.now ?? new Date(),
  });

  const context = droppedTextFileContextSchema.parse({
    conversationKey: scopeKey(input.conversationId),
    dataRoot: path.resolve(input.dataRoot),
    expiresAt: new Date(Date.parse(createdAt) + ttlMs).toISOString(),
    requestId: randomUUID(),
    workspaceId: scopeKey(resolvedWorkspaceRoot),
  });
  const files = validatedFiles.map((file) => ({
    id: randomUUID(),
    name: file.name,
    sizeBytes: file.bytes.byteLength,
  }));

  try {
    await createRequestDirectory(context);
    await Promise.all(
      validatedFiles.map((file, index) =>
        writeFile(contentPath(context, files[index]!.id), file.bytes, { flag: "wx" }),
      ),
    );
    await writeFile(
      manifestPath(context),
      `${JSON.stringify({
        conversationKey: context.conversationKey,
        createdAt,
        expiresAt: context.expiresAt,
        files,
        requestId: context.requestId,
        workspaceId: context.workspaceId,
      })}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  } catch (error) {
    await removeRequestDirectory(context);
    throw error;
  }

  return { context, files };
}

export async function readDroppedTextFile(input: {
  context: DroppedTextFileContext;
  droppedFileId: string;
}): Promise<ReadDroppedTextFileResult> {
  const file = await resolveDroppedTextFile(input);
  return {
    name: file.metadata.name,
    sizeBytes: file.metadata.sizeBytes,
    ...truncateLines(file.content),
  };
}

export async function readDroppedTextFileForPlacement(input: {
  context: DroppedTextFileContext;
  droppedFileId: string;
}): Promise<{ bytes: Buffer; content: string; metadata: DroppedTextFileMetadata }> {
  return resolveDroppedTextFile(input);
}

export async function consumeDroppedTextFile(input: {
  context: DroppedTextFileContext;
  droppedFileId: string;
}): Promise<void> {
  const manifest = await readManifest(input.context);
  const metadata = manifest.files.find((file) => file.id === input.droppedFileId);
  if (!metadata) {
    throw new Error("Dropped text file is not found or is no longer available");
  }

  const remainingFiles = manifest.files.filter((file) => file.id !== metadata.id);
  await rm(contentPath(input.context, metadata.id), { force: true });
  if (remainingFiles.length === 0) {
    await cleanupDroppedTextFiles(input.context);
    return;
  }

  await writeFile(
    manifestPath(input.context),
    `${JSON.stringify({ ...manifest, files: remainingFiles })}\n`,
    "utf8",
  );
}

export async function cleanupDroppedTextFiles(context: DroppedTextFileContext): Promise<void> {
  await removeRequestDirectory(context);
}

export async function cleanupExpiredDroppedTextFiles(input: {
  dataRoot: string;
  maxRequests: number;
  now: Date;
}): Promise<void> {
  if (
    !Number.isSafeInteger(input.maxRequests) ||
    input.maxRequests < 0 ||
    input.maxRequests > MAX_EXPIRED_REQUEST_SWEEP_LIMIT
  ) {
    throw new Error(
      `Expired dropped file sweep limit must be between 0 and ${MAX_EXPIRED_REQUEST_SWEEP_LIMIT}`,
    );
  }
  if (input.maxRequests === 0) {
    return;
  }

  const resolvedDataRoot = path.resolve(input.dataRoot);
  const root = droppedTextFilesRoot(resolvedDataRoot);
  const budget: DirectoryScanBudget = {
    remainingEntries: input.maxRequests * 3,
  };
  let scannedRequests = 0;
  const workspaceIds = await readBoundedDirectoryNames({
    budget,
    directory: root,
    nameSchema: scopeKeySchema,
  });

  for (const workspaceId of workspaceIds) {
    const conversationKeys = await readBoundedDirectoryNames({
      budget,
      directory: workspaceDirectory(resolvedDataRoot, workspaceId),
      nameSchema: scopeKeySchema,
    });
    for (const conversationKey of conversationKeys) {
      const conversation = conversationDirectory({
        conversationKey,
        dataRoot: resolvedDataRoot,
        workspaceId,
      });
      const requestIds = await readBoundedDirectoryNames({
        budget,
        directory: conversation,
        nameSchema: requestIdSchema,
      });
      for (const requestId of requestIds) {
        if (scannedRequests >= input.maxRequests) {
          return;
        }
        scannedRequests += 1;
        const contextBase = {
          conversationKey,
          dataRoot: resolvedDataRoot,
          requestId,
          workspaceId,
        };
        const request = requestDirectory({
          ...contextBase,
          expiresAt: input.now.toISOString(),
        });
        const manifest = await readSweepManifest({
          conversationKey,
          requestDirectory: request,
          requestId,
          workspaceId,
        });
        if (!manifest || Date.parse(manifest.expiresAt) <= input.now.getTime()) {
          await removeRequestDirectory({
            ...contextBase,
            expiresAt: manifest?.expiresAt ?? input.now.toISOString(),
          });
        }
      }
    }
  }
}

export async function cleanupDroppedTextFilesForConversation(input: {
  conversationId: string;
  dataRoot: string;
  workspaceRoot: string;
}): Promise<void> {
  const resolvedWorkspaceRoot = await resolveWorkspaceRoot(input.workspaceRoot);
  const resolvedDataRoot = path.resolve(input.dataRoot);
  const workspaceId = scopeKey(resolvedWorkspaceRoot);
  const conversationKey = scopeKey(input.conversationId);
  const root = droppedTextFilesRoot(resolvedDataRoot);
  const workspace = workspaceDirectory(resolvedDataRoot, workspaceId);
  const conversation = conversationDirectory({
    conversationKey,
    dataRoot: resolvedDataRoot,
    workspaceId,
  });

  for (const parent of [root, workspace]) {
    if (!(await isRealDirectory(parent))) {
      return;
    }
  }

  try {
    const stats = await lstat(conversation);
    if (stats.isSymbolicLink()) {
      await unlink(conversation);
      return;
    }
    if (!stats.isDirectory()) {
      return;
    }
    await rm(conversation, { force: true, recursive: true });
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }
}
