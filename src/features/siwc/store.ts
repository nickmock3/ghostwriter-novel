// Adapted from ChatGPT Plan Playground (MIT); see LICENSE.
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { type Credentials, credentialsSchema } from "./credentials";
import { BoundaryError, type Result, safely } from "./result";
import { checkWindowsCredentialPermissions } from "./windowsCredentialPermissions";
import {
  maxProtectedCredentialBytes,
  protectWindowsCredentialData,
  unprotectWindowsCredentialData,
} from "./windowsCredentialProtection";

const maxCredentialBytes = 4 * 1024 * 1024;
const protectedCredentialsSchema = z.strictObject({
  format: z.literal("windows-dpapi-v1"),
  ciphertext: z.string().min(1),
});

type StoredCredentials = {
  state: Credentials;
  needsMigration: boolean;
};

const hasCode = (value: unknown, code: string) =>
  value instanceof Error && "code" in value && value.code === code;
const assertOwned = (stat: { uid: number; mode: number }, mode: number) => {
  if (stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== mode)
    throw new BoundaryError("unsafe_storage");
};

export const createCredentialStore = (directory: string) => {
  const path = join(directory, "credentials.json");
  const lock = join(directory, "operation.lock");
  const isWindows = process.platform === "win32";
  const maxFileBytes = isWindows ? maxProtectedCredentialBytes : maxCredentialBytes;
  const ensureDirectory = async () => {
    if (isWindows) {
      await checkWindowsCredentialPermissions(directory, { ensure: true });
      return;
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new BoundaryError("unsafe_storage");
    assertOwned(stat, 0o700);
  };
  const read = async (): Promise<StoredCredentials | null> => {
    try {
      const directoryStat = await lstat(directory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
        throw new BoundaryError("unsafe_storage");
      if (!isWindows) assertOwned(directoryStat, 0o700);
      // WindowsのO_NOFOLLOWだけに依存せず、junction/symlinkを開く前に拒否する。
      const pathStat = await lstat(path).catch(async (error: unknown) => {
        // 空の保存先でもACLを検証し、unsafeなdirectoryを未登録扱いしない。
        if (hasCode(error, "ENOENT") && isWindows) await checkWindowsCredentialPermissions(directory);
        throw error;
      });
      if (!pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.nlink !== 1)
        throw new BoundaryError("unsafe_storage");
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let contents: Buffer;
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxFileBytes)
          throw new BoundaryError("unsafe_storage");
        if (stat.dev !== pathStat.dev || stat.ino !== pathStat.ino)
          throw new BoundaryError("unsafe_storage");
        if (isWindows) await checkWindowsCredentialPermissions(directory, { file: path });
        else assertOwned(stat, 0o600);
        contents = await file.readFile();
      } finally {
        await file.close();
      }
      if (contents.length > maxFileBytes) throw new BoundaryError("unsafe_storage");
      let data: unknown = JSON.parse(contents.toString("utf8"));
      const protectedFile = isWindows && typeof data === "object" && data !== null && "format" in data;
      if (protectedFile) {
        const envelope = protectedCredentialsSchema.safeParse(data);
        if (!envelope.success) throw new BoundaryError("storage");
        const plaintext = await unprotectWindowsCredentialData(envelope.data.ciphertext);
        if (plaintext.length > maxCredentialBytes) throw new BoundaryError("unsafe_storage");
        data = JSON.parse(plaintext.toString("utf8"));
      } else if (contents.length > maxCredentialBytes) {
        throw new BoundaryError("unsafe_storage");
      }
      const parsed = credentialsSchema.safeParse(data);
      if (!parsed.success) throw new BoundaryError("storage");
      return { state: parsed.data, needsMigration: isWindows && !protectedFile };
    } catch (error: unknown) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
  };
  const write = async (state: Credentials) => {
    const parsed = credentialsSchema.safeParse(state);
    if (!parsed.success) throw new BoundaryError("storage");
    const plaintext = `${JSON.stringify(parsed.data)}\n`;
    if (Buffer.byteLength(plaintext, "utf8") > maxCredentialBytes) throw new BoundaryError("storage");
    const contents = isWindows
      ? `${JSON.stringify({
          format: "windows-dpapi-v1",
          ciphertext: await protectWindowsCredentialData(plaintext),
        })}\n`
      : plaintext;
    if (Buffer.byteLength(contents, "utf8") > maxFileBytes) throw new BoundaryError("storage");
    const temporary = join(directory, `.credentials-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        // 新規fileは保護済みdirectoryの本人限定ACLを継承。秘密を書き込む前に再確認する。
        if (isWindows) await checkWindowsCredentialPermissions(directory, { file: temporary });
        await file.writeFile(contents, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, path);
      // Windowsはdirectory handleのfsyncを提供しない。fileはrename前にflush済み。
      if (isWindows) return;
      const dir = await open(directory, constants.O_RDONLY);
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    } finally {
      await unlink(temporary).catch(() => {});
    }
  };
  const withLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    await ensureDirectory();
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch (error: unknown) {
      if (hasCode(error, "EEXIST")) throw new BoundaryError("busy");
      throw error;
    }
    try {
      return await operation();
    } finally {
      await rmdir(lock);
    }
  };
  const readAndMigrate = async () => {
    // 初回読取りからロック取得までに、別プロセスが資格情報を更新した可能性がある。
    const current = await read();
    if (current?.needsMigration) await write(current.state);
    return current?.state ?? null;
  };
  return {
    read: (): Promise<Result<Credentials | null>> =>
      safely(async () => {
        const current = await read();
        if (current?.needsMigration) return withLock(readAndMigrate);
        return current?.state ?? null;
      }, "storage"),
    update: <T>(
      change: (
        state: Credentials,
        checkpoint: (state: Credentials) => Promise<void>,
      ) => Promise<{ state: Credentials; value: T }>,
    ): Promise<Result<T>> =>
      safely(
        () => withLock(async () => {
          let state = await readAndMigrate();
          if (!state) {
            state = {
              version: 1,
              hostId: `urn:uuid:${randomUUID()}`,
              accounts: [],
              activeAccountId: null,
            };
            // ホストIDは認可開始前に確定する。失敗したログインでも維持する。
            await write(state);
          }
          // refreshの送信前・更新直後を同じlock内で永続化できる。
          const changed = await change(state, write);
          await write(changed.state);
          return changed.value;
        }),
        "storage",
      ),
  };
};
export type CredentialStore = ReturnType<typeof createCredentialStore>;
