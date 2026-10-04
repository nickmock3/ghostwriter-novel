import { describe, expect, it } from "vitest";
import {
  MAX_DROPPED_TEXT_FILE_BYTES,
  MAX_DROPPED_TEXT_FILE_COUNT,
  MAX_DROPPED_TEXT_FILES_TOTAL_BYTES,
  decodeStrictUtf8Bytes,
  isSafeDroppedFileName,
  isWithinDroppedTextFileByteLimit,
  isWithinDroppedTextFileCountLimit,
  isWithinDroppedTextFilesTotalByteLimit,
} from "./droppedTextFileContracts";

describe("droppedTextFileContracts", () => {
  it("defines shared count and size limits in one place", () => {
    expect(MAX_DROPPED_TEXT_FILE_COUNT).toBe(5);
    expect(MAX_DROPPED_TEXT_FILE_BYTES).toBe(1024 * 1024);
    expect(MAX_DROPPED_TEXT_FILES_TOTAL_BYTES).toBe(2 * 1024 * 1024);
  });

  it("accepts safe basenames and rejects path-like or empty names", () => {
    expect(isSafeDroppedFileName("メモ.txt")).toBe(true);
    expect(isSafeDroppedFileName("")).toBe(false);
    expect(isSafeDroppedFileName(".")).toBe(false);
    expect(isSafeDroppedFileName("..")).toBe(false);
    expect(isSafeDroppedFileName("../escape.txt")).toBe(false);
    expect(isSafeDroppedFileName("dir/file.txt")).toBe(false);
    expect(isSafeDroppedFileName("dir\\file.txt")).toBe(false);
    expect(isSafeDroppedFileName("bad\0name.txt")).toBe(false);
  });

  it("enforces shared count and size limit helpers", () => {
    expect(isWithinDroppedTextFileCountLimit(5)).toBe(true);
    expect(isWithinDroppedTextFileCountLimit(6)).toBe(false);
    expect(isWithinDroppedTextFileByteLimit(MAX_DROPPED_TEXT_FILE_BYTES)).toBe(true);
    expect(isWithinDroppedTextFileByteLimit(MAX_DROPPED_TEXT_FILE_BYTES + 1)).toBe(false);
    expect(isWithinDroppedTextFilesTotalByteLimit(MAX_DROPPED_TEXT_FILES_TOTAL_BYTES)).toBe(true);
    expect(
      isWithinDroppedTextFilesTotalByteLimit(MAX_DROPPED_TEXT_FILES_TOTAL_BYTES + 1),
    ).toBe(false);
  });

  it("decodes strict UTF-8 text and rejects binary, invalid, or non-round-trip bytes", () => {
    expect(decodeStrictUtf8Bytes(new TextEncoder().encode("本文"))).toEqual({
      ok: true,
      content: "本文",
    });
    expect(decodeStrictUtf8Bytes(new Uint8Array())).toEqual({ ok: true, content: "" });

    expect(decodeStrictUtf8Bytes(new Uint8Array([0x61, 0x00, 0x62]))).toEqual({
      ok: false,
      reason: "binary",
    });
    expect(decodeStrictUtf8Bytes(new Uint8Array([0xff]))).toEqual({
      ok: false,
      reason: "invalid-utf8",
    });
    // UTF-8 BOM is preserved as U+FEFF by the current TextDecoder and round-trips.
    expect(decodeStrictUtf8Bytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toEqual({
      ok: true,
      content: "\ufeffa",
    });
  });
});
