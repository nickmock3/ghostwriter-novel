import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useEditorSessionContext } from "../app/EditorSessionContext";
import { ModeLoadingStatus } from "../app/ModeLoadingStatus";
import { useWorkspaceContext } from "../app/WorkspaceContext";
import { ReaderPage } from "../features/reader/ReaderPage";

export const Route = createFileRoute("/reader")({
  component: ReaderRoutePage,
});

function ReaderRoutePage() {
  const { isWorkspaceRestoring, workspaceRoot } = useWorkspaceContext();
  const { requestEditorSelectionJump, setSelectedPath } = useEditorSessionContext();
  const navigate = useNavigate();
  const handleOpenEditorSelection = useCallback(
    (request: {
      end: number;
      path: string;
      sourceExcerpt: string;
      start: number;
    }) => {
      requestEditorSelectionJump(request);
      setSelectedPath(request.path);
      void navigate({ to: "/editor" });
    },
    [navigate, requestEditorSelectionJump, setSelectedPath],
  );

  if (!workspaceRoot && isWorkspaceRestoring) {
    return <ModeLoadingStatus />;
  }

  return (
    <ReaderPage
      onOpenEditorSelection={handleOpenEditorSelection}
      workspaceRoot={workspaceRoot}
    />
  );
}
