import { z } from "zod";

export const MAX_DROPPED_TEXT_FILE_COUNT = 5;
export const MAX_DROPPED_TEXT_FILE_BYTES = 1024 * 1024;
export const MAX_DROPPED_TEXT_FILES_TOTAL_BYTES = 2 * 1024 * 1024;

export type StrictUtf8DecodeFailureReason = "binary" | "invalid-utf8" | "round-trip";

export type StrictUtf8DecodeResult =
  | { ok: true; content: string }
  | { ok: false; reason: StrictUtf8DecodeFailureReason };

export function isSafeDroppedFileName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("\0")
  );
}

export const droppedTextFileNameSchema = z
  .string()
  .min(1)
  .refine(isSafeDroppedFileName, "Dropped file name must be a safe basename");

export function isWithinDroppedTextFileCountLimit(count: number): boolean {
  return count <= MAX_DROPPED_TEXT_FILE_COUNT;
}

export function isWithinDroppedTextFileByteLimit(sizeBytes: number): boolean {
  return sizeBytes <= MAX_DROPPED_TEXT_FILE_BYTES;
}

export function isWithinDroppedTextFilesTotalByteLimit(totalBytes: number): boolean {
  return totalBytes <= MAX_DROPPED_TEXT_FILES_TOTAL_BYTES;
}

function areEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

export function decodeStrictUtf8Bytes(bytes: Uint8Array): StrictUtf8DecodeResult {
  if (bytes.includes(0)) {
    return { ok: false, reason: "binary" };
  }

  let content: string;
  try {
    content = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    return { ok: false, reason: "invalid-utf8" };
  }

  if (!areEqualBytes(bytes, new TextEncoder().encode(content))) {
    return { ok: false, reason: "round-trip" };
  }

  return { ok: true, content };
}

export function strictUtf8DecodeErrorMessage(reason: StrictUtf8DecodeFailureReason): string {
  switch (reason) {
    case "binary":
      return "Dropped file appears to be binary";
    case "invalid-utf8":
      return "Dropped file is not valid UTF-8 text";
    case "round-trip":
      return "Dropped file UTF-8 bytes do not round-trip";
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}
