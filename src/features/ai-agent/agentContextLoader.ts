import {
  loadRecentTextFilesContext as defaultLoadRecentTextFilesContext,
  type LoadRecentTextFilesContextOptions,
  type RecentTextFilesContext,
} from "./recentTextFilesContext";
import {
  getWorkspaceStructureContext,
  type LoadWorkspaceStructureContextOptions,
  type WorkspaceStructureContext,
} from "./workspaceStructureContext";
import {
  deriveChapterCompletionSummaryContext,
  deriveChapterReferenceContext,
  loadWorkspaceAgentsInstructions,
  type ChapterCompletionSummaryContext,
  type ChapterReferenceContext,
  type LoadWorkspaceAgentsInstructionsOptions,
  type WorkspaceInstructions,
} from "./workspaceInstructions";

export type AgentContext = {
  chapterCompletionSummaryContext: ChapterCompletionSummaryContext | undefined;
  chapterReferenceContext: ChapterReferenceContext | undefined;
  recentTextFilesContext: RecentTextFilesContext | undefined;
  workspaceInstructions: WorkspaceInstructions;
  workspaceStructureContext: WorkspaceStructureContext | undefined;
};

type OptionalFailures = boolean | { recentTextFiles?: boolean; workspaceStructure?: boolean };
export type CreateAgentContextLoaderOptions = {
  deriveChapterCompletionSummaryContext?: (currentFilePath: string | null | undefined) => ChapterCompletionSummaryContext | undefined;
  deriveChapterReferenceContext?: (currentFilePath: string | null | undefined) => ChapterReferenceContext | undefined;
  loadRecentTextFilesContext?: (options: LoadRecentTextFilesContextOptions) => Promise<RecentTextFilesContext>;
  loadWorkspaceInstructions?: (options: LoadWorkspaceAgentsInstructionsOptions) => Promise<WorkspaceInstructions>;
  loadWorkspaceStructureContext?: (options: LoadWorkspaceStructureContextOptions) => Promise<WorkspaceStructureContext>;
  optionalContextFailuresAreIgnored?: OptionalFailures;
};

function ignoresFailure(option: OptionalFailures | undefined, kind: "recentTextFiles" | "workspaceStructure"): boolean {
  return option === true || (typeof option === "object" && option?.[kind] === true);
}

export function createAgentContextLoader(options: CreateAgentContextLoaderOptions = {}) {
  const loadInstructions = options.loadWorkspaceInstructions ?? loadWorkspaceAgentsInstructions;
  const loadStructure = options.loadWorkspaceStructureContext ?? getWorkspaceStructureContext;
  const loadRecent = options.loadRecentTextFilesContext ?? defaultLoadRecentTextFilesContext;
  const chapterReference = options.deriveChapterReferenceContext ?? deriveChapterReferenceContext;
  const chapterCompletion = options.deriveChapterCompletionSummaryContext ?? deriveChapterCompletionSummaryContext;
  return {
    async load(input: { currentFilePath?: string | null; workspaceRoot: string }): Promise<AgentContext> {
      const workspaceInstructions = await loadInstructions({ workspaceRoot: input.workspaceRoot });
      const workspaceStructureContext = ignoresFailure(options.optionalContextFailuresAreIgnored, "workspaceStructure")
        ? await loadStructure({ workspaceRoot: input.workspaceRoot }).catch(() => undefined)
        : await loadStructure({ workspaceRoot: input.workspaceRoot });
      const recentTextFilesContext = ignoresFailure(options.optionalContextFailuresAreIgnored, "recentTextFiles")
        ? await loadRecent({ workspaceRoot: input.workspaceRoot }).catch(() => undefined)
        : await loadRecent({ workspaceRoot: input.workspaceRoot });
      return {
        chapterCompletionSummaryContext: chapterCompletion(input.currentFilePath),
        chapterReferenceContext: chapterReference(input.currentFilePath),
        recentTextFilesContext,
        workspaceInstructions,
        workspaceStructureContext,
      };
    },
  };
}
