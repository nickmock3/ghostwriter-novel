import { describe, expect, it, vi } from "vitest";
import { readDroppedEditorText } from "./droppedEditorTextFiles";

function droppedFile(name: string, bytes: Uint8Array): File {
  return {
    arrayBuffer: vi.fn(async () => bytes.buffer),
    name,
  } as unknown as File;
}

describe("readDroppedEditorText", () => {
  it("decodes every UTF-8 file in DataTransfer order", async () => {
    await expect(
      readDroppedEditorText([
        droppedFile("A.txt", new TextEncoder().encode("A本文")),
        droppedFile("B.txt", new TextEncoder().encode("B本文")),
      ]),
    ).resolves.toBe("A本文B本文");
  });

  it("rejects invalid UTF-8 and null bytes", async () => {
    await expect(
      readDroppedEditorText([droppedFile("invalid.txt", Uint8Array.from([0xff]))]),
    ).rejects.toThrow("UTF-8");
    await expect(
      readDroppedEditorText([
        droppedFile("binary.dat", Uint8Array.from([0x61, 0x00, 0x62])),
      ]),
    ).rejects.toThrow("テキストファイル");
  });

  it("enforces file count, per-file size, and aggregate size before insertion", async () => {
    const smallFile = () => droppedFile("small.txt", Uint8Array.from([0x61]));
    await expect(
      readDroppedEditorText(Array.from({ length: 6 }, smallFile)),
    ).rejects.toThrow("5件");
    await expect(
      readDroppedEditorText([
        droppedFile("large.txt", new Uint8Array(1024 * 1024 + 1).fill(0x61)),
      ]),
    ).rejects.toThrow("1 MiB");
    await expect(
      readDroppedEditorText([
        droppedFile("A.txt", new Uint8Array(700 * 1024).fill(0x61)),
        droppedFile("B.txt", new Uint8Array(700 * 1024).fill(0x62)),
        droppedFile("C.txt", new Uint8Array(700 * 1024).fill(0x63)),
      ]),
    ).rejects.toThrow("合計サイズ");
  });
});
