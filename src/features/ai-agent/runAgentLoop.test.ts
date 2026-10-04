import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  APICallError,
  JSONParseError,
  NoObjectGeneratedError,
  TypeValidationError,
  stepCountIs,
  tool,
} from "ai";
import { z } from "zod";
import { MockLanguageModelV4 } from "ai/test";
import { chatModeAgentProfile, mainAgentProfile } from "./agentProfiles";
import { builtInAgentSkills } from "./agentSkills";
import { createTrustedAgentExtensionCatalog } from "./trustedAgentExtensions";
import type { LlmProfileRole } from "./llmProfiles";
import { runAgentLoop, type RunAgentLoopOptions } from "./runAgentLoop";
import { normalizeWorkspaceRelativePath } from "../workspace/workspaceFilePaths";
import type { ResolvedWritingDelegationTarget } from "./writingDelegationTarget";

const readableWritingTargetResolver: NonNullable<
  RunAgentLoopOptions["resolveWritingDelegationTarget"]
> = async (_workspaceRoot, targetPath): Promise<ResolvedWritingDelegationTarget> => ({
  normalizedPath: normalizeWorkspaceRelativePath(targetPath),
  state: { kind: "readable" },
});

function withReadableWritingTarget(options: RunAgentLoopOptions): RunAgentLoopOptions {
  return {
    resolveWritingDelegationTarget: readableWritingTargetResolver,
    ...options,
  };
}

// Use the SDK's typed test model so normal fixtures follow its model contract.
function testModelProvider(): RunAgentLoopOptions["modelProvider"] {
  return {
    getLanguageModel: vi.fn(() => new MockLanguageModelV4()),
  };
}

// The test stream only exercises the tools/fullStream boundary. Keep the
// unavoidable AI SDK variance cast here instead of on the whole options object.
function testStreamText(
  stream: (options: {
    tools: Record<string, { execute: (input: unknown) => Promise<unknown> }>;
  }) => { fullStream: AsyncIterable<unknown> },
): NonNullable<RunAgentLoopOptions["streamText"]> {
  return stream as unknown as NonNullable<RunAgentLoopOptions["streamText"]>;
}

const diagnosticTestUsage = {
  inputTokenDetails: {
    cacheReadTokens: undefined,
    cacheWriteTokens: undefined,
    noCacheTokens: 12,
  },
  inputTokens: 12,
  outputTokenDetails: {
    reasoningTokens: undefined,
    textTokens: 3,
  },
  outputTokens: 3,
  totalTokens: 15,
};

const diagnosticTestResponse = {
  id: "response-1",
  modelId: "provider-writing-model",
  timestamp: new Date("2026-06-20T00:00:00.000Z"),
};

async function runDelegateWritingFailure(options: {
  fileContent?: string;
  generateObject: NonNullable<RunAgentLoopOptions["generateObject"]>;
  observer?: (diagnostic: unknown) => Promise<void> | void;
}) {
  const targetPath = "manuscript/chapter-01.txt";
  let delegationOutput: unknown;
  const events = [];
  const streamText = vi.fn(
    (streamOptions: {
      tools: Record<string, { execute: (input: unknown) => Promise<unknown> }>;
    }) => ({
      fullStream: (async function* () {
        await streamOptions.tools.Read.execute({ path: targetPath });
        delegationOutput = await streamOptions.tools.DelegateWriting.execute({
          instruction: "Continue the manuscript.",
          targetPath,
        });
        yield {
          output: delegationOutput,
          toolCallId: "writing-1",
          toolName: "DelegateWriting",
          type: "tool-result",
        };
        yield { finishReason: "stop", totalUsage: {}, type: "finish" };
      })(),
    }),
  );
  const resolveLlmProfileForRole = vi.fn((role: LlmProfileRole) => ({
    available: true,
    contextWindowTokens: 1_000_000,
    id: `test:${role}`,
    llmProfileRole: role,
    maxOutputTokens: role === "writing" ? 6000 : 4000,
    modelId: `${role}-model`,
    name: `${role} profile`,
    providerId: "deepseek" as const,
    source: "built-in" as const,
    temperature: role === "writing" ? 0.7 : 0.2,
  }));

  const runOptions: RunAgentLoopOptions = {
    generateObject: options.generateObject,
    messages: [{ content: "続きを書いて", role: "user" }],
    modelProvider: testModelProvider(),
    onDelegateWritingDiagnostic: options.observer,
    profile: mainAgentProfile,
    resolveLlmProfileForRole,
    streamText: testStreamText(streamText),
    toolServices: {
      readWorkspaceFile: vi.fn(async (input) => ({
        content: options.fileContent ?? "MANUSCRIPT_CONTENT",
        path: input.path,
        totalLines: 1,
        truncated: false,
      })),
    },
    workspaceRoot: "/tmp/workspace",
  };

  for await (const event of runAgentLoop(withReadableWritingTarget(runOptions))) {
    events.push(event);
  }

  return { delegationOutput, events, targetPath };
}

