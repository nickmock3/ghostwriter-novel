import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import {
  MAX_DROPPED_TEXT_FILE_COUNT,
  decodeStrictUtf8Bytes,
  isSafeDroppedFileName,
  isWithinDroppedTextFileByteLimit,
  isWithinDroppedTextFileCountLimit,
  isWithinDroppedTextFilesTotalByteLimit,
} from "./droppedTextFileContracts";
import type { PendingDroppedTextFile } from "./useChatDroppedTextFileState";

function hasDroppedFiles(event: DragEvent<HTMLElement>): boolean {
  return (event.dataTransfer.files?.length ?? 0) > 0;
}

function canonicalBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

export function formatDroppedTextFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  return `${(sizeBytes / 1024).toFixed(1)} KiB`;
}

type UseChatDroppedTextFilesParams = {
  canAttach: boolean;
  droppedTextFiles: PendingDroppedTextFile[];
  isLoading: boolean;
  setDroppedTextFiles: (files: PendingDroppedTextFile[]) => void;
};

export function useChatDroppedTextFiles({
  canAttach,
  droppedTextFiles,
  isLoading,
  setDroppedTextFiles,
}: UseChatDroppedTextFilesParams) {
  const droppedTextFilesRef = useRef(droppedTextFiles);
  const pendingDroppedTextFilesRef = useRef<Promise<void>>(Promise.resolve());
  const [droppedTextFileError, setDroppedTextFileError] = useState<string | null>(null);

  useEffect(() => {
    droppedTextFilesRef.current = droppedTextFiles;
  }, [droppedTextFiles]);

  function queueDroppedTextFiles(files: File[]) {
    const next = pendingDroppedTextFilesRef.current.then(() => handleDroppedTextFiles(files));
    pendingDroppedTextFilesRef.current = next;
    void next;
  }

  async function handleDroppedTextFiles(files: File[]) {
    if (!canAttach) {
      setDroppedTextFileError(
        "添付テキストファイルはチャットモードの標準モデルでのみ利用できます。",
      );
      return;
    }

    if (isLoading) {
      setDroppedTextFileError("AI応答の生成中はテキストファイルを添付できません。");
      return;
    }

    if (
      !isWithinDroppedTextFileCountLimit(droppedTextFilesRef.current.length + files.length)
    ) {
      setDroppedTextFileError(`添付できるテキストファイルは最大${MAX_DROPPED_TEXT_FILE_COUNT}件です。`);
      return;
    }

    try {
      const attachments = await Promise.all(
        files.map(async (file) => {
          if (!isSafeDroppedFileName(file.name)) {
            throw new Error("安全なファイル名のテキストファイルだけを添付できます。");
          }

          const bytes = new Uint8Array(await file.arrayBuffer());
          if (!isWithinDroppedTextFileByteLimit(bytes.byteLength)) {
            throw new Error("添付できるテキストファイルは1件あたり1 MiBまでです。");
          }

          const decoded = decodeStrictUtf8Bytes(bytes);
          if (!decoded.ok) {
            switch (decoded.reason) {
              case "binary":
                throw new Error("テキストとして読めないファイルは添付できません。");
              case "invalid-utf8":
                throw new Error("UTF-8テキストファイルだけを添付できます。");
              case "round-trip":
                throw new Error("UTF-8として元の内容を保持できないファイルは添付できません。");
              default: {
                const _exhaustive: never = decoded.reason;
                throw new Error(_exhaustive);
              }
            }
          }

          return {
            contentBase64: canonicalBase64(bytes),
            id: crypto.randomUUID(),
            name: file.name,
            sizeBytes: bytes.byteLength,
          };
        }),
      );
      const totalBytes = droppedTextFilesRef.current.reduce((total, file) => total + file.sizeBytes, 0) +
        attachments.reduce((total, file) => total + file.sizeBytes, 0);
      if (!isWithinDroppedTextFilesTotalByteLimit(totalBytes)) {
        throw new Error("添付テキストファイルの合計は2 MiBまでです。");
      }

      const nextFiles = [...droppedTextFilesRef.current, ...attachments];
      droppedTextFilesRef.current = nextFiles;
      setDroppedTextFiles(nextFiles);
      setDroppedTextFileError(null);
    } catch (nextError) {
      setDroppedTextFileError(
        nextError instanceof Error ? nextError.message : "テキストファイルを添付できませんでした。",
      );
    }
  }

  function removeDroppedTextFile(droppedFileId: string) {
    const nextFiles = droppedTextFilesRef.current.filter((file) => file.id !== droppedFileId);
    droppedTextFilesRef.current = nextFiles;
    setDroppedTextFiles(nextFiles);
    setDroppedTextFileError(null);
  }

  function handleComposerDragOver(event: DragEvent<HTMLTextAreaElement>) {
    if (hasDroppedFiles(event)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = canAttach ? "copy" : "none";
      return;
    }

    if (event.dataTransfer.types.includes("text/plain")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function handleConversationFileDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasDroppedFiles(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = canAttach ? "copy" : "none";
  }

  function handleConversationFileDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasDroppedFiles(event)) {
      return;
    }

    event.preventDefault();
    queueDroppedTextFiles(Array.from(event.dataTransfer.files));
  }

  function handleComposerFileDrop(event: DragEvent<HTMLTextAreaElement>) {
    if (!hasDroppedFiles(event)) {
      return false;
    }

    event.preventDefault();
    queueDroppedTextFiles(Array.from(event.dataTransfer.files));
    return true;
  }

  async function waitForPendingDroppedTextFiles() {
    await pendingDroppedTextFilesRef.current;
  }

  async function handleChatSubmit(
    event: FormEvent<HTMLFormElement>,
    onSubmit: (
      event: FormEvent<HTMLFormElement>,
      files: PendingDroppedTextFile[],
    ) => void | Promise<void>,
  ) {
    event.preventDefault();
    await waitForPendingDroppedTextFiles();
    void onSubmit(event, droppedTextFilesRef.current);
  }

  return {
    droppedTextFileError,
    handleChatSubmit,
    handleComposerDragOver,
    handleComposerFileDrop,
    handleConversationFileDragOver,
    handleConversationFileDrop,
    removeDroppedTextFile,
  };
}
