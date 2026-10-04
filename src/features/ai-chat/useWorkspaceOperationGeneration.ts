import { useRef } from "react";
import {
  createWorkspaceOperationGeneration,
  type WorkspaceOperationGeneration,
} from "./chatConversationControllerHelpers";

export function useWorkspaceOperationGeneration(): WorkspaceOperationGeneration {
  const generationRef = useRef<WorkspaceOperationGeneration | null>(null);
  if (generationRef.current === null) {
    generationRef.current = createWorkspaceOperationGeneration();
  }
  return generationRef.current;
}