describe("runAgentLoop", () => {
  it("connects real writing stream progress to its tool call without publishing partial prose", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-writing-progress-"));
    const progress = vi.fn();
    const events: Array<{type: string}> = [];
    let calls = 0;
    const usage = {inputTokens: {total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined}, outputTokens: {total: 1, text: 1, reasoning: undefined}};
    const mainModel = new MockLanguageModelV4({doStream: async () => {
      const first = calls++ === 0;
      return {stream: new ReadableStream({start(controller) {
        if (first) controller.enqueue({type: "tool-call", toolCallId: "writing-1", toolName: "DelegateWriting", input: JSON.stringify({targetPath: "new.txt", instruction: "write"})});
        controller.enqueue({type: "finish", finishReason: {unified: first ? "tool-calls" : "stop", raw: "test"}, usage});
        controller.close();
      }})};
    }});
    const writingModel = new MockLanguageModelV4({doStream: async () => ({stream: new ReadableStream({start(controller) {
      controller.enqueue({type: "text-start", id: "text"});
      controller.enqueue({type: "text-delta", id: "text", delta: '{"content":"PRIVATE_MANUSCRIPT_TEXT"}'});
      controller.enqueue({type: "text-end", id: "text"});
      controller.enqueue({type: "finish", finishReason: {unified: "stop", raw: "stop"}, usage});
      controller.close();
    }})})});
    try {
      for await (const event of runAgentLoop({
        messages: [{role: "user", content: "write"}],
        modelProvider: {getLanguageModel: (_model, _provider, profile) => profile?.endsWith(":writing") ? writingModel : mainModel},
        profile: {...chatModeAgentProfile, activeTools: ["DelegateWriting"]}, workspaceRoot,
        onToolProgress: (event) => {
          expect(events).toContainEqual(expect.objectContaining({type: "tool-call", toolCallId: "writing-1"}));
          progress(event);
        },
      })) events.push(event);
      expect(progress).toHaveBeenCalledWith({type: "tool-progress", toolName: "DelegateWriting", toolCallId: "writing-1", targetPath: "new.txt", generatedCharacters: 23});
      expect(events).toContainEqual(expect.objectContaining({type: "tool-result", output: expect.objectContaining({status: "completed", artifactId: expect.any(String)})}));
      expect(JSON.stringify(events)).not.toContain("PRIVATE_MANUSCRIPT_TEXT");
    } finally { rmSync(workspaceRoot, {force: true, recursive: true}); }
  });
  it("allows a multi-chapter run past eight steps but stops at the safety budget", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        calls += 1;
        return { stream: new ReadableStream({ start(controller) {
          controller.enqueue({type: "tool-call", toolCallId: `read-${calls}`, toolName: "Read", input: JSON.stringify({path: "chapter.txt"})});
          controller.enqueue({type: "finish", finishReason: {unified: "tool-calls", raw: "tool_calls"}, usage: {inputTokens: {total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined}, outputTokens: {total: 1, text: 1, reasoning: undefined}}});
          controller.close();
        } }) };
      },
    });
    const events = [];
    for await (const event of runAgentLoop({
      messages: [{role: "user", content: "全章を書いて"}],
      modelProvider: {getLanguageModel: () => model},
      profile: {...chatModeAgentProfile, activeTools: ["Read"]},
      toolServices: {readWorkspaceFile: async () => ({content: "text", path: "chapter.txt", totalLines: 1, truncated: false})},
      workspaceRoot: "/tmp/workspace",
    })) events.push(event);
    expect(calls).toBe(64);
    expect(events.at(-1)).toMatchObject({type: "finish", finishReason: "tool-calls"});
  });
  it("propagates real SDK error chunks to the application failure boundary", async () => {
    const model = new MockLanguageModelV4({doStream: async () => ({stream: new ReadableStream({start(controller) {
      controller.enqueue({type: "error", error: new Error("provider stream failed")});
      controller.close();
    }})})});
    const drain = async () => {
      for await (const event of runAgentLoop({messages: [{role: "user", content: "write"}], modelProvider: {getLanguageModel: () => model}, profile: mainAgentProfile, workspaceRoot: "/tmp/workspace"})) { void event; }
    };
    await expect(drain()).rejects.toThrow("provider stream failed");
  });
  it("calls streamText through the shared loop and maps fullStream parts to app events", async () => {
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { text: "Hello", type: "text-delta" };
        yield {
          input: { path: "README.md" },
          toolCallId: "tool-1",
          toolName: "Read",
          type: "tool-call",
        };
        yield {
          output: { content: "file text", path: "README.md" },
          toolCallId: "tool-1",
          toolName: "Read",
          type: "tool-result",
        };
        yield {
          finishReason: "stop",
          type: "finish-step",
          usage: { inputTokens: 11, outputTokens: 3, totalTokens: 14 },
        };
        yield { finishReason: "stop", totalUsage: { totalTokens: 4 }, type: "finish" };
      })(),
    });
    const getLanguageModel = vi.fn().mockReturnValue({ modelId: "deepseek-v4-pro" });

    const events = [];
    for await (const event of runAgentLoop(withReadableWritingTarget({
      messages: [{ content: "Read README", role: "user" }],
      modelProvider: { getLanguageModel },
      profile: mainAgentProfile,
      streamText,
      workspaceRoot: "/tmp/workspace",
    }))) {
      events.push(event);
    }

    expect(getLanguageModel).toHaveBeenCalledWith(
      "deepseek-v4-pro",
      "deepseek",
      "builtin:deepseek:main",
    );
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        activeTools: [
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
        ],
        maxOutputTokens: 12288,
        messages: [{ content: "Read README", role: "user" }],
        model: { modelId: "deepseek-v4-pro" },
        system: expect.stringContaining(mainAgentProfile.systemPrompt),
        tools: expect.objectContaining({
          Create: expect.any(Object),
          CreateDirectory: expect.any(Object),
          Edit: expect.any(Object),
          Glob: expect.any(Object),
          Grep: expect.any(Object),
          ListSkills: expect.any(Object),
          Read: expect.any(Object),
          Search: expect.any(Object),
          DelegateWriting: expect.any(Object),
          CreateWritingEditProposal: expect.any(Object),
          SpawnSubAgent: expect.any(Object),
          UpdatePlan: expect.any(Object),
          UseSkill: expect.any(Object),
        }),
      }),
    );
    expect(events).toEqual([
      { text: "Hello", type: "text-delta" },
      { input: { path: "README.md" }, toolCallId: "tool-1", toolName: "Read", type: "tool-call" },
      {
        output: { content: "file text", path: "README.md" },
        toolCallId: "tool-1",
        toolName: "Read",
        type: "tool-result",
      },
      {
        finishReason: "stop",
        type: "finish-step",
        usage: { inputTokens: 11, outputTokens: 3, totalTokens: 14 },
      },
      { finishReason: "stop", totalUsage: { totalTokens: 4 }, type: "finish" },
    ]);
  });

  it("omits temperature for an Anthropic model that rejects sampling parameters", async () => {
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { finishReason: "stop", totalUsage: {}, type: "finish" };
      })(),
    });

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      messages: [{ content: "Continue", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      resolveLlmProfileForRole: vi.fn(() => ({
        available: true,
        contextWindowTokens: 1_000_000,
        id: "builtin:anthropic:main",
        llmProfileRole: "main" as const,
        maxOutputTokens: 4096,
        modelId: "claude-opus-5",
        name: "Anthropic 通常",
        providerId: "anthropic" as const,
        source: "built-in" as const,
        supportsTemperature: false,
        temperature: 0.3,
      })),
      streamText,
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(streamText.mock.calls[0]?.[0]).not.toHaveProperty("temperature");
  });

  it("passes the fallback writing profile output limit to DelegateWriting", async () => {
    const targetPath = "manuscript/chapter-01.txt";
    const generateObject = vi.fn(async () => ({
      object: { newText: "after", oldText: "before" },
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    }));
    const getLanguageModel = vi.fn((modelId: string) => ({ modelId }));
    const streamText = vi.fn(
      (options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
        fullStream: (async function* () {
          await options.tools.Read.execute({ path: targetPath });
          const output = await options.tools.DelegateWriting.execute({
            instruction: "Rewrite the chapter.",
            targetPath,
          });
          yield { output, toolCallId: "writing-1", toolName: "DelegateWriting", type: "tool-result" };
          yield { finishReason: "stop", totalUsage: {}, type: "finish" };
        })(),
      }),
    );

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      generateObject,
      messages: [{ content: "Rewrite the chapter", role: "user" }],
      modelProvider: { getLanguageModel: getLanguageModel as never },
      profile: mainAgentProfile,
      streamText: streamText as unknown as RunAgentLoopOptions["streamText"],
      toolServices: {
        readWorkspaceFile: vi.fn(async () => ({
          content: "before",
          path: targetPath,
          totalLines: 1,
          truncated: false,
        })),
      },
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(getLanguageModel).toHaveBeenNthCalledWith(
      2,
      "deepseek-v4-pro",
      "deepseek",
      "builtin:deepseek:writing",
    );
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 65536,
        model: { modelId: "deepseek-v4-pro" },
      }),
    );
  });

  it("uses the profile stop condition so tool calls can continue into later model steps", async () => {
    const stopWhen = stepCountIs(8);
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { finishReason: "tool-calls", totalUsage: { totalTokens: 8 }, type: "finish" };
      })(),
    });

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      messages: [{ content: "Save a memo", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: {
        ...mainAgentProfile,
        stopWhen,
      },
      streamText,
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        stopWhen,
      }),
    );
  });

  it("loads workspace AGENTS.md and appends it after fixed and profile system rules", async () => {
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { finishReason: "stop", totalUsage: { totalTokens: 1 }, type: "finish" };
      })(),
    });
    const loadWorkspaceInstructions = vi.fn().mockResolvedValue({
      content: "Use workspace conventions.",
      hash: "hash",
      loaded: true,
      loadedAt: "2026-05-10T00:00:00.000Z",
      path: "AGENTS.md",
    });

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      loadWorkspaceInstructions,
      messages: [{ content: "Follow instructions", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      streamText,
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(loadWorkspaceInstructions).toHaveBeenCalledWith({ workspaceRoot: "/tmp/workspace" });
    const system = streamText.mock.calls[0]?.[0]?.system;
    expect(system).toContain("Never access files outside the active workspace");
    expect(system).toContain(mainAgentProfile.systemPrompt);
    expect(system).toContain("Use workspace conventions.");
    expect(system.indexOf("Never access files outside")).toBeLessThan(
      system.indexOf(mainAgentProfile.systemPrompt),
    );
    expect(system.indexOf(mainAgentProfile.systemPrompt)).toBeLessThan(
      system.indexOf("Use workspace conventions."),
    );
  });

  it("adds runtime datetime context to the system prompt before workspace AGENTS.md instructions", async () => {
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { finishReason: "stop", totalUsage: { totalTokens: 1 }, type: "finish" };
      })(),
    });
    const loadWorkspaceInstructions = vi.fn().mockResolvedValue({
      content: "Use workspace conventions.",
      hash: "hash",
      loaded: true,
      loadedAt: "2026-05-10T00:00:00.000Z",
      path: "AGENTS.md",
    });

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      loadWorkspaceInstructions,
      messages: [{ content: "What should I write today?", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      runtimeContext: {
        currentDate: "2026-05-12",
        currentDateTimeIso: "2026-05-12T08:30:00.000+09:00",
        currentDateTimeReadable: "May 12, 2026, 8:30 AM GMT+9",
        timezone: "Asia/Tokyo",
      },
      streamText,
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    const system = streamText.mock.calls[0]?.[0]?.system;
    expect(system).toContain("Runtime datetime context:");
    expect(system).toContain("currentDateTimeIso: 2026-05-12T08:30:00.000+09:00");
    expect(system).toContain("currentDate: 2026-05-12");
    expect(system).toContain("timezone: Asia/Tokyo");
    expect(system).toContain("currentDateTimeReadable: May 12, 2026, 8:30 AM GMT+9");
    expect(system.indexOf("Runtime datetime context:")).toBeLessThan(
      system.indexOf("Workspace AGENTS.md instructions:"),
    );
  });

  it("loads cached workspace structure context into the system prompt", async () => {
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { finishReason: "stop", totalUsage: { totalTokens: 1 }, type: "finish" };
      })(),
    });
    const loadWorkspaceStructureContext = vi.fn().mockResolvedValue({
      directoryCount: 1,
      fileCount: 2,
      generatedAt: "2026-05-12T00:00:00.000Z",
      omittedEntryCount: 0,
      summary: "./\nsrc/\nsrc/app.ts",
      truncated: false,
      workspaceRoot: "/tmp/workspace",
    });

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      loadWorkspaceStructureContext,
      messages: [{ content: "Where is the app?", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      streamText,
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(loadWorkspaceStructureContext).toHaveBeenCalledWith({ workspaceRoot: "/tmp/workspace" });
    const system = streamText.mock.calls[0]?.[0]?.system;
    expect(system).toContain("Cached workspace structure overview:");
    expect(system).toContain("src/app.ts");
    expect(system).not.toContain("/tmp/workspace");
  });

  it("loads recent text files context into the system prompt", async () => {
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { finishReason: "stop", totalUsage: { totalTokens: 1 }, type: "finish" };
      })(),
    });
    const loadRecentTextFilesContext = vi.fn().mockResolvedValue({
      files: [
        {
          mtime: "2026-05-12T00:00:00.000Z",
          path: "notes/today.md",
          size: 14,
        },
      ],
      generatedAt: "2026-05-12T00:01:00.000Z",
      maxFiles: 10,
      omittedFileCount: 0,
      truncated: false,
    });

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      loadRecentTextFilesContext,
      messages: [{ content: "What was I working on?", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      streamText,
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(loadRecentTextFilesContext).toHaveBeenCalledWith({ workspaceRoot: "/tmp/workspace" });
    const system = streamText.mock.calls[0]?.[0]?.system;
    expect(system).toContain("Recently modified text files:");
    expect(system).toContain("path: notes/today.md");
    expect(system).not.toContain("/tmp/workspace");
  });

  it("adds current chapter reference context into the system prompt", async () => {
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { finishReason: "stop", totalUsage: { totalTokens: 1 }, type: "finish" };
      })(),
    });

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      currentFilePath: "小説\\第001章\\本文.txt",
      messages: [{ content: "続きを書いて", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      streamText,
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    const system = streamText.mock.calls[0]?.[0]?.system;
    expect(system).toContain("Visible chapter reference context:");
    expect(system).toContain("currentFilePath: 小説/第001章/本文.txt");
    expect(system).toContain("小説/第001章/章内プロット.md");
    expect(system).toContain("Treat AGENTS.md as workspace instructions");
  });

  it("adds current chapter completion summary update context into the system prompt", async () => {
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { finishReason: "stop", totalUsage: { totalTokens: 1 }, type: "finish" };
      })(),
    });

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      currentFilePath: "小説\\第001章\\本文.txt",
      messages: [{ content: "この章を書き終えたので概要を更新して", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      streamText,
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    const system = streamText.mock.calls[0]?.[0]?.system;
    expect(system).toContain("Chapter completion summary update guidance:");
    expect(system).toContain("currentFilePath: 小説/第001章/本文.txt");
    expect(system).toContain("- 小説/第001章/概要.md");
    expect(system).toContain("- 小説/第001章/章内プロット.md");
    expect(system).toContain("Read the completed chapter manuscript before proposing a summary update.");
    expect(system).toContain("If an existing target file is present, create an Edit proposal.");
    expect(system).toContain("If no target file exists, create a Create proposal");
  });

  it("passes AgentToolPlugin tools through to streamText and allows plugin activeTools", async () => {
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { finishReason: "stop", totalUsage: { totalTokens: 1 }, type: "finish" };
      })(),
    });

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      messages: [{ content: "Use plugin", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      plugins: [
        {
          createTools: () => ({
            EchoWorkspace: tool({
              description: "Return the active workspace root.",
              inputSchema: z.object({}),
              execute: () => ({}),
            }),
          }),
          displayName: "Echo workspace",
          id: "echo-workspace",
          kind: "agent-tool",
        },
      ],
      profile: {
        ...mainAgentProfile,
        activeTools: ["Read", "EchoWorkspace"],
      },
      streamText,
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        activeTools: ["Read", "EchoWorkspace"],
        tools: {
          EchoWorkspace: expect.any(Object),
          Read: expect.any(Object),
        },
      }),
    );
  });

  it("applies the trusted catalog grant inside runAgentLoop", async () => {
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { finishReason: "stop", totalUsage: { totalTokens: 1 }, type: "finish" };
      })(),
    });
    const trustedAgentExtensions = createTrustedAgentExtensionCatalog({
      profileToolGrants: { "main-agent": ["EchoWorkspace"] },
      skillPlugins: [],
      toolPlugins: [
        {
          createTools: () => ({
            EchoWorkspace: tool({
              description: "Return the active workspace root.",
              inputSchema: z.object({}),
              execute: () => ({}),
            }),
          }),
          displayName: "Echo workspace",
          id: "echo-workspace",
          kind: "agent-tool",
        },
      ],
    });

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      messages: [{ content: "Use trusted plugin", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      streamText,
      trustedAgentExtensions,
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        activeTools: [...mainAgentProfile.activeTools, "EchoWorkspace"],
        tools: expect.objectContaining({
          EchoWorkspace: expect.any(Object),
        }),
      }),
    );
  });

  it("excludes registered plugin tools that are not active for the profile", async () => {
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { finishReason: "stop", totalUsage: { totalTokens: 1 }, type: "finish" };
      })(),
    });

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      messages: [{ content: "Read without plugin", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      plugins: [
        {
          createTools: () => ({
            EchoWorkspace: tool({
              description: "Return the active workspace root.",
              inputSchema: z.object({}),
              execute: () => ({}),
            }),
          }),
          displayName: "Echo workspace",
          id: "echo-workspace",
          kind: "agent-tool",
        },
      ],
      profile: {
        ...mainAgentProfile,
        activeTools: ["Read"],
      },
      streamText,
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(streamText.mock.calls[0]?.[0]?.tools).toEqual({
      Read: expect.any(Object),
    });
    expect(streamText.mock.calls[0]?.[0]?.tools).not.toHaveProperty("EchoWorkspace");
  });

  it("only passes profile-allowed tools to streamText", async () => {
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { finishReason: "stop", totalUsage: { totalTokens: 1 }, type: "finish" };
      })(),
    });

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      messages: [{ content: "Read files", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: {
        ...mainAgentProfile,
        activeTools: ["Read", "Grep"],
      },
      streamText,
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(streamText.mock.calls[0]?.[0]?.tools).toEqual({
      Grep: expect.any(Object),
      Read: expect.any(Object),
    });
    expect(streamText.mock.calls[0]?.[0]?.tools).not.toHaveProperty("Edit");
    expect(streamText.mock.calls[0]?.[0]?.tools).not.toHaveProperty("Create");
    expect(streamText.mock.calls[0]?.[0]?.tools).not.toHaveProperty("SpawnSubAgent");
  });

  it("adds activated skill instructions to the next AI SDK step without duplicating them", async () => {
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { finishReason: "stop", totalUsage: { totalTokens: 1 }, type: "finish" };
      })(),
    });

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      messages: [{ content: "Use a skill", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      streamText,
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    const firstCallOptions = streamText.mock.calls[0]?.[0];
    await firstCallOptions.tools.UseSkill.execute(
      { skillId: builtInAgentSkills[0].id },
      {} as never,
    );
    await firstCallOptions.tools.UseSkill.execute(
      { skillId: builtInAgentSkills[0].id },
      {} as never,
    );

    const prepared = await firstCallOptions.prepareStep({
      experimental_context: undefined,
      messages: [],
      model: {},
      stepNumber: 1,
      steps: [],
    });
    const system = prepared.system;

    expect(system).toContain("Activated agent skills:");
    expect(system).toContain(builtInAgentSkills[0].instruction);
    expect(system.match(new RegExp(builtInAgentSkills[0].instruction, "g"))).toHaveLength(1);
  });

  it("does not let skill requiredTools enable tools outside the active profile", async () => {
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { finishReason: "stop", totalUsage: { totalTokens: 1 }, type: "finish" };
      })(),
    });

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      messages: [{ content: "Use skills", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: {
        ...mainAgentProfile,
        activeTools: ["ListSkills", "UseSkill"],
      },
      streamText,
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(streamText.mock.calls[0]?.[0]?.activeTools).toEqual(["ListSkills", "UseSkill"]);
    expect(streamText.mock.calls[0]?.[0]?.tools).toEqual({
      ListSkills: expect.any(Object),
      UseSkill: expect.any(Object),
    });
  });

  it("adds activated plugin skill instructions to later AI SDK steps", async () => {
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { finishReason: "stop", totalUsage: { totalTokens: 1 }, type: "finish" };
      })(),
    });

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      messages: [{ content: "Use a plugin skill", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      skillPlugins: [
        {
          createSkills: () => [
            {
              id: "project-review",
              displayName: "Project review",
              description: "Use project review conventions.",
              instruction: "Project review private instructions.",
              requiredTools: ["ImaginaryTool"],
            },
          ],
          displayName: "Project skills",
          id: "project",
          kind: "agent-skill",
        },
      ],
      streamText,
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    const firstCallOptions = streamText.mock.calls[0]?.[0];
    await firstCallOptions.tools.UseSkill.execute({ skillId: "project-review" }, {} as never);

    const prepared = await firstCallOptions.prepareStep({
      experimental_context: undefined,
      messages: [],
      model: {},
      stepNumber: 1,
      steps: [],
    });

    expect(prepared.system).toContain("Activated agent skills:");
    expect(prepared.system).toContain("Project review private instructions.");
    expect(streamText.mock.calls[0]?.[0]?.activeTools).toEqual(mainAgentProfile.activeTools);
    expect(streamText.mock.calls[0]?.[0]?.tools).not.toHaveProperty("ImaginaryTool");
  });

  it("throws when activeTools includes a tool that does not exist", async () => {
    const drainLoop = async () => {
      for await (const _event of runAgentLoop(withReadableWritingTarget({
        messages: [{ content: "Use missing tool", role: "user" }],
        modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
        profile: {
          ...mainAgentProfile,
          activeTools: ["Read", "MissingTool"],
        },
        streamText: vi.fn(),
        workspaceRoot: "/tmp/workspace",
      }))) {
        // drain stream
      }
    };

    await expect(drainLoop()).rejects.toThrow(/MissingTool/);
  });

  it("forwards request-scoped dropped text file services to the chat tools", async () => {
    const readDroppedTextFile = vi.fn(async () => ({
      content: "原文",
      name: "memo.txt",
      totalLines: 1,
      truncated: false,
    }));
    const placeDroppedTextFile = vi.fn(async () => ({
      operation: "create" as const,
      path: "memo.txt",
      status: "applied" as const,
    }));
    const streamText = vi.fn(
      (
        streamOptions: Parameters<
          NonNullable<RunAgentLoopOptions["streamText"]>
        >[0],
      ) => ({
        fullStream: (async function* () {
          await streamOptions.tools.ReadDroppedTextFile!.execute?.(
            { droppedFileId: "opaque-1" },
            {} as never,
          );
          await streamOptions.tools.PlaceDroppedTextFile!.execute?.(
            {
              droppedFileId: "opaque-1",
              targetPath: "memo.txt",
            },
            {} as never,
          );
          yield {
            finishReason: "stop",
            totalUsage: {},
            type: "finish" as const,
          };
        })(),
      }),
    );

    for await (const _event of runAgentLoop(
      withReadableWritingTarget({
        messages: [{ content: "配置して", role: "user" }],
        modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
        profile: chatModeAgentProfile,
        streamText,
        toolServices: { placeDroppedTextFile, readDroppedTextFile },
        workspaceRoot: "/tmp/workspace",
      }),
    )) {
      // drain stream
    }

    expect(readDroppedTextFile).toHaveBeenCalledWith({ droppedFileId: "opaque-1" });
    expect(placeDroppedTextFile).toHaveBeenCalledWith({
      droppedFileId: "opaque-1",
      targetPath: "memo.txt",
    });
  });

  it("runs a read-only sub-agent through SpawnSubAgent and returns the summary", async () => {
    const streamText = vi
      .fn()
      .mockReturnValueOnce({
        fullStream: (async function* () {
          yield {
            input: {
              profileId: "read-only-sub-agent",
              prompt: "Find references to runAgentLoop.",
              purpose: "Locate relevant files",
            },
            toolCallId: "tool-1",
            toolName: "SpawnSubAgent",
            type: "tool-call",
          };
          yield { finishReason: "stop", totalUsage: { totalTokens: 1 }, type: "finish" };
        })(),
      })
      .mockReturnValueOnce({
        fullStream: (async function* () {
          yield { text: "Found src/features/ai-agent/runAgentLoop.ts", type: "text-delta" };
          yield { finishReason: "stop", totalUsage: { totalTokens: 4 }, type: "finish" };
        })(),
      });
    const getLanguageModel = vi.fn().mockReturnValue({});

    const events = [];
    for await (const event of runAgentLoop(withReadableWritingTarget({
      messages: [{ content: "Inspect the loop", role: "user" }],
      modelProvider: { getLanguageModel },
      profile: mainAgentProfile,
      streamText,
      workspaceRoot: "/tmp/workspace",
    }))) {
      events.push(event);
      if (event.type === "tool-call" && event.toolName === "SpawnSubAgent") {
        const execute = streamText.mock.calls[0]?.[0]?.tools.SpawnSubAgent.execute;
        const output = await execute(event.input, {} as never);
        events.push({
          output,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          type: "tool-result",
        });
      }
    }

    expect(streamText).toHaveBeenCalledTimes(2);
    expect(streamText.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        activeTools: ["Read", "Glob", "Grep", "Search"],
        messages: [
          {
            content: "Purpose: Locate relevant files\n\nFind references to runAgentLoop.",
            role: "user",
          },
        ],
        tools: expect.objectContaining({
          Glob: expect.any(Object),
          Grep: expect.any(Object),
          Read: expect.any(Object),
          Search: expect.any(Object),
        }),
      }),
    );
    expect(streamText.mock.calls[1]?.[0]?.tools).not.toHaveProperty("SpawnSubAgent");
    expect(streamText.mock.calls[1]?.[0]?.tools).not.toHaveProperty("CreateWritingEditProposal");
    expect(events).toContainEqual({
      output: {
        profileId: "read-only-sub-agent",
        status: "completed",
        summary: "Found src/features/ai-agent/runAgentLoop.ts",
        tokenUsage: {
          llmProfileId: "builtin:deepseek:simple",
          llmProfileRole: "simple",
          modelId: "deepseek-v4-flash",
          providerId: "deepseek",
          totalTokens: 4,
        },
      },
      toolCallId: "tool-1",
      toolName: "SpawnSubAgent",
      type: "tool-result",
    });
  });

  it("propagates trusted extensions and the search role resolver into a sub-agent run", async () => {
    const streamText = vi
      .fn()
      .mockReturnValueOnce({
        fullStream: (async function* () {
          yield { finishReason: "stop", totalUsage: { totalTokens: 1 }, type: "finish" };
        })(),
      })
      .mockReturnValueOnce({
        fullStream: (async function* () {
          yield { text: "search complete", type: "text-delta" };
          yield { finishReason: "stop", totalUsage: { totalTokens: 2 }, type: "finish" };
        })(),
      });
    const createSkills = vi.fn(() => [
      {
        description: "Search guidance",
        displayName: "Search guidance",
        id: "search-guidance",
        instruction: "Use focused search queries.",
      },
    ]);
    const trustedAgentExtensions = createTrustedAgentExtensionCatalog({
      profileToolGrants: { "workspace-search-sub-agent": ["EchoSearchContext"] },
      skillPlugins: [
        {
          createSkills,
          displayName: "Search skills",
          id: "search-skills",
          kind: "agent-skill",
        },
      ],
      toolPlugins: [
        {
          createTools: () => ({
            EchoSearchContext: tool({
              description: "Return search context metadata.",
              inputSchema: z.object({}),
              execute: () => ({}),
            }),
          }),
          displayName: "Search context",
          id: "search-context",
          kind: "agent-tool",
        },
      ],
    });
    const resolveLlmProfileForRole = vi.fn((role: LlmProfileRole) => ({
      available: true,
      contextWindowTokens: 100_000,
      id: `test:${role}`,
      llmProfileRole: role,
      maxOutputTokens: 2048,
      modelId: `${role}-model`,
      name: `${role} profile`,
      providerId: "deepseek" as const,
      source: "built-in" as const,
      temperature: 0.2,
    }));

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      messages: [{ content: "Search the workspace", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      resolveLlmProfileForRole,
      streamText,
      trustedAgentExtensions,
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    const execute = streamText.mock.calls[0]?.[0]?.tools.SpawnSubAgent.execute;
    await execute(
      {
        profileId: "workspace-search-sub-agent",
        prompt: "Find runtime references",
        purpose: "Search runtime code",
      },
      {} as never,
    );

    expect(streamText.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        activeTools: ["Read", "Glob", "Grep", "Search", "EchoSearchContext"],
        tools: expect.objectContaining({ EchoSearchContext: expect.any(Object) }),
      }),
    );
    expect(resolveLlmProfileForRole.mock.calls.map(([role]) => role)).toEqual([
      "main",
      "search",
      "search",
    ]);
    expect(createSkills).toHaveBeenCalledTimes(2);
  });

  it("returns a structured error for unknown sub-agent profiles", async () => {
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { finishReason: "stop", totalUsage: { totalTokens: 1 }, type: "finish" };
      })(),
    });

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      messages: [{ content: "Use sub-agent", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      streamText,
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    const execute = streamText.mock.calls[0]?.[0]?.tools.SpawnSubAgent.execute;
    await expect(
      execute(
        {
          profileId: "missing-sub-agent",
          prompt: "Look around",
          purpose: "Unknown profile test",
        },
        {} as never,
      ),
    ).resolves.toEqual({
      message: "Unknown sub-agent profile: missing-sub-agent",
      profileId: "missing-sub-agent",
      status: "error",
    });
  });

  it("limits sub-agent spawns per main agent run", async () => {
    const streamText = vi
      .fn()
      .mockReturnValueOnce({
        fullStream: (async function* () {
          yield { finishReason: "stop", totalUsage: { totalTokens: 1 }, type: "finish" };
        })(),
      })
      .mockReturnValue({
        fullStream: (async function* () {
          yield { text: "done", type: "text-delta" };
          yield { finishReason: "stop", totalUsage: { totalTokens: 1 }, type: "finish" };
        })(),
      });

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      maxSubAgentSpawns: 1,
      messages: [{ content: "Use sub-agent", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      streamText,
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    const execute = streamText.mock.calls[0]?.[0]?.tools.SpawnSubAgent.execute;
    await expect(
      execute(
        {
          profileId: "read-only-sub-agent",
          prompt: "First",
          purpose: "First investigation",
        },
        {} as never,
      ),
    ).resolves.toMatchObject({ status: "completed" });
    await expect(
      execute(
        {
          profileId: "read-only-sub-agent",
          prompt: "Second",
          purpose: "Second investigation",
        },
        {} as never,
      ),
    ).resolves.toEqual({
      message: "Sub-agent spawn limit exceeded: 1",
      profileId: "read-only-sub-agent",
      status: "error",
    });
  });

  it("runs Read -> DelegateWriting -> CreateWritingEditProposal without exposing artifact text to main", async () => {
    const targetPath = "manuscript/chapter-01.txt";
    const oldText = "BEFORE_MARKER";
    const newText = "AFTER_MARKER__WRITING_MODEL_OUTPUT__";
    const callOrder: string[] = [];
    const createEditProposal = vi.fn((input) => ({
      createdAt: "2026-06-20T00:00:00.000Z",
      diff: "diff",
      id: "proposal-1",
      newText: input.newText,
      oldText: input.oldText,
      operation: "edit" as const,
      path: input.path,
      status: "pending" as const,
      title: `Edit ${input.path}`,
      updatedAt: "2026-06-20T00:00:00.000Z",
    }));
    const readWorkspaceFile = vi.fn(async (input) => ({
      content: `chapter context\n${oldText}`,
      path: input.path,
      totalLines: 2,
      truncated: false,
    }));
    const generateObject = vi.fn(async () => ({
      object: { newText, oldText },
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
    }));
    const resolveLlmProfileForRole = vi.fn((role: LlmProfileRole) => ({
      available: true,
      contextWindowTokens: 1_000_000,
      id: `test:${role}`,
      llmProfileRole: role,
      maxOutputTokens: role === "writing" ? 6000 : 4000,
      modelId: `${role}-model`,
      name: `${role} profile`,
      providerId: "deepseek" as const,
      source: "built-in" as const,
      temperature: role === "writing" ? 0.7 : 0.2,
    }));
    const getLanguageModel = vi.fn((modelId: string) => ({ modelId }));
    const streamText = vi.fn((options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
      fullStream: (async function* () {
        const readInput = { path: targetPath };
        callOrder.push("Read");
        yield { input: readInput, toolCallId: "read-1", toolName: "Read", type: "tool-call" };
        const readOutput = await options.tools.Read.execute(readInput);
        yield { output: readOutput, toolCallId: "read-1", toolName: "Read", type: "tool-result" };

        const delegationInput = { instruction: "Continue the chapter.", targetPath };
        callOrder.push("DelegateWriting");
        yield { input: delegationInput, toolCallId: "writing-1", toolName: "DelegateWriting", type: "tool-call" };
        const delegationOutput = await options.tools.DelegateWriting.execute(delegationInput);
        yield { output: delegationOutput, toolCallId: "writing-1", toolName: "DelegateWriting", type: "tool-result" };

        expect(delegationOutput).not.toHaveProperty("artifact");
        const artifactId = (delegationOutput as { artifactId: string }).artifactId;
        const proposalInput = { artifactId };
        callOrder.push("CreateWritingEditProposal");
        yield {
          input: proposalInput,
          toolCallId: "writing-edit-1",
          toolName: "CreateWritingEditProposal",
          type: "tool-call",
        };
        const editOutput = await options.tools.CreateWritingEditProposal.execute(proposalInput);
        yield {
          output: editOutput,
          toolCallId: "writing-edit-1",
          toolName: "CreateWritingEditProposal",
          type: "tool-result",
        };
        yield { finishReason: "stop", totalUsage: { totalTokens: 3 }, type: "finish" };
      })(),
    }));

    const events = [];
    for await (const event of runAgentLoop(withReadableWritingTarget({
      generateObject,
      messages: [{ content: "続きを書いて", role: "user" }],
      modelProvider: { getLanguageModel: getLanguageModel as never },
      profile: mainAgentProfile,
      resolveLlmProfileForRole: resolveLlmProfileForRole as RunAgentLoopOptions["resolveLlmProfileForRole"],
      streamText: streamText as unknown as RunAgentLoopOptions["streamText"],
      toolServices: { createEditProposal, readWorkspaceFile },
      workspaceRoot: "/tmp/workspace",
    }))) {
      events.push(event);
    }

    expect(callOrder).toEqual(["Read", "DelegateWriting", "CreateWritingEditProposal"]);
    expect(resolveLlmProfileForRole.mock.calls.map(([role]) => role)).toEqual(["main", "writing"]);
    expect(getLanguageModel).toHaveBeenNthCalledWith(1, "main-model", "deepseek", "test:main");
    expect(getLanguageModel).toHaveBeenNthCalledWith(2, "writing-model", "deepseek", "test:writing");
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 6000,
        model: { modelId: "writing-model" },
        prompt: expect.stringContaining(`chapter context\n${oldText}`),
        temperature: 0.7,
      }),
    );
    expect(events).toContainEqual({
      output: expect.objectContaining({
        artifactId: expect.any(String),
        latencyMs: expect.any(Number),
        status: "completed",
        targetPath,
        tokenUsage: {
          inputTokens: 11,
          llmProfileId: "test:writing",
          llmProfileRole: "writing",
          modelId: "writing-model",
          outputTokens: 7,
          providerId: "deepseek",
          totalTokens: 18,
        },
      }),
      toolCallId: "writing-1",
      toolName: "DelegateWriting",
      type: "tool-result",
    });
    expect(events).toContainEqual({
      output: expect.objectContaining({ newText, oldText, path: targetPath, sourceRole: "writing" }),
      toolCallId: "writing-edit-1",
      toolName: "CreateWritingEditProposal",
      type: "tool-result",
    });
    expect(createEditProposal).toHaveBeenCalledWith(
      expect.objectContaining({ newText, oldText, path: targetPath }),
    );
    expect(JSON.stringify(events.find(
      (event) => event.type === "tool-result" && event.toolName === "DelegateWriting",
    ))).not.toContain(oldText);
    expect(JSON.stringify(events.find(
      (event) => event.type === "tool-result" && event.toolName === "DelegateWriting",
    ))).not.toContain(newText);
  });

  it("delegates a missing target without Read and creates an observable writing Create proposal", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-writing-create-"));
    const targetPath = "manuscript/scene-02.txt";
    const instruction = "Write the next scene from the chapter plot.";
    const newText = "First line.\n\nSecond line with exact spacing.\n";
    mkdirSync(path.join(workspaceRoot, "manuscript"));
    try {
      const generateObject = vi.fn(async () => ({
        object: {
          content: newText,
          newText,
          oldText: "the writing model must not decide create versus edit",
        },
        usage: { inputTokens: 9, outputTokens: 12, totalTokens: 21 },
      }));
      const resolveLlmProfileForRole = vi.fn((role: LlmProfileRole) => ({
        available: true,
        contextWindowTokens: 1_000_000,
        id: `test:${role}`,
        llmProfileRole: role,
        maxOutputTokens: role === "writing" ? 6000 : 4000,
        modelId: `${role}-model`,
        name: `${role} profile`,
        providerId: "deepseek" as const,
        source: "built-in" as const,
        temperature: role === "writing" ? 0.7 : 0.2,
      }));
      const streamText = vi.fn(
        (options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
          fullStream: (async function* () {
            const delegationInput = { instruction, targetPath };
            yield {
              input: delegationInput,
              toolCallId: "writing-create-1",
              toolName: "DelegateWriting",
              type: "tool-call",
            };
            const delegationOutput = await options.tools.DelegateWriting.execute(delegationInput);
            yield {
              output: delegationOutput,
              toolCallId: "writing-create-1",
              toolName: "DelegateWriting",
              type: "tool-result",
            };

            const artifactId = (delegationOutput as { artifactId: string }).artifactId;
            const proposalInput = { artifactId };
            yield {
              input: proposalInput,
              toolCallId: "writing-proposal-1",
              toolName: "CreateWritingEditProposal",
              type: "tool-call",
            };
            const proposalOutput = await options.tools.CreateWritingEditProposal.execute(
              proposalInput,
            );
            yield {
              output: proposalOutput,
              toolCallId: "writing-proposal-1",
              toolName: "CreateWritingEditProposal",
              type: "tool-result",
            };
            yield { finishReason: "stop", totalUsage: {}, type: "finish" };
          })(),
        }),
      );

      const events = [];
      for await (const event of runAgentLoop({
        generateObject,
        messages: [{ content: "新しいシーンを書いて", role: "user" }],
        modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
        profile: mainAgentProfile,
        resolveLlmProfileForRole:
          resolveLlmProfileForRole as RunAgentLoopOptions["resolveLlmProfileForRole"],
        streamText: streamText as unknown as RunAgentLoopOptions["streamText"],
        workspaceRoot,
      })) {
        events.push(event);
      }

      expect(generateObject).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringMatching(/new (?:file|manuscript)|新規/i),
        }),
      );
      const delegationEvent = events.find(
        (event) => event.type === "tool-result" && event.toolName === "DelegateWriting",
      );
      expect(delegationEvent).toEqual({
        output: expect.objectContaining({
          artifactId: expect.any(String),
          operation: "create",
          status: "completed",
          targetPath,
        }),
        toolCallId: "writing-create-1",
        toolName: "DelegateWriting",
        type: "tool-result",
      });
      expect(JSON.stringify(delegationEvent)).not.toContain(newText);
      expect(JSON.stringify(delegationEvent)).not.toContain("the writing model must not decide");
      expect(events).toContainEqual({
        output: expect.objectContaining({
          newText,
          oldText: "",
          operation: "create",
          path: targetPath,
          sourceRole: "writing",
        }),
        toolCallId: "writing-proposal-1",
        toolName: "CreateWritingEditProposal",
        type: "tool-result",
      });
    } finally {
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("creates an edit proposal for an existing empty file after Read", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-writing-empty-"));
    const targetPath = "empty.txt";
    const newText = "First scene line.\n";
    writeFileSync(path.join(workspaceRoot, targetPath), "", "utf8");
    try {
      const generateObject = vi.fn(async () => ({
        object: { oldText: "", newText },
        usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
      }));
      const streamText = vi.fn(
        (options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
          fullStream: (async function* () {
            await options.tools.Read.execute({ path: targetPath });
            const delegated = (await options.tools.DelegateWriting.execute({
              instruction: "Write the opening line.",
              targetPath,
            })) as { artifactId: string };
            const proposalOutput = await options.tools.CreateWritingEditProposal.execute({
              artifactId: delegated.artifactId,
            });
            yield {
              output: proposalOutput,
              toolCallId: "writing-proposal-empty",
              toolName: "CreateWritingEditProposal",
              type: "tool-result",
            };
            yield { finishReason: "stop", totalUsage: {}, type: "finish" };
          })(),
        }),
      );

      const events = [];
      for await (const event of runAgentLoop({
        generateObject,
        messages: [{ content: "空ファイルに書いて", role: "user" }],
        modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
        profile: mainAgentProfile,
        streamText: streamText as unknown as RunAgentLoopOptions["streamText"],
        workspaceRoot,
      })) {
        events.push(event);
      }

      expect(events).toContainEqual({
        output: expect.objectContaining({
          newText,
          oldText: "",
          operation: "edit",
          path: targetPath,
          sourceRole: "writing",
        }),
        toolCallId: "writing-proposal-empty",
        toolName: "CreateWritingEditProposal",
        type: "tool-result",
      });
    } finally {
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not consume a create writing artifact when create proposal creation fails", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-writing-create-retry-"));
    const targetPath = "manuscript/scene-03.txt";
    mkdirSync(path.join(workspaceRoot, "manuscript"));
    let retryOutput: unknown;
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
    const streamText = vi.fn(
      (options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
        fullStream: (async function* () {
          const delegated = (await options.tools.DelegateWriting.execute({
            instruction: "Write the scene.",
            targetPath,
          })) as { artifactId: string };
          let firstError: unknown;
          try {
            await options.tools.CreateWritingEditProposal.execute({
              artifactId: delegated.artifactId,
            });
          } catch (error) {
            firstError = error;
          }
          retryOutput = await options.tools.CreateWritingEditProposal.execute({
            artifactId: delegated.artifactId,
          });
          yield { finishReason: "stop", totalUsage: {}, type: "finish" };
          expect(firstError).toEqual(
            expect.objectContaining({ message: "proposal validation failed" }),
          );
        })(),
      }),
    );

    try {
      for await (const _event of runAgentLoop({
        generateObject: vi.fn(async () => ({
          object: { content: "Scene prose.\n" },
          usage: {},
        })),
        messages: [{ content: "新しいシーンを書いて", role: "user" }],
        modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
        profile: mainAgentProfile,
        streamText: streamText as unknown as RunAgentLoopOptions["streamText"],
        toolServices: { createFileProposal },
        workspaceRoot,
      })) {
        // drain stream
      }

      expect(createFileProposal).toHaveBeenCalledTimes(2);
      expect(retryOutput).toMatchObject({
        operation: "create",
        path: targetPath,
        sourceRole: "writing",
      });
    } finally {
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("rejects create writing proposals when the target file appears before proposal creation", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-writing-create-race-"));
    const targetPath = "manuscript/scene-04.txt";
    mkdirSync(path.join(workspaceRoot, "manuscript"));
    let proposalError: unknown;
    const streamText = vi.fn(
      (options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
        fullStream: (async function* () {
          const delegated = (await options.tools.DelegateWriting.execute({
            instruction: "Write the scene.",
            targetPath,
          })) as { artifactId: string };
          writeFileSync(path.join(workspaceRoot, targetPath), "already created", "utf8");
          try {
            await options.tools.CreateWritingEditProposal.execute({
              artifactId: delegated.artifactId,
            });
          } catch (error) {
            proposalError = error;
          }
          yield { finishReason: "stop", totalUsage: {}, type: "finish" };
        })(),
      }),
    );

    try {
      for await (const _event of runAgentLoop({
        generateObject: vi.fn(async () => ({
          object: { content: "Scene prose.\n" },
          usage: {},
        })),
        messages: [{ content: "新しいシーンを書いて", role: "user" }],
        modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
        profile: mainAgentProfile,
        streamText: streamText as unknown as RunAgentLoopOptions["streamText"],
        workspaceRoot,
      })) {
        // drain stream
      }

      expect(proposalError).toEqual(
        expect.objectContaining({ message: expect.stringMatching(/already exists/i) }),
      );
    } finally {
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not share create writing artifact IDs with another run", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-writing-create-cross-run-"));
    const targetPath = "manuscript/scene-05.txt";
    mkdirSync(path.join(workspaceRoot, "manuscript"));
    let artifactId = "";
    const firstStreamText = vi.fn(
      (options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
        fullStream: (async function* () {
          const output = (await options.tools.DelegateWriting.execute({
            instruction: "Write the scene.",
            targetPath,
          })) as { artifactId: string };
          artifactId = output.artifactId;
          yield { finishReason: "stop", totalUsage: {}, type: "finish" };
        })(),
      }),
    );
    const commonOptions = {
      generateObject: vi.fn(async () => ({
        object: { content: "Scene prose.\n" },
        usage: {},
      })),
      messages: [{ content: "新しいシーンを書いて", role: "user" as const }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      workspaceRoot,
    };

    try {
      for await (const _event of runAgentLoop({
        ...commonOptions,
        streamText: firstStreamText as unknown as RunAgentLoopOptions["streamText"],
      })) {
        // drain stream
      }

      let crossRunError: unknown;
      const secondStreamText = vi.fn(
        (options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
          fullStream: (async function* () {
            try {
              await options.tools.CreateWritingEditProposal.execute({ artifactId });
            } catch (error) {
              crossRunError = error;
            }
            yield { finishReason: "stop", totalUsage: {}, type: "finish" };
          })(),
        }),
      );
      for await (const _event of runAgentLoop({
        ...commonOptions,
        streamText: secondStreamText as unknown as RunAgentLoopOptions["streamText"],
      })) {
        // drain stream
      }

      expect(artifactId).not.toBe("");
      expect(crossRunError).toEqual(
        expect.objectContaining({ message: expect.stringMatching(/unknown/i) }),
      );
    } finally {
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("rejects unknown and consumed writing artifact IDs", async () => {
    const targetPath = "chapter.txt";
    let unknownError: unknown;
    let reusedError: unknown;
    const streamText = vi.fn((options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
      fullStream: (async function* () {
        try {
          await options.tools.CreateWritingEditProposal.execute({ artifactId: "unknown-artifact" });
        } catch (error) {
          unknownError = error;
        }
        await options.tools.Read.execute({ path: targetPath });
        const delegated = (await options.tools.DelegateWriting.execute({
          instruction: "Rewrite",
          targetPath,
        })) as { artifactId: string };
        await options.tools.CreateWritingEditProposal.execute({ artifactId: delegated.artifactId });
        try {
          await options.tools.CreateWritingEditProposal.execute({ artifactId: delegated.artifactId });
        } catch (error) {
          reusedError = error;
        }
        yield { finishReason: "stop", totalUsage: {}, type: "finish" };
      })(),
    }));

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      generateObject: vi.fn(async () => ({ object: { oldText: "old", newText: "new" }, usage: {} })),
      messages: [{ content: "書き直して", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      streamText: streamText as unknown as RunAgentLoopOptions["streamText"],
      toolServices: {
        createEditProposal: vi.fn((input) => ({
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
        })),
        readWorkspaceFile: vi.fn(async (input) => ({
          content: "old",
          path: input.path,
          totalLines: 1,
          truncated: false,
        })),
      },
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(unknownError).toEqual(expect.objectContaining({ message: expect.stringMatching(/unknown/i) }));
    expect(reusedError).toEqual(expect.objectContaining({ message: expect.stringMatching(/used|consumed/i) }));
  });

  it("does not share writing artifact IDs with another run", async () => {
    const targetPath = "chapter.txt";
    let artifactId = "";
    const firstStreamText = vi.fn((options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
      fullStream: (async function* () {
        await options.tools.Read.execute({ path: targetPath });
        const output = (await options.tools.DelegateWriting.execute({
          instruction: "Continue",
          targetPath,
        })) as { artifactId: string };
        artifactId = output.artifactId;
        yield { finishReason: "stop", totalUsage: {}, type: "finish" };
      })(),
    }));
    const commonOptions = {
      generateObject: vi.fn(async () => ({ object: { oldText: "old", newText: "new" }, usage: {} })),
      messages: [{ content: "続きを書いて", role: "user" as const }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      toolServices: {
        readWorkspaceFile: vi.fn(async (input) => ({ content: "old", path: input.path, totalLines: 1, truncated: false })),
      },
      workspaceRoot: "/tmp/workspace",
    };
    for await (const _event of runAgentLoop(withReadableWritingTarget({
      ...commonOptions,
      streamText: firstStreamText as unknown as RunAgentLoopOptions["streamText"],
    }))) {
      // drain stream
    }

    let crossRunError: unknown;
    const secondStreamText = vi.fn((options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
      fullStream: (async function* () {
        try {
          await options.tools.CreateWritingEditProposal.execute({ artifactId });
        } catch (error) {
          crossRunError = error;
        }
        yield { finishReason: "stop", totalUsage: {}, type: "finish" };
      })(),
    }));
    for await (const _event of runAgentLoop(withReadableWritingTarget({
      ...commonOptions,
      streamText: secondStreamText as unknown as RunAgentLoopOptions["streamText"],
    }))) {
      // drain stream
    }

    expect(artifactId).not.toBe("");
    expect(crossRunError).toEqual(expect.objectContaining({ message: expect.stringMatching(/unknown/i) }));
  });

  it("rejects generic Edit for a failed writing target but preserves unrelated Edit", async () => {
    const failedPath = "chapter.txt";
    let delegationOutput: unknown;
    let failedPathEditError: unknown;
    let unrelatedEditOutput: unknown;
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
    const streamText = vi.fn((options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
      fullStream: (async function* () {
        await options.tools.Read.execute({ path: failedPath });
        delegationOutput = await options.tools.DelegateWriting.execute({
          instruction: "Continue",
          targetPath: failedPath,
        });
        try {
          await options.tools.Edit.execute({ path: failedPath, oldText: "old", newText: "main fallback" });
        } catch (error) {
          failedPathEditError = error;
        }
        unrelatedEditOutput = await options.tools.Edit.execute({
          path: "notes.md",
          oldText: "todo",
          newText: "done",
        });
        yield { finishReason: "stop", totalUsage: {}, type: "finish" };
      })(),
    }));

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      messages: [{ content: "続きを書いて", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      resolveLlmProfileForRole: vi.fn((role: LlmProfileRole) => {
        if (role === "writing") {
          throw new Error("writing unavailable");
        }
        return {
          available: true,
          contextWindowTokens: 1_000_000,
          id: "test:main",
          llmProfileRole: "main" as const,
          maxOutputTokens: 4000,
          modelId: "main-model",
          name: "main",
          providerId: "deepseek" as const,
          source: "built-in" as const,
          temperature: 0.2,
        };
      }) as RunAgentLoopOptions["resolveLlmProfileForRole"],
      streamText: streamText as unknown as RunAgentLoopOptions["streamText"],
      toolServices: {
        createEditProposal,
        readWorkspaceFile: vi.fn(async (input) => ({ content: "old", path: input.path, totalLines: 1, truncated: false })),
      },
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(delegationOutput).toEqual({ message: "writing unavailable", status: "error", targetPath: failedPath });
    expect(delegationOutput).not.toHaveProperty("artifactId");
    expect(failedPathEditError).toEqual(expect.objectContaining({ message: expect.stringMatching(/DelegateWriting|writing/i) }));
    expect(unrelatedEditOutput).toMatchObject({ path: "notes.md" });
    expect(createEditProposal).toHaveBeenCalledTimes(1);
  });

  it("rejects generic Edit when overridden delegateWriting throws", async () => {
    const failedPath = "chapter.txt";
    let delegationError: unknown;
    let failedPathEditError: unknown;
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
    const delegateWriting = vi.fn(async () => {
      throw new Error("delegation exploded");
    });
    const streamText = vi.fn((options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
      fullStream: (async function* () {
        await options.tools.Read.execute({ path: failedPath });
        try {
          await options.tools.DelegateWriting.execute({
            instruction: "Continue",
            targetPath: failedPath,
          });
        } catch (error) {
          delegationError = error;
        }
        try {
          await options.tools.Edit.execute({ path: failedPath, oldText: "old", newText: "main fallback" });
        } catch (error) {
          failedPathEditError = error;
        }
        yield { finishReason: "stop", totalUsage: {}, type: "finish" };
      })(),
    }));

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      messages: [{ content: "続きを書いて", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      streamText: streamText as unknown as RunAgentLoopOptions["streamText"],
      toolServices: {
        createEditProposal,
        delegateWriting,
        readWorkspaceFile: vi.fn(async (input) => ({
          content: "old",
          path: input.path,
          totalLines: 1,
          truncated: false,
        })),
      },
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(delegationError).toEqual(expect.objectContaining({ message: "delegation exploded" }));
    expect(failedPathEditError).toEqual(
      expect.objectContaining({ message: expect.stringMatching(/DelegateWriting|not allowed/i) }),
    );
    expect(createEditProposal).not.toHaveBeenCalled();
  });

  it("returns an explicit DelegateWriting error when the writing profile is unavailable without using the main model", async () => {
    const generateObject = vi.fn();
    const getLanguageModel = vi.fn((modelId: string) => ({ modelId }));
    const resolveLlmProfileForRole = vi.fn((role: LlmProfileRole) => {
      if (role === "writing") {
        throw new Error('No available LLM profile for role "writing"');
      }
      return {
        available: true,
        contextWindowTokens: 1_000_000,
        id: "test:main",
        llmProfileRole: "main" as const,
        maxOutputTokens: 4000,
        modelId: "main-model",
        name: "main",
        providerId: "deepseek" as const,
        source: "built-in" as const,
        temperature: 0.2,
      };
    });
    let delegationOutput: unknown;
    const streamText = vi.fn((options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
      fullStream: (async function* () {
        const readInput = { path: "chapter.txt" };
        await options.tools.Read.execute(readInput);
        delegationOutput = await options.tools.DelegateWriting.execute({
          instruction: "Continue",
          targetPath: "chapter.txt",
        });
        yield { finishReason: "stop", totalUsage: {}, type: "finish" };
      })(),
    }));

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      generateObject,
      messages: [{ content: "続きを書いて", role: "user" }],
      modelProvider: { getLanguageModel: getLanguageModel as never },
      profile: mainAgentProfile,
      resolveLlmProfileForRole: resolveLlmProfileForRole as RunAgentLoopOptions["resolveLlmProfileForRole"],
      streamText: streamText as unknown as RunAgentLoopOptions["streamText"],
      toolServices: {
        readWorkspaceFile: vi.fn(async (input) => ({ content: "text", path: input.path, totalLines: 1, truncated: false })),
      },
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(delegationOutput).toEqual(expect.objectContaining({
      message: expect.stringContaining('No available LLM profile for role "writing"'),
      status: "error",
      targetPath: "chapter.txt",
    }));
    expect(getLanguageModel).toHaveBeenCalledTimes(1);
    expect(getLanguageModel).toHaveBeenCalledWith("main-model", "deepseek", "test:main");
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("refuses DelegateWriting before the target file has been read", async () => {
    const resolveLlmProfileForRole = vi.fn((role: LlmProfileRole) => ({
      available: true,
      contextWindowTokens: 1_000_000,
      id: "test:main",
      llmProfileRole: role,
      maxOutputTokens: 4000,
      modelId: "main-model",
      name: "main",
      providerId: "deepseek" as const,
      source: "built-in" as const,
      temperature: 0.2,
    }));
    let delegationOutput: unknown;
    const streamText = vi.fn((options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
      fullStream: (async function* () {
        delegationOutput = await options.tools.DelegateWriting.execute({
          instruction: "Continue",
          targetPath: "chapter.txt",
        });
        yield { finishReason: "stop", totalUsage: {}, type: "finish" };
      })(),
    }));

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      messages: [{ content: "続きを書いて", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      resolveLlmProfileForRole,
      streamText: streamText as unknown as RunAgentLoopOptions["streamText"],
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(delegationOutput).toEqual({
      message: "DelegateWriting requires the target file to be read first",
      status: "error",
      targetPath: "chapter.txt",
    });
    expect(resolveLlmProfileForRole).toHaveBeenCalledTimes(1);
    expect(resolveLlmProfileForRole).toHaveBeenCalledWith("main");
    expect(resolveLlmProfileForRole).not.toHaveBeenCalledWith("writing");
  });

  it.each([
    ["path", { path: "other.txt", oldText: "BEFORE", newText: "AFTER" }],
    ["oldText", { path: "chapter.txt", oldText: "CHANGED", newText: "AFTER" }],
    ["newText", { path: "chapter.txt", oldText: "BEFORE", newText: "CHANGED" }],
  ])("does not mark an Edit as writing provenance when %s differs from the artifact", async (_field, editInput) => {
    let editOutput: unknown;
    const streamText = vi.fn((options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
      fullStream: (async function* () {
        await options.tools.Read.execute({ path: "chapter.txt" });
        await options.tools.DelegateWriting.execute({ instruction: "Rewrite", targetPath: "chapter.txt" });
        editOutput = await options.tools.Edit.execute(editInput);
        yield { finishReason: "stop", totalUsage: {}, type: "finish" };
      })(),
    }));

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      generateObject: vi.fn(async () => ({
        object: { oldText: "BEFORE", newText: "AFTER" },
        usage: {},
      })),
      messages: [{ content: "書き直して", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      streamText: streamText as unknown as RunAgentLoopOptions["streamText"],
      toolServices: {
        createEditProposal: vi.fn((input) => ({
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
        })),
        readWorkspaceFile: vi.fn(async (input) => ({ content: "BEFORE", path: input.path, totalLines: 1, truncated: false })),
      },
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(editOutput).not.toHaveProperty("sourceRole");
  });

  it.each([
    "次章の展開アイディアを相談したい",
    "登場人物をworkspaceから検索して要約して",
    "ファイルを編集せずchatに例文だけ出して",
  ])("does not resolve or run the writing model for non-writing request: %s", async (content) => {
    const generateObject = vi.fn();
    const resolveLlmProfileForRole = vi.fn((role: LlmProfileRole) => ({
      available: true,
      contextWindowTokens: 1_000_000,
      id: "test:main",
      llmProfileRole: role,
      maxOutputTokens: 4000,
      modelId: "main-model",
      name: "main",
      providerId: "deepseek" as const,
      source: "built-in" as const,
      temperature: 0.2,
    }));
    const streamText = vi.fn().mockReturnValue({
      fullStream: (async function* () {
        yield { finishReason: "stop", totalUsage: {}, type: "finish" };
      })(),
    });

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      generateObject,
      messages: [{ content, role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      resolveLlmProfileForRole: resolveLlmProfileForRole as RunAgentLoopOptions["resolveLlmProfileForRole"],
      streamText,
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(resolveLlmProfileForRole).toHaveBeenCalledTimes(1);
    expect(resolveLlmProfileForRole).toHaveBeenCalledWith("main");
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("rejects DelegateWriting when the writing resolver returns the main role without calling generateObject", async () => {
    const generateObject = vi.fn();
    let delegationOutput: unknown;
    const resolveLlmProfileForRole = vi.fn((role: LlmProfileRole) => ({
      available: true,
      contextWindowTokens: 1_000_000,
      id: role === "writing" ? "test:main-misassigned" : "test:main",
      llmProfileRole: "main" as const,
      maxOutputTokens: 4000,
      modelId: "main-model",
      name: "main",
      providerId: "deepseek" as const,
      source: "built-in" as const,
      temperature: 0.2,
    }));
    const streamText = vi.fn((options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
      fullStream: (async function* () {
        await options.tools.Read.execute({ path: "chapter.txt" });
        delegationOutput = await options.tools.DelegateWriting.execute({
          instruction: "Continue",
          targetPath: "chapter.txt",
        });
        yield { finishReason: "stop", totalUsage: {}, type: "finish" };
      })(),
    }));

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      generateObject,
      messages: [{ content: "続きを書いて", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      resolveLlmProfileForRole: resolveLlmProfileForRole as RunAgentLoopOptions["resolveLlmProfileForRole"],
      streamText: streamText as unknown as RunAgentLoopOptions["streamText"],
      toolServices: {
        readWorkspaceFile: vi.fn(async (input) => ({
          content: "text",
          path: input.path,
          totalLines: 1,
          truncated: false,
        })),
      },
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(delegationOutput).toEqual(
      expect.objectContaining({
        message: 'Expected writing LLM profile role but received "main"',
        status: "error",
        targetPath: "chapter.txt",
      }),
    );
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("rejects DelegateWriting when the writing resolver is unavailable without calling generateObject", async () => {
    const generateObject = vi.fn();
    let delegationOutput: unknown;
    const resolveLlmProfileForRole = vi.fn((role: LlmProfileRole) => {
      if (role === "writing") {
        return {
          available: false,
          contextWindowTokens: 1_000_000,
          id: "test:writing",
          llmProfileRole: "writing" as const,
          maxOutputTokens: 4096,
          modelId: "writing-model",
          name: "writing",
          providerId: "deepseek" as const,
          source: "built-in" as const,
          temperature: 0.7,
          unavailableReason: 'No available LLM profile for role "writing"',
        };
      }
      return {
        available: true,
        contextWindowTokens: 1_000_000,
        id: "test:main",
        llmProfileRole: "main" as const,
        maxOutputTokens: 4000,
        modelId: "main-model",
        name: "main",
        providerId: "deepseek" as const,
        source: "built-in" as const,
        temperature: 0.2,
      };
    });
    const streamText = vi.fn((options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
      fullStream: (async function* () {
        await options.tools.Read.execute({ path: "chapter.txt" });
        delegationOutput = await options.tools.DelegateWriting.execute({
          instruction: "Continue",
          targetPath: "chapter.txt",
        });
        yield { finishReason: "stop", totalUsage: {}, type: "finish" };
      })(),
    }));

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      generateObject,
      messages: [{ content: "続きを書いて", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      resolveLlmProfileForRole: resolveLlmProfileForRole as RunAgentLoopOptions["resolveLlmProfileForRole"],
      streamText: streamText as unknown as RunAgentLoopOptions["streamText"],
      toolServices: {
        readWorkspaceFile: vi.fn(async (input) => ({
          content: "text",
          path: input.path,
          totalLines: 1,
          truncated: false,
        })),
      },
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(delegationOutput).toEqual(
      expect.objectContaining({
        message: 'No available LLM profile for role "writing"',
        status: "error",
        targetPath: "chapter.txt",
      }),
    );
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("keys the read registry by normalized Read result.path for DelegateWriting", async () => {
    const normalizedPath = "novel/chapter-01.txt";
    const readInputPath = "novel\\chapter-01.txt";
    const oldText = "BEFORE";
    const newText = "AFTER";
    let delegationOutput: unknown;
    const streamText = vi.fn((options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
      fullStream: (async function* () {
        await options.tools.Read.execute({ path: readInputPath });
        delegationOutput = await options.tools.DelegateWriting.execute({
          instruction: "Continue",
          targetPath: normalizedPath,
        });
        yield { finishReason: "stop", totalUsage: {}, type: "finish" };
      })(),
    }));

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      generateObject: vi.fn(async () => ({
        object: { oldText, newText },
        usage: {},
      })),
      messages: [{ content: "続きを書いて", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      streamText: streamText as unknown as RunAgentLoopOptions["streamText"],
      toolServices: {
        readWorkspaceFile: vi.fn(async () => ({
          content: oldText,
          path: normalizedPath,
          totalLines: 1,
          truncated: false,
        })),
      },
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(delegationOutput).toEqual(
      expect.objectContaining({
        artifactId: expect.any(String),
        status: "completed",
        targetPath: normalizedPath,
      }),
    );
    expect(delegationOutput).not.toHaveProperty("artifact");
    expect(delegationOutput).not.toHaveProperty("oldText");
    expect(delegationOutput).not.toHaveProperty("newText");
  });

  it("registers overridden DelegateWriting artifacts for CreateWritingEditProposal provenance", async () => {
    const targetPath = "chapter.txt";
    const oldText = "BEFORE";
    const newText = "AFTER";
    let proposalOutput: unknown;
    const delegateWriting = vi.fn(async () => ({
      artifact: { newText, oldText },
      latencyMs: 1,
      operation: "edit" as const,
      status: "completed" as const,
      targetPath,
      tokenUsage: {
        llmProfileRole: "writing" as const,
        modelId: "writing-model",
        providerId: "deepseek",
      },
    }));
    const streamText = vi.fn((options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
      fullStream: (async function* () {
        await options.tools.Read.execute({ path: targetPath });
        const delegationOutput = (await options.tools.DelegateWriting.execute({
          instruction: "Rewrite",
          targetPath,
        })) as { artifactId: string };
        proposalOutput = await options.tools.CreateWritingEditProposal.execute({
          artifactId: delegationOutput.artifactId,
        });
        yield { finishReason: "stop", totalUsage: {}, type: "finish" };
      })(),
    }));

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      messages: [{ content: "書き直して", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      streamText: streamText as unknown as RunAgentLoopOptions["streamText"],
      toolServices: {
        createEditProposal: vi.fn((input) => ({
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
        })),
        delegateWriting,
        readWorkspaceFile: vi.fn(async (input) => ({
          content: oldText,
          path: input.path,
          totalLines: 1,
          truncated: false,
        })),
      },
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(delegateWriting).toHaveBeenCalled();
    expect(proposalOutput).toMatchObject({
      newText,
      oldText,
      path: targetPath,
      sourceRole: "writing",
    });
  });

  it("does not consume a writing artifact when proposal creation fails", async () => {
    const targetPath = "chapter.txt";
    let retryOutput: unknown;
    const createEditProposal = vi
      .fn()
      .mockRejectedValueOnce(new Error("proposal validation failed"))
      .mockImplementation((input) => ({
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
    const streamText = vi.fn((options: { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }) => ({
      fullStream: (async function* () {
        await options.tools.Read.execute({ path: targetPath });
        const delegated = (await options.tools.DelegateWriting.execute({
          instruction: "Continue",
          targetPath,
        })) as { artifactId: string };
        let firstError: unknown;
        try {
          await options.tools.CreateWritingEditProposal.execute({ artifactId: delegated.artifactId });
        } catch (error) {
          firstError = error;
        }
        retryOutput = await options.tools.CreateWritingEditProposal.execute({
          artifactId: delegated.artifactId,
        });
        yield { finishReason: "stop", totalUsage: {}, type: "finish" };
        expect(firstError).toEqual(expect.objectContaining({ message: "proposal validation failed" }));
      })(),
    }));

    for await (const _event of runAgentLoop(withReadableWritingTarget({
      generateObject: vi.fn(async () => ({ object: { oldText: "old", newText: "new" }, usage: {} })),
      messages: [{ content: "続きを書いて", role: "user" }],
      modelProvider: { getLanguageModel: vi.fn().mockReturnValue({}) },
      profile: mainAgentProfile,
      streamText: streamText as unknown as RunAgentLoopOptions["streamText"],
      toolServices: {
        createEditProposal,
        readWorkspaceFile: vi.fn(async (input) => ({
          content: "old",
          path: input.path,
          totalLines: 1,
          truncated: false,
        })),
      },
      workspaceRoot: "/tmp/workspace",
    }))) {
      // drain stream
    }

    expect(createEditProposal).toHaveBeenCalledTimes(2);
    expect(retryOutput).toMatchObject({ path: targetPath, sourceRole: "writing" });
  });

  it("notifies one sanitized diagnostic for an empty NoObjectGeneratedError response", async () => {
    const observer = vi.fn();
    const error = new NoObjectGeneratedError({
      finishReason: "stop",
      message: "No object generated: the model did not return a response.",
      response: diagnosticTestResponse,
      usage: diagnosticTestUsage,
    });

    const { delegationOutput, targetPath } = await runDelegateWritingFailure({
      generateObject: vi.fn(async () => {
        throw error;
      }),
      observer,
    });

    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledWith({
      causeChain: [],
      classification: "empty_response",
      errorMessage: "No object generated: the model did not return a response.",
      errorName: "AI_NoObjectGeneratedError",
      errorType: "NoObjectGeneratedError",
      finishReason: "stop",
      hasRawText: false,
      llmProfileId: "test:writing",
      llmProfileRole: "writing",
      modelId: "writing-model",
      providerId: "deepseek",
      rawTextLength: 0,
      responseMetadata: {
        id: "response-1",
        modelId: "provider-writing-model",
        timestamp: "2026-06-20T00:00:00.000Z",
      },
      targetPath,
      tokenUsage: {
        inputTokens: 12,
        outputTokens: 3,
        totalTokens: 15,
      },
      type: "delegate-writing-error",
    });
    expect(delegationOutput).toEqual({
      message: "No object generated: the model did not return a response.",
      status: "error",
      targetPath,
    });
  });

  it("distinguishes schema validation failures from provider errors", async () => {
    const schemaObserver = vi.fn();
    const schemaError = new NoObjectGeneratedError({
      cause: new TypeValidationError({
        cause: new Error("invalid fields"),
        value: { newText: 42, oldText: null },
      }),
      finishReason: "stop",
      message: "No object generated: response did not match schema.",
      response: diagnosticTestResponse,
      text: "{\"oldText\":null,\"newText\":42}",
      usage: diagnosticTestUsage,
    });
    await runDelegateWritingFailure({
      generateObject: vi.fn(async () => {
        throw schemaError;
      }),
      observer: schemaObserver,
    });

    const providerObserver = vi.fn();
    const providerError = new APICallError({
      isRetryable: true,
      message: "Provider request failed with private response details",
      requestBodyValues: { prompt: "PRIVATE_PROMPT" },
      responseBody: "PRIVATE_PROVIDER_RESPONSE",
      responseHeaders: { authorization: "Bearer PRIVATE_API_KEY" },
      statusCode: 503,
      url: "https://provider.invalid/v1/chat/completions",
    });
    await runDelegateWritingFailure({
      generateObject: vi.fn(async () => {
        throw providerError;
      }),
      observer: providerObserver,
    });

    expect(schemaObserver).toHaveBeenCalledWith(
      expect.objectContaining({
        causeChain: [{ errorName: "AI_TypeValidationError", errorType: "TypeValidationError" }],
        classification: "schema_validation_failure",
        hasRawText: true,
        rawTextLength: 29,
      }),
    );
    expect(providerObserver).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: "provider_error",
        errorMessage: "Provider request failed",
        errorName: "AI_APICallError",
        errorType: "APICallError",
        providerResponse: { isRetryable: true, statusCode: 503 },
      }),
    );
  });

  it("distinguishes JSON parse failures from provider errors", async () => {
    const observer = vi.fn();
    const rawText = "not valid json";
    const error = new NoObjectGeneratedError({
      cause: new JSONParseError({
        cause: new SyntaxError("Unexpected token"),
        text: rawText,
      }),
      finishReason: "stop",
      message: "No object generated: could not parse the response.",
      response: diagnosticTestResponse,
      text: rawText,
      usage: diagnosticTestUsage,
    });

    await runDelegateWritingFailure({
      generateObject: vi.fn(async () => {
        throw error;
      }),
      observer,
    });

    expect(observer).toHaveBeenCalledWith(
      expect.objectContaining({
        causeChain: [{ errorName: "AI_JSONParseError", errorType: "JSONParseError" }],
        classification: "json_parse_failure",
        errorMessage: "No object generated: could not parse the response.",
        hasRawText: true,
        rawTextLength: rawText.length,
      }),
    );
  });

  it("never includes prompts, manuscript text, API keys, or raw responses in diagnostics", async () => {
    const observer = vi.fn();
    const manuscript = "PRIVATE_MANUSCRIPT_BODY";
    const apiKey = "sk-private-api-key";
    const rawResponse = `PRIVATE_RAW_RESPONSE_${manuscript}_${apiKey}`;
    const schemaError = new NoObjectGeneratedError({
      cause: new TypeValidationError({
        cause: new Error(`PRIVATE_CAUSE_${rawResponse}`),
        value: { newText: rawResponse, oldText: manuscript },
      }),
      finishReason: "stop",
      message: "No object generated: response did not match schema.",
      response: {
        ...diagnosticTestResponse,
        headers: { authorization: `Bearer ${apiKey}` },
        body: rawResponse,
      } as typeof diagnosticTestResponse,
      text: rawResponse,
      usage: {
        ...diagnosticTestUsage,
        raw: { authorization: apiKey, prompt: manuscript },
      },
    });

    await runDelegateWritingFailure({
      fileContent: manuscript,
      generateObject: vi.fn(async (generateOptions) => {
        expect(generateOptions.prompt).toContain(manuscript);
        throw schemaError;
      }),
      observer,
    });

    expect(observer).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(observer.mock.calls[0]?.[0]);
    expect(serialized).not.toContain(manuscript);
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain(rawResponse);
    expect(serialized).not.toContain("PRIVATE_CAUSE");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("headers");
    expect(serialized).not.toContain("body");
    expect(serialized).not.toContain("prompt");
  });

  it("keeps the existing DelegateWriting error result when no observer is configured", async () => {
    const error = new NoObjectGeneratedError({
      finishReason: "stop",
      message: "No object generated: the model did not return a response.",
      response: diagnosticTestResponse,
      usage: diagnosticTestUsage,
    });
    const { delegationOutput, events, targetPath } = await runDelegateWritingFailure({
      generateObject: vi.fn(async () => {
        throw error;
      }),
    });

    const expectedOutput = {
      message: "No object generated: the model did not return a response.",
      status: "error",
      targetPath,
    };
    expect(delegationOutput).toEqual(expectedOutput);
    expect(events).toContainEqual({
      output: expectedOutput,
      toolCallId: "writing-1",
      toolName: "DelegateWriting",
      type: "tool-result",
    });
  });

  it("does not let a throwing diagnostic observer break DelegateWriting error handling", async () => {
    const observer = vi.fn(() => {
      throw new Error("observer failed");
    });
    const error = new NoObjectGeneratedError({
      finishReason: "stop",
      message: "No object generated: the model did not return a response.",
      response: diagnosticTestResponse,
      usage: diagnosticTestUsage,
    });

    const { delegationOutput, targetPath } = await runDelegateWritingFailure({
      generateObject: vi.fn(async () => {
        throw error;
      }),
      observer,
    });

    expect(observer).toHaveBeenCalledTimes(1);
    expect(delegationOutput).toEqual({
      message: "No object generated: the model did not return a response.",
      status: "error",
      targetPath,
    });
  });

  it("does not emit an error diagnostic for successful DelegateWriting", async () => {
    const observer = vi.fn();
    const result = await runDelegateWritingFailure({
      generateObject: vi.fn(async () => ({
        object: { newText: "AFTER", oldText: "MANUSCRIPT_CONTENT" },
        usage: diagnosticTestUsage,
      })),
      observer,
    });

    expect(observer).not.toHaveBeenCalled();
    expect(result.delegationOutput).toEqual(
      expect.objectContaining({ status: "completed", targetPath: result.targetPath }),
    );
  });
});
