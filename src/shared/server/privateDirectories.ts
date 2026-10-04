import { realpath } from "node:fs/promises";
import path from "node:path";

const directories = new Set<string>();
export function protectPrivateDirectory(directory: string): void {
  directories.add(path.resolve(directory));
}
async function canonicalPath(directory: string): Promise<string> {
  try { return await realpath(directory); }
  catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    const parent = path.dirname(directory);
    if (parent === directory) throw error;
    return path.join(await canonicalPath(parent), path.basename(directory));
  }
}
function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
export async function assertOutsidePrivateDirectories(realWorkspaceRoot: string): Promise<void> {
  for (const directory of directories) {
    const realDirectory = await canonicalPath(directory);
    if (contains(realWorkspaceRoot, realDirectory) || contains(realDirectory, realWorkspaceRoot)) {
      throw new Error("Workspace overlaps private application data. Choose a separate workspace or application data directory.");
    }
  }
}
