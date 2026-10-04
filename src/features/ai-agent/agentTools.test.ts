import { describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import {
  createAgentTools,
  createWritingEditProposalToolInputSchema,
  createDirectoryToolInputSchema,
  createToolInputSchema,
  editToolInputSchema,
  spawnSubAgentToolInputSchema,
  useSkillToolInputSchema,
  updatePlanToolInputSchema,
} from "./agentTools";
import { builtInAgentSkills } from "./agentSkills";

describe("AI SDK agent tools", () => {
  it("validates Edit input with Zod but only creates an edit proposal", () => {
    expect(() =>
      editToolInputSchema.parse({ newText: "new", oldText: "old", path: "" }),
    ).toThrow();
    expect(editToolInputSchema.parse({ newText: "first line", oldText: "", path: "empty.txt" })).toEqual({
      newText: "first line",
      oldText: "",
      path: "empty.txt",
    });
  });

  it("accepts only an opaque artifactId for CreateWritingEditProposal", () => {
    expect(createWritingEditProposalToolInputSchema.parse({ artifactId: "writing-artifact-1" })).toEqual({
      artifactId: "writing-artifact-1",
    });
    expect(() => createWritingEditProposalToolInputSchema.parse({ artifactId: "" })).toThrow();
    expect(() =>
      createWritingEditProposalToolInputSchema.parse({
        artifactId: "writing-artifact-1",
        newText: "main must not provide this",
        oldText: "main must not provide this",
        path: "chapter.txt",
      }),
    ).toThrow();
  });

  it("validates Create input with Zod", () => {
    expect(() => createToolInputSchema.parse({ content: "hello", path: "" })).toThrow();
  });

  it("validates CreateDirectory input with Zod", () => {
    expect(() => createDirectoryToolInputSchema.parse({ path: "" })).toThrow();
  });

  it("validates UpdatePlan input and rejects multiple in-progress items", () => {
    expect(
      updatePlanToolInputSchema.parse({
        items: [
          { id: "inspect", status: "in_progress", title: "調査する" },
          { detail: "あとで確認", id: "edit", status: "pending", title: "編集案を作る" },
        ],
      }),
    ).toMatchObject({
      items: [
        { id: "inspect", status: "in_progress", title: "調査する" },
        { detail: "あとで確認", id: "edit", status: "pending", title: "編集案を作る" },
      ],
    });

    expect(() =>
      updatePlanToolInputSchema.parse({
        items: [
          { id: "inspect", status: "in_progress", title: "調査する" },
          { id: "edit", status: "in_progress", title: "編集案を作る" },
        ],
      }),
    ).toThrow(/in_progress/);
  });

  it("validates SpawnSubAgent input with Zod", () => {
    expect(
      spawnSubAgentToolInputSchema.parse({
        profileId: "read-only-sub-agent",
        prompt: "Find relevant files.",
        purpose: "Investigate current workspace state",
      }),
    ).toEqual({
      profileId: "read-only-sub-agent",
      prompt: "Find relevant files.",
      purpose: "Investigate current workspace state",
    });
    expect(
      spawnSubAgentToolInputSchema.parse({
        profileId: "workspace-search-sub-agent",
        prompt: "Find references to path validation.",
        purpose: "Search for path validation code",
      }),
    ).toEqual({
      profileId: "workspace-search-sub-agent",
      prompt: "Find references to path validation.",
      purpose: "Search for path validation code",
    });

    expect(() =>
      spawnSubAgentToolInputSchema.parse({
        profileId: "read-only-sub-agent",
        prompt: "",
        purpose: "Investigate",
      }),
    ).toThrow();
    expect(() =>
      spawnSubAgentToolInputSchema.parse({
        profileId: "unknown",
        prompt: "Find relevant files.",
        purpose: "Investigate",
      }),
    ).toThrow();
  });

  it("validates UseSkill input with Zod", () => {
    expect(
      useSkillToolInputSchema.parse({
        skillId: builtInAgentSkills[0].id,
      }),
    ).toEqual({
      skillId: builtInAgentSkills[0].id,
    });

    expect(() => useSkillToolInputSchema.parse({ skillId: "" })).toThrow();
  });

  it("lists skill metadata without instructions and activates only existing built-in skills", async () => {
    const activeSkillIds = new Set<string>();
    const tools = createAgentTools({
      activeSkillIds,
      workspaceRoot: "/tmp/workspace",
    });

    await expect(Promise.resolve(tools.ListSkills.execute?.({}, {} as never))).resolves.toEqual({
      skills: expect.arrayContaining([
        expect.objectContaining({
          description: builtInAgentSkills[0].description,
          displayName: builtInAgentSkills[0].displayName,
          id: builtInAgentSkills[0].id,
        }),
      ]),
    });
    const listOutput = await Promise.resolve(tools.ListSkills.execute?.({}, {} as never));
    expect(JSON.stringify(listOutput)).not.toContain(builtInAgentSkills[0].instruction);

    await expect(
      Promise.resolve(
        tools.UseSkill.execute?.({ skillId: builtInAgentSkills[0].id }, {} as never),
      ),
    ).resolves.toEqual({
      displayName: builtInAgentSkills[0].displayName,
      skillId: builtInAgentSkills[0].id,
      status: "activated",
    });
    expect([...activeSkillIds]).toEqual([builtInAgentSkills[0].id]);

    await expect(
      Promise.resolve(tools.UseSkill.execute?.({ skillId: "missing-skill" }, {} as never)),
    ).rejects.toThrow(/Unknown skill/);
  });

  it("lists and activates plugin skills through the same skill registry", async () => {
    const activeSkillIds = new Set<string>();
    const tools = createAgentTools({
      activeSkillIds,
      skillPlugins: [
        {
          createSkills: () => [
            {
              id: "project-review",
              displayName: "Project review",
              description: "Use project review conventions.",
              instruction: "Project review private instructions.",
              requiredTools: ["Read"],
            },
          ],
          displayName: "Project skills",
          id: "project",
          kind: "agent-skill",
        },
      ],
      workspaceRoot: "/tmp/workspace",
    });

    const listOutput = await Promise.resolve(tools.ListSkills.execute?.({}, {} as never));
    expect(listOutput).toEqual({
      skills: expect.arrayContaining([
        expect.objectContaining({
          description: "Use project review conventions.",
          displayName: "Project review",
          id: "project-review",
        }),
      ]),
    });
    expect(JSON.stringify(listOutput)).not.toContain("Project review private instructions.");

    await expect(
      Promise.resolve(tools.UseSkill.execute?.({ skillId: "project-review" }, {} as never)),
    ).resolves.toEqual({
      displayName: "Project review",
      skillId: "project-review",
      status: "activated",
    });
    expect([...activeSkillIds]).toEqual(["project-review"]);
  });

  it("rejects concurrent CreateWritingEditProposal calls for the same artifactId", async () => {
    const registry = {
      artifacts: new Map([
        [
          "artifact-1",
          {
            latencyMs: 1,
            newText: "new",
            oldText: "old",
            operation: "edit" as const,
            targetPath: "chapter.txt",
            tokenUsage: {
              llmProfileRole: "writing" as const,
              modelId: "writing-model",
              providerId: "deepseek",
            },
          },
        ],
      ]),
      consumedArtifactIds: new Set<string>(),
      delegateWritingFailedPaths: new Set<string>(),
    };
    let releaseFirst: () => void;
    const firstPaused = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstReachedCreate: () => void;
    const firstReachedCreatePromise = new Promise<void>((resolve) => {
      firstReachedCreate = resolve;
    });
    const createEditProposal = vi.fn(async (input) => {
      firstReachedCreate();
      await firstPaused;
      return {
        createdAt: "2026-06-20T00:00:00.000Z",
        diff: "diff",
        id: "proposal",
        newText: input.newText,
        oldText: input.oldText,
        operation: "edit" as const,
        path: input.path,
        status: "pending" as const,
        title: "Edit",
        updatedAt: "2026-06-20T00:00:00.000Z",
      };
    });
    const tools = createAgentTools({
      createEditProposal,
      workspaceRoot: "/tmp/workspace",
      writingArtifactRegistry: registry,
    });

    const firstCall = tools.CreateWritingEditProposal!.execute!(
      { artifactId: "artifact-1" },
      {} as never,
    );
    await firstReachedCreatePromise;

    let concurrentError: unknown;
    try {
      await tools.CreateWritingEditProposal!.execute!({ artifactId: "artifact-1" }, {} as never);
    } catch (error) {
      concurrentError = error;
    }

    expect(concurrentError).toEqual(
      expect.objectContaining({ message: "Writing artifact already consumed: artifact-1" }),
    );
    expect(createEditProposal).toHaveBeenCalledTimes(1);

    releaseFirst!();
    const firstOutput = await firstCall;
    expect(firstOutput).toMatchObject({ path: "chapter.txt", sourceRole: "writing" });
    expect(registry.consumedArtifactIds.has("artifact-1")).toBe(true);
    expect(createEditProposal).toHaveBeenCalledTimes(1);
  });

  it("does not consume a writing artifact when editProposalSchema.parse fails", async () => {
    const registry = {
      artifacts: new Map([
        [
          "artifact-1",
          {
            latencyMs: 1,
            newText: "new",
            oldText: "old",
            operation: "edit" as const,
            targetPath: "chapter.txt",
            tokenUsage: {
              llmProfileRole: "writing" as const,
              modelId: "writing-model",
              providerId: "deepseek",
            },
          },
        ],
      ]),
      consumedArtifactIds: new Set<string>(),
      delegateWritingFailedPaths: new Set<string>(),
    };
    let callCount = 0;
    const createEditProposal = vi.fn((input) => {
      callCount += 1;
      if (callCount === 1) {
        return { id: "invalid", path: "chapter.txt" } as never;
      }
      return {
        createdAt: "2026-06-20T00:00:00.000Z",
        diff: "diff",
        id: "proposal",
        newText: input.newText,
        oldText: input.oldText,
        operation: "edit" as const,
        path: input.path,
        status: "pending" as const,
        title: "Edit",
        updatedAt: "2026-06-20T00:00:00.000Z",
      };
    });
    const tools = createAgentTools({
      createEditProposal,
      workspaceRoot: "/tmp/workspace",
      writingArtifactRegistry: registry,
    });

    let parseError: unknown;
    try {
      await tools.CreateWritingEditProposal!.execute!({ artifactId: "artifact-1" }, {} as never);
    } catch (error) {
      parseError = error;
    }

    expect(parseError).toBeDefined();
    expect(registry.consumedArtifactIds.has("artifact-1")).toBe(false);

    const retryOutput = await tools.CreateWritingEditProposal!.execute!(
      { artifactId: "artifact-1" },
      {} as never,
    );
    expect(retryOutput).toMatchObject({ path: "chapter.txt", sourceRole: "writing" });
    expect(registry.consumedArtifactIds.has("artifact-1")).toBe(true);
    expect(createEditProposal).toHaveBeenCalledTimes(2);
  });

  it("routes create writing artifacts to Create proposals without exposing artifact text", async () => {
    const generatedText = "new scene\nwith exact whitespace\n";
    const registry = {
      artifacts: new Map([
        [
          "artifact-create",
          {
            latencyMs: 2,
            newText: generatedText,
            oldText: "model-supplied old text must be ignored",
            operation: "create" as const,
            targetPath: "manuscript/scene-02.txt",
            tokenUsage: {
              llmProfileRole: "writing" as const,
              modelId: "writing-model",
              providerId: "deepseek",
            },
          },
        ],
      ]),
      consumedArtifactIds: new Set<string>(),
      delegateWritingFailedPaths: new Set<string>(),
    };
    const createEditProposal = vi.fn();
    const createFileProposal = vi.fn((input) => ({
      createdAt: "2026-06-22T00:00:00.000Z",
      diff: "diff",
      id: "proposal-create",
      newText: input.content,
      oldText: "",
      operation: "create" as const,
      path: input.path,
      status: "pending" as const,
      title: "Create",
      updatedAt: "2026-06-22T00:00:00.000Z",
    }));
    const tools = createAgentTools({
      createEditProposal,
      createFileProposal,
      workspaceRoot: "/tmp/workspace",
      writingArtifactRegistry: registry,
    });

    const output = await tools.CreateWritingEditProposal!.execute!(
      { artifactId: "artifact-create" },
      {} as never,
    );

    expect(createFileProposal).toHaveBeenCalledWith({
      content: generatedText,
      path: "manuscript/scene-02.txt",
      workspaceRoot: "/tmp/workspace",
    });
    expect(createEditProposal).not.toHaveBeenCalled();
    expect(output).toMatchObject({
      newText: generatedText,
      oldText: "",
      operation: "create",
      sourceRole: "writing",
    });
  });

  it("does not consume a create writing artifact when createFileProposal fails", async () => {
    const generatedText = "retry scene\n";
    const registry = {
      artifacts: new Map([
        [
          "artifact-create-retry",
          {
            latencyMs: 2,
            newText: generatedText,
            oldText: "model old text",
            operation: "create" as const,
            targetPath: "manuscript/scene-03.txt",
            tokenUsage: {
              llmProfileRole: "writing" as const,
              modelId: "writing-model",
              providerId: "deepseek",
            },
          },
        ],
      ]),
      consumedArtifactIds: new Set<string>(),
      delegateWritingFailedPaths: new Set<string>(),
    };
    const createFileProposal = vi
      .fn()
      .mockRejectedValueOnce(new Error("proposal validation failed"))
      .mockImplementation((input) => ({
        createdAt: "2026-06-22T00:00:00.000Z",
        diff: "diff",
        id: "proposal-create",
        newText: input.content,
        oldText: "",
        operation: "create" as const,
        path: input.path,
        status: "pending" as const,
        title: "Create",
        updatedAt: "2026-06-22T00:00:00.000Z",
      }));
    const tools = createAgentTools({
      createFileProposal,
      workspaceRoot: "/tmp/workspace",
      writingArtifactRegistry: registry,
    });

    let firstError: unknown;
    try {
      await tools.CreateWritingEditProposal!.execute!(
        { artifactId: "artifact-create-retry" },
        {} as never,
      );
    } catch (error) {
      firstError = error;
    }

    const retryOutput = await tools.CreateWritingEditProposal!.execute!(
      { artifactId: "artifact-create-retry" },
      {} as never,
    );

    expect(firstError).toEqual(
      expect.objectContaining({ message: "proposal validation failed" }),
    );
    expect(registry.consumedArtifactIds.has("artifact-create-retry")).toBe(true);
    expect(createFileProposal).toHaveBeenCalledTimes(2);
    expect(retryOutput).toMatchObject({
      operation: "create",
      oldText: "",
      path: "manuscript/scene-03.txt",
      sourceRole: "writing",
    });
  });

  it("rejects unknown and consumed create writing artifact IDs", async () => {
    const registry = {
      artifacts: new Map([
        [
          "artifact-create-used",
          {
            latencyMs: 1,
            newText: "scene",
            oldText: "",
            operation: "create" as const,
            targetPath: "manuscript/scene-06.txt",
            tokenUsage: {
              llmProfileRole: "writing" as const,
              modelId: "writing-model",
              providerId: "deepseek",
            },
          },
        ],
      ]),
      consumedArtifactIds: new Set<string>(),
      delegateWritingFailedPaths: new Set<string>(),
    };
    const createFileProposal = vi.fn((input) => ({
      createdAt: "2026-06-22T00:00:00.000Z",
      diff: "diff",
      id: "proposal-create",
      newText: input.content,
      oldText: "",
      operation: "create" as const,
      path: input.path,
      status: "pending" as const,
      title: "Create",
      updatedAt: "2026-06-22T00:00:00.000Z",
    }));
    const tools = createAgentTools({
      createFileProposal,
      workspaceRoot: "/tmp/workspace",
      writingArtifactRegistry: registry,
    });

    let unknownError: unknown;
    try {
      await tools.CreateWritingEditProposal!.execute!({ artifactId: "missing-create" }, {} as never);
    } catch (error) {
      unknownError = error;
    }

    await tools.CreateWritingEditProposal!.execute!(
      { artifactId: "artifact-create-used" },
      {} as never,
    );

    let reusedError: unknown;
    try {
      await tools.CreateWritingEditProposal!.execute!(
        { artifactId: "artifact-create-used" },
        {} as never,
      );
    } catch (error) {
      reusedError = error;
    }

    expect(unknownError).toEqual(
      expect.objectContaining({ message: expect.stringMatching(/unknown/i) }),
    );
    expect(reusedError).toEqual(
      expect.objectContaining({ message: expect.stringMatching(/used|consumed/i) }),
    );
    expect(createFileProposal).toHaveBeenCalledTimes(1);
  });

  it("rejects generic Create for a failed writing path while allowing unrelated paths", async () => {
    const createFileProposal = vi.fn((input) => ({
      createdAt: "2026-06-22T00:00:00.000Z",
      diff: "diff",
      id: "proposal",
      newText: input.content,
      oldText: "",
      operation: "create" as const,
      path: input.path,
      status: "pending" as const,
      title: "Create",
      updatedAt: "2026-06-22T00:00:00.000Z",
    }));
    const registry = {
      artifacts: new Map(),
      consumedArtifactIds: new Set<string>(),
      delegateWritingFailedPaths: new Set(["manuscript/scene-02.txt"]),
    };
    const tools = createAgentTools({
      createFileProposal,
      workspaceRoot: "/tmp/workspace",
      writingArtifactRegistry: registry,
    });

    await expect(async () =>
      tools.Create.execute?.(
        { content: "fallback prose", path: "manuscript/scene-02.txt" },
        {} as never,
      ),
    ).rejects.toThrow(/DelegateWriting|not allowed/i);
    await expect(
      tools.Create.execute?.({ content: "notes", path: "notes/todo.md" }, {} as never),
    ).resolves.toMatchObject({ path: "notes/todo.md" });
    expect(createFileProposal).toHaveBeenCalledTimes(1);
  });

  it("keeps generic Edit available without a writing registry", async () => {
    const createEditProposal = vi.fn((input) => ({
      createdAt: "2026-06-20T00:00:00.000Z",
      diff: "diff",
      id: "proposal",
      newText: input.newText,
      oldText: input.oldText,
      operation: "edit" as const,
      path: input.path,
      status: "pending" as const,
      title: "Edit",
      updatedAt: "2026-06-20T00:00:00.000Z",
    }));
    const tools = createAgentTools({
      createEditProposal,
      workspaceRoot: "/tmp/workspace",
    });

    await expect(
      tools.Edit.execute?.({ path: "notes.md", oldText: "todo", newText: "done" }, {} as never),
    ).resolves.toMatchObject({ path: "notes.md" });
    expect(tools.CreateWritingEditProposal).toBeUndefined();
    expect(createEditProposal).toHaveBeenCalledWith({
      newText: "done",
      oldText: "todo",
      path: "notes.md",
      workspaceRoot: "/tmp/workspace",
    });
  });

  it("delegates tool execution to local services with the active workspace root", async () => {
    const readWorkspaceFile = vi.fn().mockResolvedValue({ content: "hello", path: "a.txt" });
    const workspaceSearchStore = {
      createContext: vi.fn().mockResolvedValue({ workspaceRoot: "/tmp/workspace" }),
      glob: vi.fn().mockResolvedValue({ limit: 10, matches: ["a.txt"], truncated: false }),
      grep: vi.fn().mockResolvedValue({ limit: 10, matches: [], truncated: false }),
      search: vi.fn().mockResolvedValue({
        limit: 10,
        queryTerms: ["hello"],
        results: [],
        truncated: false,
      }),
    };
    const createEditProposal = vi.fn();
    const createDirectoryProposal = vi.fn();
    const createFileProposal = vi.fn();
    const spawnSubAgent = vi.fn().mockResolvedValue({
      profileId: "read-only-sub-agent",
      status: "completed",
      summary: "found",
    });

    const tools = createAgentTools({
      createDirectoryProposal,
      createEditProposal,
      createFileProposal,
      readWorkspaceFile,
      spawnSubAgent,
      workspaceSearchStore,
      workspaceRoot: "/tmp/workspace",
    });

    await expect(tools.Read.execute?.({ path: "a.txt" }, {} as never)).resolves.toMatchObject({
      content: "hello",
      path: "a.txt",
    });
    expect(readWorkspaceFile).toHaveBeenCalledWith({
      path: "a.txt",
      workspaceRoot: "/tmp/workspace",
    });

    await tools.Glob.execute?.({ pattern: "*.txt" }, {} as never);
    await tools.Grep.execute?.({ query: "hello" }, {} as never);
    await tools.Search.execute?.({ query: "hello world" }, {} as never);
    expect(workspaceSearchStore.createContext).toHaveBeenCalledWith("/tmp/workspace");
    expect(workspaceSearchStore.glob).toHaveBeenCalledWith(
      { workspaceRoot: "/tmp/workspace" },
      { pattern: "*.txt" },
    );
    expect(workspaceSearchStore.grep).toHaveBeenCalledWith(
      { workspaceRoot: "/tmp/workspace" },
      { query: "hello" },
    );
    expect(workspaceSearchStore.search).toHaveBeenCalledWith(
      { workspaceRoot: "/tmp/workspace" },
      { query: "hello world" },
    );

    await tools.Create.execute?.({ content: "new", path: "new.txt" }, {} as never);
    expect(createFileProposal).toHaveBeenCalledWith({
      content: "new",
      path: "new.txt",
      workspaceRoot: "/tmp/workspace",
    });

    await tools.CreateDirectory.execute?.({ path: "docs" }, {} as never);
    expect(createDirectoryProposal).toHaveBeenCalledWith({
      path: "docs",
      workspaceRoot: "/tmp/workspace",
    });

    await expect(
      Promise.resolve(
        tools.UpdatePlan.execute?.(
          {
            items: [{ id: "inspect", status: "completed", title: "調査する" }],
          },
          {} as never,
        ),
      ),
    ).resolves.toEqual({
      items: [{ id: "inspect", status: "completed", title: "調査する" }],
    });

    await expect(
      Promise.resolve(
        tools.SpawnSubAgent.execute?.(
          {
            profileId: "read-only-sub-agent",
            prompt: "Find docs",
            purpose: "Locate docs",
          },
          {} as never,
        ),
      ),
    ).resolves.toEqual({
      profileId: "read-only-sub-agent",
      status: "completed",
      summary: "found",
    });
    expect(spawnSubAgent).toHaveBeenCalledWith({
      profileId: "read-only-sub-agent",
      prompt: "Find docs",
      purpose: "Locate docs",
    });
  });

  it("merges tools returned by AgentToolPlugin with the core tools", async () => {
    const tools = createAgentTools({
      plugins: [
        {
          createTools: (context) => ({
            EchoWorkspace: tool({
              description: "Return the active workspace root.",
              inputSchema: z.object({}),
              execute: () => ({ workspaceRoot: context.workspaceRoot }),
            }),
          }),
          displayName: "Echo workspace",
          id: "echo-workspace",
          kind: "agent-tool",
        },
      ],
      workspaceRoot: "/tmp/workspace",
    });

    expect(tools.Read).toBeDefined();
    expect(tools.EchoWorkspace).toBeDefined();
    await expect(Promise.resolve(tools.EchoWorkspace.execute?.({}, {} as never))).resolves.toEqual({
      workspaceRoot: "/tmp/workspace",
    });
  });

  it("rejects plugin tools that collide with core tool names", () => {
    expect(() =>
      createAgentTools({
        plugins: [
          {
            createTools: () => ({
              Read: tool({
                description: "Colliding tool.",
                inputSchema: z.object({}),
                execute: () => ({}),
              }),
            }),
            displayName: "Collision",
            id: "collision",
            kind: "agent-tool",
          },
        ],
        workspaceRoot: "/tmp/workspace",
      }),
    ).toThrow(/Read/);
  });

  it("rejects duplicate tool names across plugins", () => {
    expect(() =>
      createAgentTools({
        plugins: [
          {
            createTools: () => ({
              EchoWorkspace: tool({
                description: "First plugin tool.",
                inputSchema: z.object({}),
                execute: () => ({}),
              }),
            }),
            displayName: "First",
            id: "first",
            kind: "agent-tool",
          },
          {
            createTools: () => ({
              EchoWorkspace: tool({
                description: "Second plugin tool.",
                inputSchema: z.object({}),
                execute: () => ({}),
              }),
            }),
            displayName: "Second",
            id: "second",
            kind: "agent-tool",
          },
        ],
        workspaceRoot: "/tmp/workspace",
      }),
    ).toThrow(/EchoWorkspace/);
  });
});
