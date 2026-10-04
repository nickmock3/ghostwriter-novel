export type WorkspaceChangedListener = (workspaceRoot: string) => void;

const workspaceChangedListeners = new Set<WorkspaceChangedListener>();

export function subscribeWorkspaceChanged(
  listener: WorkspaceChangedListener,
): () => void {
  workspaceChangedListeners.add(listener);

  return () => {
    workspaceChangedListeners.delete(listener);
  };
}

export function notifyWorkspaceChanged(workspaceRoot: string): void {
  for (const listener of workspaceChangedListeners) {
    listener(workspaceRoot);
  }
}
