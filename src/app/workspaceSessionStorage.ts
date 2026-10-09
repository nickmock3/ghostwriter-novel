import { readStoredWorkspaceRoot } from "../features/workspace/workspaceSessionStorage";

export type WorkMode = "chat" | "editor";

function workModeStorageKey(workspaceRoot: string): string {
  return `ghostwriter:last-work-mode:${workspaceRoot}`;
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
