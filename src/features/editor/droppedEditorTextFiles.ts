const MAX_DROPPED_FILE_COUNT = 5;
const MAX_DROPPED_FILE_BYTES = 1024 * 1024;
const MAX_DROPPED_FILES_TOTAL_BYTES = 2 * 1024 * 1024;

export async function readDroppedEditorText(files: File[]): Promise<string> {
  if (files.length === 0) {
    throw new Error("追加するファイルを読み取れませんでした");
  }
  if (files.length > MAX_DROPPED_FILE_COUNT) {
    throw new Error(`一度に追加できるファイルは${MAX_DROPPED_FILE_COUNT}件までです`);
  }

  const decodedFiles: string[] = [];
  let totalBytes = 0;
  for (const file of files) {
    if (file.size > MAX_DROPPED_FILE_BYTES) {
      throw new Error(`${file.name} は1 MiBを超えているため追加できません`);
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      throw new Error(`${file.name} を読み取れませんでした`);
    }
    if (bytes.byteLength > MAX_DROPPED_FILE_BYTES) {
      throw new Error(`${file.name} は1 MiBを超えているため追加できません`);
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_DROPPED_FILES_TOTAL_BYTES) {
      throw new Error("追加するファイルの合計サイズは2 MiBまでです");
    }
    if (bytes.includes(0)) {
      throw new Error(`${file.name} はテキストファイルとして読み込めません`);
    }
    try {
      decodedFiles.push(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
      );
    } catch {
      throw new Error(`${file.name} はUTF-8テキストではありません`);
    }
  }

  return decodedFiles.join("");
}
