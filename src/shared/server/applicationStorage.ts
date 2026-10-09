import { resolveServerDataRoot } from "./runtimeConfig";

export function defaultServerDataRoot() {
  return resolveServerDataRoot({ cwd: process.cwd(), env: process.env });
}

export const APPLICATION_DATA_STORAGE_UNAVAILABLE =
  "Application data storage is unavailable" as const;

const APPLICATION_STORAGE_ERROR_CODES = new Set([
  "EACCES",
  "EDQUOT",
  "EMFILE",
  "ENFILE",
  "EPERM",
  "EROFS",
  "ENOSPC",
  "ENOTDIR",
  "EISDIR",
  "EEXIST",
]);

export function isApplicationStorageError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" && APPLICATION_STORAGE_ERROR_CODES.has(code);
}

export function applicationStorageUnavailableBody(): { message: string } {
  return { message: APPLICATION_DATA_STORAGE_UNAVAILABLE };
}
