import { assertOutsidePrivateDirectories } from "../../shared/server/privateDirectories";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export async function resolveWorkspaceRoot(workspacePath: string): Promise<string> {
  if (!path.isAbsolute(workspacePath)) {
    throw new Error("Workspace path must be absolute");
  }

  const realWorkspacePath = await realpath(workspacePath);
  const stats = await stat(realWorkspacePath);

  if (!stats.isDirectory()) {
    throw new Error("Workspace path must be a directory");
  }

  await assertOutsidePrivateDirectories(realWorkspacePath);
  return realWorkspacePath;
}
