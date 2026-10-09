import { FiLoader } from "react-icons/fi";
import { WORKSPACE_RESTORING_MESSAGE } from "../features/workspace/useWorkspaceSession";
import { useWorkspaceContext } from "./WorkspaceContext";

// Shared by route pending states and modes waiting for workspace restore, so neither shows a blank view.
export function ModeLoadingStatus() {
  const { isWorkspaceRestoring } = useWorkspaceContext();

  return (
    <div className="mode-loading-status" role="status">
      <FiLoader aria-hidden="true" className="mode-loading-spinner" focusable="false" />
      <span>{isWorkspaceRestoring ? WORKSPACE_RESTORING_MESSAGE : "画面を読み込んでいます…"}</span>
    </div>
  );
}
