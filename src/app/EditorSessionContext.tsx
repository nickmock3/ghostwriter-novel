import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { AppliedEditProposal } from "../features/ai-chat/ChatPane";
import type { FileSession } from "../features/editor/useFileSession";

export type EditorSelectionJumpRequest = {
  end: number;
  id: number;
  path: string;
  sourceExcerpt: string;
  start: number;
};

export type NewEditorSelectionJumpRequest = Omit<EditorSelectionJumpRequest, "id">;

export type EditorSessionContextValue = {
  chatAppendRequest: { id: number; text: string } | null;
  consumeEditorSelectionJumpRequest: (id: number) => void;
  dirtyPaths: string[];
  editorSelectionJumpRequest: EditorSelectionJumpRequest | null;
  editorRefreshKey: number;
  fileSession: FileSession;
  fileTreeRefreshKey: number;
  handleAppliedEdit: (proposal: AppliedEditProposal) => void;
  handleDirtyStateChange: (path: string | null, isDirty: boolean) => void;
  handleFileOperation: (
    operation:
      | { kind: "directory" | "file"; operation: "create"; path: string }
      | { operation: "delete"; path: string }
      | { newPath: string; operation: "rename"; path: string },
  ) => void;
  handleSendEditorSelectionToChat: (text: string) => void;
  requestEditorSelectionJump: (request: NewEditorSelectionJumpRequest) => void;
  selectedPath: string | null;
  setDirtyPaths: Dispatch<SetStateAction<string[]>>;
  setSelectedPath: (path: string | null) => void;
};

export const EditorSessionContext = createContext<EditorSessionContextValue | null>(null);

export function useEditorSessionContext() {
  const value = useContext(EditorSessionContext);

  if (!value) {
    throw new Error("useEditorSessionContext must be used inside App.");
  }

  return value;
}
