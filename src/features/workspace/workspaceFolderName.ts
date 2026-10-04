export function getWorkspaceFolderName(workspaceRoot: string): string {
  const trimmed = workspaceRoot.replace(/[\\/]+$/, "");
  const segments = trimmed.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? workspaceRoot;
}
