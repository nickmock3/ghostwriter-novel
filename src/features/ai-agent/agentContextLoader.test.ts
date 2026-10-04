import { describe, expect, it, vi } from "vitest";
import { createAgentContextLoader } from "./agentContextLoader";

describe("createAgentContextLoader", () => {
  it("keeps optional context failures as undefined while preserving required workspace instructions", async () => {
    const loadWorkspaceInstructions = vi.fn(async () => ({
      content: "Follow local rules.",
      hash: "hash",
      loaded: true as const,
      loadedAt: "2026-01-01T00:00:00.000Z",
      path: "AGENTS.md" as const,
    }));
    const loadWorkspaceStructureContext = vi.fn(async () => {
      throw new Error("tree unavailable");
    });
    const loadRecentTextFilesContext = vi.fn(async () => {
      throw new Error("recent files unavailable");
    });
    const deriveChapterReferenceContext = vi.fn(() => ({
      commonReferenceDirectories: ["設定/"],
      currentFilePath: "novel/chapter-1.txt",
      currentFileRole: "workspace-file" as const,
      referenceCandidatePaths: ["novel/plot.md"],
    }));

    const loader = createAgentContextLoader({
      deriveChapterCompletionSummaryContext: vi.fn(() => undefined),
      deriveChapterReferenceContext,
      loadRecentTextFilesContext,
      loadWorkspaceInstructions,
      loadWorkspaceStructureContext,
      optionalContextFailuresAreIgnored: true,
    });

    await expect(loader.load({ currentFilePath: "novel/chapter-1.txt", workspaceRoot: "/tmp/workspace" }))
      .resolves.toEqual({
        chapterCompletionSummaryContext: undefined,
        chapterReferenceContext: {
          commonReferenceDirectories: ["設定/"],
          currentFilePath: "novel/chapter-1.txt",
          currentFileRole: "workspace-file",
          referenceCandidatePaths: ["novel/plot.md"],
        },
        recentTextFilesContext: undefined,
        workspaceInstructions: {
          content: "Follow local rules.",
          hash: "hash",
          loaded: true,
          loadedAt: "2026-01-01T00:00:00.000Z",
          path: "AGENTS.md",
        },
        workspaceStructureContext: undefined,
      });
    expect(loadWorkspaceInstructions).toHaveBeenCalledWith({ workspaceRoot: "/tmp/workspace" });
  });

  it("propagates explicitly injected optional context and instruction loader failures", async () => {
    const structureFailure = new Error("tree unavailable");
    const structureLoader = createAgentContextLoader({
      loadRecentTextFilesContext: vi.fn(async () => ({
        files: [], generatedAt: "2026-01-01T00:00:00.000Z", maxFiles: 10, omittedFileCount: 0, truncated: false,
      })),
      loadWorkspaceInstructions: vi.fn(async () => ({
        loaded: false as const,
        loadedAt: "2026-01-01T00:00:00.000Z",
        path: "AGENTS.md" as const,
        skippedReason: "missing" as const,
      })),
      loadWorkspaceStructureContext: vi.fn(async () => { throw structureFailure; }),
    });
    await expect(structureLoader.load({ workspaceRoot: "/tmp/workspace" })).rejects.toBe(structureFailure);

    const instructionFailure = new Error("instructions unavailable");
    const instructionLoader = createAgentContextLoader({
      loadWorkspaceInstructions: vi.fn(async () => { throw instructionFailure; }),
    });
    await expect(instructionLoader.load({ workspaceRoot: "/tmp/workspace" })).rejects.toBe(instructionFailure);
  });
});
