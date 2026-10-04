const LAST_WORKSPACE_ROOT_KEY = "ghostwriter:last-workspace-root";
const LEGACY_LAST_WORKSPACE_ROOT_KEY = "simple-ai-agent:last-workspace-root";

export type WorkMode = "chat" | "editor";

function workModeStorageKey(workspaceRoot: string): string {
  return `ghostwriter:last-work-mode:${workspaceRoot}`;
}

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

export function readStoredWorkMode(workspaceRoot: string): WorkMode | null {
  try {
    const value = window.localStorage.getItem(workModeStorageKey(workspaceRoot));
    if (value === "chat" || value === "editor") {
      return value;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeStoredWorkMode(workspaceRoot: string, mode: WorkMode) {
  try {
    window.localStorage.setItem(workModeStorageKey(workspaceRoot), mode);
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}

export function resolveStartupWorkModeRoute(): "/chat" | "/editor" {
  const storedWorkspaceRoot = readStoredWorkspaceRoot();
  if (!storedWorkspaceRoot) {
    return "/chat";
  }

  const storedMode = readStoredWorkMode(storedWorkspaceRoot);
  return storedMode === "editor" ? "/editor" : "/chat";
}
