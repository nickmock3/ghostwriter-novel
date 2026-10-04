import { useEffect, useState } from "react";
import type { DroppedTextFileInput, DroppedTextFileStatus } from "./chatConversationClient";

export type DroppedTextFilesRequestStatus = "idle" | "sending" | "accepted" | "failed";

export type PendingDroppedTextFile = DroppedTextFileInput & {
  id: string;
  sizeBytes: number;
};

export function useChatDroppedTextFileState() {
  const [droppedTextFiles, setDroppedTextFiles] = useState<PendingDroppedTextFile[]>([]);
  const [droppedTextFilesRequestStatus, setDroppedTextFilesRequestStatus] =
    useState<DroppedTextFilesRequestStatus>("idle");
  const [droppedTextFileResults, setDroppedTextFileResults] = useState<DroppedTextFileStatus[]>([]);

  useEffect(() => {
    if (droppedTextFiles.length > 0 && droppedTextFilesRequestStatus === "accepted") {
      setDroppedTextFilesRequestStatus("idle");
    }
  }, [droppedTextFiles.length, droppedTextFilesRequestStatus]);

  function clearDroppedTextFiles() {
    setDroppedTextFiles([]);
    setDroppedTextFilesRequestStatus("idle");
    setDroppedTextFileResults([]);
  }

  return {
    clearDroppedTextFiles,
    droppedTextFileResults,
    droppedTextFiles,
    droppedTextFilesRequestStatus,
    setDroppedTextFileResults,
    setDroppedTextFiles,
    setDroppedTextFilesRequestStatus,
  };
}
