import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  notifyWorkspaceChanged,
  subscribeWorkspaceChanged,
} from "./workspaceChangedNotifier";

const featureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function listSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory);
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      files.push(...listSourceFiles(absolutePath));
      continue;
    }

    if (!/\.(ts|tsx)$/.test(entry) || /\.test\.(ts|tsx)$/.test(entry)) {
      continue;
    }

    files.push(absolutePath);
  }

  return files;
}

describe("workspaceChangedNotifier", () => {
  const unsubscribers: Array<() => void> = [];

  afterEach(() => {
    while (unsubscribers.length > 0) {
      unsubscribers.pop()?.();
    }
  });

  it("notifies subscribed listeners with the workspace root", () => {
    const listener = vi.fn();
    unsubscribers.push(subscribeWorkspaceChanged(listener));

    notifyWorkspaceChanged("/tmp/workspace-a");
    notifyWorkspaceChanged("/tmp/workspace-b");

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, "/tmp/workspace-a");
    expect(listener).toHaveBeenNthCalledWith(2, "/tmp/workspace-b");
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkspaceChanged(listener);
    unsubscribe();

    notifyWorkspaceChanged("/tmp/workspace-a");

    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps file-tree and workspace sources free of ai-agent imports", () => {
    const aiAgentImportPattern =
      /from\s+["'](?:\.\.\/)*ai-agent(?:\/[^"']*)?["']/;
    const offenders: string[] = [];

    for (const featureName of ["file-tree", "workspace"] as const) {
      for (const sourcePath of listSourceFiles(path.join(featureRoot, featureName))) {
        const source = readFileSync(sourcePath, "utf8");
        if (aiAgentImportPattern.test(source)) {
          offenders.push(path.relative(featureRoot, sourcePath));
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
