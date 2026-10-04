import { describe, expect, it } from "vitest";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  agentProfileConfig,
  chatModeAgentProfile,
  getAgentProfile,
  getSubAgentProfile,
  listSubAgentProfiles,
  mainAgentProfile,
  readOnlySubAgentProfile,
  searchSubAgentProfile,
  selectProfileTools,
} from "./agentProfiles";

describe("agent profiles", () => {
  it("exposes all built-in profiles through one configuration boundary", () => {
    expect(agentProfileConfig.defaultProfileId).toBe("main-agent");
    expect(agentProfileConfig.subAgentProfileIds).toEqual([
      "read-only-sub-agent",
      "workspace-search-sub-agent",
    ]);
    expect(getAgentProfile("main-agent")).toBe(mainAgentProfile);
    expect(getAgentProfile("chat-mode-agent")).toBe(chatModeAgentProfile);
    expect(getAgentProfile("read-only-sub-agent")).toBe(readOnlySubAgentProfile);
    expect(listSubAgentProfiles()).toEqual([readOnlySubAgentProfile, searchSubAgentProfile]);
  });

  it("uses the main LLM profile role by default", () => {
    expect(mainAgentProfile.llmProfileRole).toBe("main");
    expect(mainAgentProfile.maxOutputTokens).toBe(12288);
    expect(mainAgentProfile.activeTools).toEqual([
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
    ]);
    expect(mainAgentProfile.systemPrompt).toContain("local workspace");
  });

  it("instructs the main agent to turn manuscript writing requests into edit proposals", () => {
    expect(mainAgentProfile.systemPrompt).toContain(
      "When the user asks to continue, expand, rewrite, polish, or otherwise produce prose for an existing manuscript or chapter",
    );
    expect(mainAgentProfile.systemPrompt).toContain(
      "treat it as a request to create an edit proposal for the relevant workspace file",
    );
    expect(mainAgentProfile.systemPrompt).toContain(
      "Do not satisfy manuscript-writing requests only by writing the new prose in chat",
    );
    expect(mainAgentProfile.systemPrompt).toContain(
      "If the target file is clear and already exists, use Read, then DelegateWriting, then CreateWritingEditProposal",
    );
    expect(mainAgentProfile.systemPrompt).toContain(
      "If the target file is clear but does not exist yet, use DelegateWriting, then CreateWritingEditProposal without Read",
    );
    expect(mainAgentProfile.systemPrompt).toContain(
      "Do not fall back to generic Edit or Create for a target file after DelegateWriting failed in the same run",
    );
    expect(mainAgentProfile.systemPrompt).toContain(
      "If the target file is ambiguous, ask a brief clarification",
    );
    expect(mainAgentProfile.systemPrompt).toContain(
      "Pass only the opaque artifactId from DelegateWriting to CreateWritingEditProposal",
    );
    expect(mainAgentProfile.systemPrompt).toContain(
      "Do not use DelegateWriting for idea discussion, workspace search, read-only questions, or chat-only examples",
    );
  });

  it("instructs the main agent to handle completed chapter summary updates as proposals", () => {
    expect(mainAgentProfile.systemPrompt).toContain(
      "When the user asks to update the summary or chapter plot after completing a chapter",
    );
    expect(mainAgentProfile.systemPrompt).toContain(
      "read the relevant chapter manuscript and create an Edit or Create proposal",
    );
    expect(mainAgentProfile.systemPrompt).toContain(
      "Do not update chapter summaries automatically or write them directly",
    );
  });

  it("defines a chat-mode agent profile for guided novel writing", () => {
    expect(chatModeAgentProfile.id).toBe("chat-mode-agent");
    expect(chatModeAgentProfile.llmProfileRole).toBe("main");
    expect(chatModeAgentProfile.maxOutputTokens).toBe(mainAgentProfile.maxOutputTokens);
    expect(chatModeAgentProfile.stopWhen).toBe(mainAgentProfile.stopWhen);
    expect(chatModeAgentProfile.activeTools).toEqual(
      expect.arrayContaining(mainAgentProfile.activeTools),
    );
    expect(chatModeAgentProfile.activeTools).toEqual(
      expect.arrayContaining(["ReadDroppedTextFile", "PlaceDroppedTextFile"]),
    );
    expect(mainAgentProfile.activeTools).not.toContain("ReadDroppedTextFile");
    expect(mainAgentProfile.activeTools).not.toContain("PlaceDroppedTextFile");
    expect(chatModeAgentProfile.systemPrompt).toContain("chat mode");
    expect(chatModeAgentProfile.systemPrompt).toContain("do not require them to manage file paths");
    expect(chatModeAgentProfile.systemPrompt).toContain("小説/第001章/");
    expect(chatModeAgentProfile.systemPrompt).toContain("When the workspace is new or has little established story material");
    expect(chatModeAgentProfile.systemPrompt).toContain("ask what kind of novel the user wants to write");
    expect(chatModeAgentProfile.systemPrompt).toContain("worldbuilding");
    expect(chatModeAgentProfile.systemPrompt).toContain("main characters");
    expect(chatModeAgentProfile.systemPrompt).toContain("overall plot");
    expect(chatModeAgentProfile.systemPrompt).toContain("chapter-by-chapter plot");
    expect(chatModeAgentProfile.systemPrompt).toContain("AGENTS.md");
    expect(chatModeAgentProfile.systemPrompt).toContain("ongoing writing-assistance behavior");
    expect(chatModeAgentProfile.systemPrompt).toContain("Do not store plot, character, worldbuilding, or chapter events in AGENTS.md");
  });

  it("defines a read-only sub-agent profile that cannot spawn nested sub-agents", () => {
    expect(readOnlySubAgentProfile.activeTools).toEqual(["Read", "Glob", "Grep", "Search"]);
    expect(readOnlySubAgentProfile.activeTools).not.toContain("SpawnSubAgent");
    expect(readOnlySubAgentProfile.activeTools).not.toContain("ListSkills");
    expect(readOnlySubAgentProfile.activeTools).not.toContain("UseSkill");
    expect(readOnlySubAgentProfile.activeTools).not.toContain("Edit");
    expect(getSubAgentProfile("read-only-sub-agent")).toBe(readOnlySubAgentProfile);
    expect(getSubAgentProfile("missing")).toBeNull();
  });

  it("defines a workspace search sub-agent profile with only read and search tools", () => {
    expect(searchSubAgentProfile.llmProfileRole).toBe("search");
    expect(searchSubAgentProfile.activeTools).toEqual(["Read", "Glob", "Grep", "Search"]);
    expect(searchSubAgentProfile.activeTools).not.toContain("Edit");
    expect(searchSubAgentProfile.activeTools).not.toContain("Create");
    expect(searchSubAgentProfile.activeTools).not.toContain("CreateDirectory");
    expect(searchSubAgentProfile.activeTools).not.toContain("UpdatePlan");
    expect(searchSubAgentProfile.activeTools).not.toContain("SpawnSubAgent");
    expect(searchSubAgentProfile.activeTools).not.toContain("ListSkills");
    expect(searchSubAgentProfile.activeTools).not.toContain("UseSkill");
    expect(searchSubAgentProfile.systemPrompt).toContain("workspace search sub-agent");
    expect(searchSubAgentProfile.systemPrompt).toContain("Evidence");
    expect(searchSubAgentProfile.systemPrompt).toContain("Summary");
    expect(searchSubAgentProfile.systemPrompt).toContain("Next files to read");
    expect(searchSubAgentProfile.systemPrompt).toContain("Grep and Search return at most 10 results");
    expect(searchSubAgentProfile.systemPrompt).toContain("Read returns at most 2000 lines");
    expect(searchSubAgentProfile.systemPrompt).toContain("Do not create edit proposals");
    expect(getSubAgentProfile("workspace-search-sub-agent")).toBe(searchSubAgentProfile);
  });

  it("selects only profile-allowed tools from the available tool set", () => {
    const tools: ToolSet = {
      Edit: tool({
        description: "Create an edit proposal.",
        inputSchema: z.object({}),
        execute: () => ({}),
      }),
      Grep: tool({
        description: "Search text.",
        inputSchema: z.object({}),
        execute: () => ({}),
      }),
      Read: tool({
        description: "Read a file.",
        inputSchema: z.object({}),
        execute: () => ({}),
      }),
    };

    expect(
      selectProfileTools(
        {
          ...readOnlySubAgentProfile,
          activeTools: ["Read", "Grep"],
        },
        tools,
      ),
    ).toEqual({
      Grep: tools.Grep,
      Read: tools.Read,
    });
  });

  it("rejects unknown active tools instead of silently ignoring them", () => {
    expect(() =>
      selectProfileTools(
        {
          ...mainAgentProfile,
          activeTools: ["Read", "MissingTool"],
        },
        {
          Read: tool({
            description: "Read a file.",
            inputSchema: z.object({}),
            execute: () => ({}),
          }),
        },
      ),
    ).toThrow('Agent profile "main-agent" references unknown tools: MissingTool');
  });
});
