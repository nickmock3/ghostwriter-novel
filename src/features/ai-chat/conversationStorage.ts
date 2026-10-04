import { randomUUID } from "node:crypto";
import fs, { mkdir, readdir, rmdir, unlink } from "node:fs/promises";
import path from "node:path";

const queues = new Map<string, Promise<void>>();

// The process queue preserves local ordering. The disk lock fails closed for other
// processes. Contention has a bounded wait; an
// abandoned lock is never stolen, because its writer could still be alive.
export async function withConversationFileLock<T>(file: string, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(file) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  queues.set(file, current);
  await previous;
  const lock = `${file}.lock`;
  let acquired = false;
  try {
    for (let attempt = 0; !acquired; attempt += 1) {
      try {
        await mkdir(lock);
        acquired = true;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        if (attempt >= 100) {
          throw new Error("Conversation storage is busy or was interrupted; retry after the writer stops, or remove its stale lock with all app processes stopped");
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    // Only the lock owner can have live temporary files for this conversation.
    const prefix = `${path.basename(file)}.`;
    for (const name of await readdir(path.dirname(file))) {
      if (name.startsWith(prefix) && name.endsWith(".tmp")) {
        await unlink(path.join(path.dirname(file), name));
      }
    }
    return await action();
  } finally {
    try {
      if (acquired) {
        await rmdir(lock);
      }
    } finally {
      release();
      if (queues.get(file) === current) queues.delete(file);
    }
  }
}

export async function replaceConversationJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    // Never unlink the destination as a replacement fallback (not even on Windows).
    await fs.rename(temporary, file);
  } finally {
    try {
      await handle?.close();
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      });
    }
  }
}
