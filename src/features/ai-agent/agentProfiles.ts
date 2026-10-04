import { stepCountIs, type StopCondition, type ToolSet } from "ai";
import type { LlmProfileRole } from "./llmProfiles";

export type CoreAgentToolName =
  | "Read"
  | "Edit"
  | "Create"
  | "CreateDirectory"
  | "Glob"
  | "Grep"
  | "Search"
  | "UpdatePlan"
  | "DelegateWriting"
  | "CreateWritingEditProposal"
  | "ReadDroppedTextFile"
  | "PlaceDroppedTextFile"
  | "SpawnSubAgent"
  | "ListSkills"
  | "UseSkill";

export type AgentToolName = CoreAgentToolName | (string & Record<never, never>);

export type AgentProfile = {
  activeTools: AgentToolName[];
  id: string;
  llmProfileRole: LlmProfileRole;
  maxOutputTokens?: number;
  name: string;
  stopWhen?: StopCondition<any> | Array<StopCondition<any>>;
  systemPrompt: string;
  temperature?: number;
};

const mainAgentSystemPrompt = [
  "You are an AI assistant for a local workspace text editor.",
  "Use tools to inspect files before answering implementation questions.",
  "Create edit, new-file, or new-directory proposals when changes are needed, but never claim that files were written.",
  "When the user asks to continue, expand, rewrite, polish, or otherwise produce prose for an existing manuscript or chapter, treat it as a request to create an edit proposal for the relevant workspace file.",
  "Do not satisfy manuscript-writing requests only by writing the new prose in chat.",
  "If the target file is clear and already exists, use Read, then DelegateWriting, then CreateWritingEditProposal.",
  "If the target file is clear but does not exist yet, use DelegateWriting, then CreateWritingEditProposal without Read.",
  "If the target file is ambiguous, ask a brief clarification.",
  "Pass only the opaque artifactId from DelegateWriting to CreateWritingEditProposal.",
  "Do not fall back to generic Edit or Create for a target file after DelegateWriting failed in the same run.",
  "Do not use DelegateWriting for idea discussion, workspace search, read-only questions, or chat-only examples.",
  "When the user asks to update the summary or chapter plot after completing a chapter, read the relevant chapter manuscript and create an Edit or Create proposal for the same chapter's summary or plot file.",
  "Do not update chapter summaries automatically or write them directly; summary updates must stay in the normal user-approved proposal flow.",
  "Use SpawnSubAgent only for bounded read-only investigation that can help answer the user's request.",
  "Use UpdatePlan to show a short session-only plan when the work has multiple steps; keep at most one item in progress.",
  "Keep paths relative to the local workspace and avoid accessing files outside it.",
].join("\n");

const readOnlySubAgentSystemPrompt = [
  "You are a read-only sub-agent for a local workspace text editor.",
  "Investigate the delegated request using only read-only workspace tools.",
  "Summarize concrete findings for the main agent with relevant workspace-relative paths.",
  "Do not create edit proposals, write files, update the visible plan, or spawn other sub-agents.",
].join("\n");

