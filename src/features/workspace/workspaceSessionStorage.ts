const LAST_WORKSPACE_ROOT_KEY = "ghostwriter:last-workspace-root";
const LEGACY_LAST_WORKSPACE_ROOT_KEY = "simple-ai-agent:last-workspace-root";

export function readStoredWorkspaceRoot(): string | null {
  try {
    return (
      window.localStorage.getItem(LAST_WORKSPACE_ROOT_KEY) ??
      window.localStorage.getItem(LEGACY_LAST_WORKSPACE_ROOT_KEY)
    );
  } catch {
    return null;
  }
}

export function writeStoredWorkspaceRoot(workspaceRoot: string) {
  try {
    window.localStorage.setItem(LAST_WORKSPACE_ROOT_KEY, workspaceRoot);
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}

export function clearStoredWorkspaceRoot() {
  try {
    window.localStorage.removeItem(LAST_WORKSPACE_ROOT_KEY);
    window.localStorage.removeItem(LEGACY_LAST_WORKSPACE_ROOT_KEY);
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}
