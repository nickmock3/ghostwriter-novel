import { createContext, useContext } from "react";

export type WorkspaceContextValue = {
  dismissStartGuide: () => void;
  handleStartGuideIdeaConsult: () => void;
  showStartGuide: boolean;
  workspaceRoot: string | null;
};

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspaceContext() {
  const value = useContext(WorkspaceContext);

  if (!value) {
    throw new Error("useWorkspaceContext must be used inside App.");
  }

  return value;
}