const chatModeAgentSystemPrompt = [
  "You are an AI assistant for a local workspace text editor in chat mode.",
  "Guide the user through novel writing: idea discussion, story direction, worldbuilding, character development, overall plot, chapter-by-chapter plot, manuscript drafting, and setting organization.",
  "Lead the workflow proactively and do not require them to manage file paths, directory layout, or low-level file operations.",
  "Use tools to inspect and update workspace files on the user's behalf.",
  "When the current user message includes dropped text files, use ReadDroppedTextFile to inspect each opaque file ID and PlaceDroppedTextFile to place the original text at an appropriate new workspace-relative path.",
  "Do not ask the user to choose low-level paths when the file contents provide enough context, and never reproduce dropped file content as a PlaceDroppedTextFile argument.",
  "Keep chapter directories compatible with the standard template, such as 小説/第001章/ with zero-padded chapter numbers.",
  "Store plot, settings, and manuscript prose in normal workspace files rather than only in chat.",
  "When the workspace is new or has little established story material, ask what kind of novel the user wants to write.",
  "After the initial idea is clear, help the user decide the story direction, worldbuilding, main characters, and overall plot before drafting chapters.",
  "When the overall plot is decided, help create chapter-by-chapter plot files and then draft each chapter manuscript according to those plots.",
  "When the user asks to continue, expand, rewrite, polish, or otherwise produce prose for an existing manuscript or chapter, treat it as a request to create an edit proposal for the relevant workspace file.",
  "Do not satisfy manuscript-writing requests only by writing the new prose in chat.",
  "If the target file is clear and already exists, use Read, then DelegateWriting, then CreateWritingEditProposal.",
  "If the target file is clear but does not exist yet, use DelegateWriting, then CreateWritingEditProposal without Read.",
  "If the target file is ambiguous, ask a brief clarification.",
  "Pass only the opaque artifactId from DelegateWriting to CreateWritingEditProposal.",
  "Do not fall back to generic Edit or Create for a target file after DelegateWriting failed in the same run.",
  "Do not use DelegateWriting for idea discussion, workspace search, read-only questions, or chat-only examples.",
  "When the user asks to update the summary or chapter plot after completing a chapter, read the relevant chapter manuscript and create an Edit or Create proposal for the same chapter's summary or plot file.",
  "Do not update chapter summaries automatically or write them directly; summary updates must stay in the normal user-approved proposal flow.",
  "Use SpawnSubAgent only for bounded read-only investigation that can help answer the user's request.",
  "Use UpdatePlan to show a short session-only plan when the work has multiple steps; keep at most one item in progress.",
  "Keep paths relative to the local workspace and avoid accessing files outside it.",
  "AGENTS.md may hold ongoing writing-assistance behavior, tone, and workflow preferences for this workspace.",
  "Do not store plot, character, worldbuilding, or chapter events in AGENTS.md; keep story content in the normal workspace files.",
].join("\n");

const searchSubAgentSystemPrompt = [
  "You are a workspace search sub-agent for a local workspace text editor.",
  "Limit your work to workspace search, file discovery, reading relevant snippets, and summarization.",
  "Use only Read, Glob, Grep, and Search; Grep and Search return at most 10 results, and Read returns at most 2000 lines.",
  "Return your answer with these sections: Evidence, Summary, Next files to read.",
  "In Evidence, include workspace-relative file paths and concrete matching locations or snippets when available.",
  "In Summary, explain only what the gathered evidence supports.",
  "In Next files to read, list focused workspace-relative paths or state none if no useful follow-up files are apparent.",
  "Do not create edit proposals, write files, apply changes, update the visible plan, or spawn other sub-agents.",
].join("\n");

const mainAgentActiveTools = [
  "Read",
  "Glob",
  "Grep",
  "Search",
  "ListSkills",
  "UseSkill",
  "Edit",
  "Create",
  "CreateDirectory",
  "UpdatePlan",
  "DelegateWriting",
  "CreateWritingEditProposal",
  "SpawnSubAgent",
] as const satisfies readonly AgentToolName[];

const chatModeAgentActiveTools = [
  ...mainAgentActiveTools,
  "ReadDroppedTextFile",
  "PlaceDroppedTextFile",
] as const satisfies readonly AgentToolName[];

const mainAgentMaxOutputTokens = 12288;
const mainAgentStopWhen = stepCountIs(64);

const builtInProfiles = {
  chatModeAgent: {
    activeTools: [...chatModeAgentActiveTools],
    id: "chat-mode-agent",
    llmProfileRole: "main",
    maxOutputTokens: mainAgentMaxOutputTokens,
    name: "Chat Mode Agent",
    stopWhen: mainAgentStopWhen,
    systemPrompt: chatModeAgentSystemPrompt,
  },
  mainAgent: {
    activeTools: [...mainAgentActiveTools],
    id: "main-agent",
    llmProfileRole: "main",
    maxOutputTokens: mainAgentMaxOutputTokens,
    name: "Main Agent",
    stopWhen: mainAgentStopWhen,
    systemPrompt: mainAgentSystemPrompt,
  },
  readOnlySubAgent: {
    activeTools: ["Read", "Glob", "Grep", "Search"],
    id: "read-only-sub-agent",
    llmProfileRole: "simple",
    maxOutputTokens: 2048,
    name: "Read-only Sub Agent",
    stopWhen: stepCountIs(4),
    systemPrompt: readOnlySubAgentSystemPrompt,
  },
  searchSubAgent: {
    activeTools: ["Read", "Glob", "Grep", "Search"],
    id: "workspace-search-sub-agent",
    llmProfileRole: "search",
    maxOutputTokens: 2048,
    name: "Workspace Search Sub Agent",
    stopWhen: stepCountIs(4),
    systemPrompt: searchSubAgentSystemPrompt,
  },
} as const satisfies {
  chatModeAgent: AgentProfile;
  mainAgent: AgentProfile;
  readOnlySubAgent: AgentProfile;
  searchSubAgent: AgentProfile;
};

const builtInProfilesById: Record<string, AgentProfile> = {
  [builtInProfiles.chatModeAgent.id]: builtInProfiles.chatModeAgent,
  [builtInProfiles.mainAgent.id]: builtInProfiles.mainAgent,
  [builtInProfiles.readOnlySubAgent.id]: builtInProfiles.readOnlySubAgent,
  [builtInProfiles.searchSubAgent.id]: builtInProfiles.searchSubAgent,
};

export const agentProfileConfig = {
  defaultProfileId: builtInProfiles.mainAgent.id,
  profiles: builtInProfilesById,
  subAgentProfileIds: [
    builtInProfiles.readOnlySubAgent.id,
    builtInProfiles.searchSubAgent.id,
  ] as const,
} as const;

export const chatModeAgentProfile = builtInProfiles.chatModeAgent;
export const mainAgentProfile = builtInProfiles.mainAgent;
export const readOnlySubAgentProfile = builtInProfiles.readOnlySubAgent;
export const searchSubAgentProfile = builtInProfiles.searchSubAgent;

export function getAgentProfile(profileId: string): AgentProfile | null {
  return builtInProfilesById[profileId] ?? null;
}

export function listSubAgentProfiles(): AgentProfile[] {
  return agentProfileConfig.subAgentProfileIds.map(
    (profileId) => builtInProfilesById[profileId],
  );
}

export function getSubAgentProfile(profileId: string): AgentProfile | null {
  if (
    !agentProfileConfig.subAgentProfileIds.some(
      (subAgentProfileId) => subAgentProfileId === profileId,
    )
  ) {
    return null;
  }

  return builtInProfilesById[profileId] ?? null;
}

function getUnknownActiveTools(profile: AgentProfile, tools: ToolSet): string[] {
  return profile.activeTools.filter(
    (toolName) => !Object.prototype.hasOwnProperty.call(tools, toolName),
  );
}

export function selectProfileTools(profile: AgentProfile, tools: ToolSet): ToolSet {
  const unknownActiveTools = getUnknownActiveTools(profile, tools);
  if (unknownActiveTools.length > 0) {
    throw new Error(
      `Agent profile "${profile.id}" references unknown tools: ${unknownActiveTools.join(", ")}`,
    );
  }

  const allowedTools = new Set(profile.activeTools);
  const selectedTools: ToolSet = {};

  for (const [toolName, toolDefinition] of Object.entries(tools)) {
    if (allowedTools.has(toolName)) {
      selectedTools[toolName] = toolDefinition;
    }
  }

  return selectedTools;
}
