import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import {
  createNdjsonStreamWriter,
  createAgentChatApiHandler as createBaseAgentChatApiHandler,
  type AgentChatApiOptions,
} from "./agentChatApi";
import {
  appendConversationCompaction,
  appendConversationMessage,
  createConversation,
} from "./conversationHistory";
import { chatModeAgentProfile, mainAgentProfile } from "../ai-agent/agentProfiles";
import { createTrustedAgentExtensionCatalog } from "../ai-agent/trustedAgentExtensions";
import type { LlmProviderConfig } from "../llm/runtimeEnv";
import { createLlmSecretStore, type SystemCredentialAdapter } from "../llm/secrets/llmSecretStore";
import type {
  DelegateWritingDiagnostic,
  RunAgentLoopOptions,
} from "../ai-agent/runAgentLoop";

function request(url: URL, init?: RequestInit) {
  return new Request(url, init);
}

const testLlmProviderConfig: LlmProviderConfig = {
  defaultProviderId: "deepseek",
  providers: {
    anthropic: { apiKey: "test-anthropic-key" },
    deepseek: { apiKey: "test-deepseek-key" },
    gemini: { apiKey: "test-gemini-key" },
    openai: { apiKey: "test-openai-key" },
    "openai-compatible": { apiKey: "test-openai-compatible-key" },
  },
};

function memoryAdapter(): SystemCredentialAdapter {
  return {
    async deletePassword() {
      return undefined;
    },
    async getPassword() {
      return null;
    },
    async setPassword() {
      return undefined;
    },
  };
}

function createAgentChatApiHandler(options: AgentChatApiOptions = {}) {
  const llmProviderConfig: LlmProviderConfig = {
    ...testLlmProviderConfig,
    ...options.llmProviderConfig,
    providers: {
      ...testLlmProviderConfig.providers,
      ...options.llmProviderConfig?.providers,
    },
  };

  return createBaseAgentChatApiHandler({
    secretStore: createLlmSecretStore({ adapter: memoryAdapter(), env: {} }),
    ...options,
    llmProviderConfig,
  });
}

function delegateWritingDiagnosticFixture(): DelegateWritingDiagnostic {
  return {
    causeChain: [
      {
        errorName: "AI_APICallError",
        errorType: "APICallError",
      },
    ],
    classification: "empty_response",
    errorMessage: "No object generated: the model did not return a response.",
    errorName: "AI_NoObjectGeneratedError",
    errorType: "NoObjectGeneratedError",
    finishReason: "length",
    hasRawText: true,
    llmProfileId: "writing-profile",
    llmProfileRole: "writing",
    modelId: "deepseek-chat",
    providerId: "deepseek",
    providerResponse: {
      isRetryable: false,
      statusCode: 200,
    },
    rawTextLength: 4096,
    responseMetadata: {
      id: "response-1",
      modelId: "deepseek-chat",
      timestamp: "2026-06-22T00:00:00.000Z",
    },
    targetPath: "novel/chapter-01.txt",
    tokenUsage: {
      inputTokens: 1200,
      outputTokens: 4096,
      totalTokens: 5296,
    },
    type: "delegate-writing-error",
  };
}

describe("agent chat API", () => {
  it("persists partial output and reports a real SDK stream error", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-stream-error-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-stream-workspace-"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({start(controller) {
      controller.enqueue({type: "text-start", id: "text"});
      controller.enqueue({type: "text-delta", id: "text", delta: "途中の回答"});
      controller.enqueue({type: "text-end", id: "text"});
      controller.enqueue({type: "error", error: new Error("provider disconnected")});
      controller.close();
    }}) }) });
    const handler = createAgentChatApiHandler({dataRoot, modelProvider: {getLanguageModel: () => model}});
    try {
      const response = await handler(request(new URL("http://localhost/api/chat/messages"), {
        body: JSON.stringify({content: "書いて", workspaceRoot, mode: "chat"}),
        headers: {"content-type": "application/json", accept: "application/x-ndjson"}, method: "POST",
      }));
      const text = await response.text();
      const events = text.trim().split("\n").map((line) => JSON.parse(line));
      expect(events.at(-1)).toMatchObject({type: "error", message: "provider disconnected"});
      const saved = events.filter((event) => event.type === "conversation").at(-1).conversation;
      expect(saved.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({role: "assistant", content: "途中の回答"}),
        expect.objectContaining({role: "system", content: expect.stringContaining("provider disconnected")}),
      ]));
    } finally {
      errorSpy.mockRestore();
      rmSync(dataRoot, {recursive: true, force: true});
      rmSync(workspaceRoot, {recursive: true, force: true});
    }
  });
  it("sends writing progress before completion and keeps it out of the model history", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-progress-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-progress-workspace-"));
    const handler = createAgentChatApiHandler({dataRoot, runAgentLoop: async function* (options) {
      yield {type: "tool-call", toolCallId: "writing-1", toolName: "DelegateWriting", input: {targetPath: "chapter.txt", instruction: "write"}};
      options.onToolProgress?.({type: "tool-progress", toolCallId: "writing-1", toolName: "DelegateWriting", targetPath: "chapter.txt", generatedCharacters: 1200});
      yield {type: "tool-result", toolCallId: "writing-1", toolName: "DelegateWriting", output: {status: "error", message: "本文の出力上限に達しました。"}};
      yield {type: "finish", finishReason: "stop", totalUsage: {}};
    }});
    try {
      const response = await handler(request(new URL("http://localhost/api/chat/messages"), {
        body: JSON.stringify({content: "書いて", workspaceRoot, mode: "chat"}),
        headers: {"content-type": "application/json", accept: "application/x-ndjson"}, method: "POST",
      }));
      const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
      const progressIndex = events.findIndex((event) => event.activity?.detail === "本文を生成中・1200文字受信");
      const failureIndex = events.findIndex((event) => event.activity?.status === "failed");
      expect(progressIndex).toBeGreaterThan(-1);
      expect(failureIndex).toBeGreaterThan(progressIndex);
      const saved = events.filter((event) => event.type === "conversation").at(-1).conversation;
      expect(saved.toolActivities.at(-1).status).toBe("failed");
      expect(JSON.stringify(saved)).not.toContain("1200文字");
      expect(saved.editProposals).toHaveLength(0);
    } finally {
      rmSync(dataRoot, {recursive: true, force: true});
      rmSync(workspaceRoot, {recursive: true, force: true});
    }
  });
  it("suppresses NDJSON controller writes after cancellation", () => {
    const controller = {
      close: vi.fn(() => {
        throw new TypeError("Invalid state: Controller is already closed");
      }),
      enqueue: vi.fn(() => {
        throw new TypeError("Invalid state: Controller is already closed");
      }),
    };
    const writer = createNdjsonStreamWriter(controller);

    writer.cancel();

    expect(() => writer.enqueue({ type: "error" })).not.toThrow();
    expect(() => writer.close()).not.toThrow();
    expect(controller.enqueue).not.toHaveBeenCalled();
    expect(controller.close).not.toHaveBeenCalled();
  });

  it("does not write an error event after the NDJSON consumer cancels the stream", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({
      agentRuntime: "vercel-ai",
      dataRoot,
      workspaceRoot,
    });
    let rejectRun: (error: Error) => void = () => {};
    const runFailed = new Promise<never>((_resolve, reject) => {
      rejectRun = reject;
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      runAgentLoop: vi.fn(async function* () { yield { text: "開始しました。", type: "text-delta" as const }; await runFailed; }),
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "処理を開始して",
            conversationId: conversation.id,
            workspaceRoot,
          }),
          headers: {
            accept: "application/x-ndjson",
            "content-type": "application/json",
          },
          method: "POST",
        }),
      );
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      await expect(reader?.read()).resolves.toMatchObject({ done: false });
      await reader?.cancel();

      rejectRun(new Error("Model stream failed"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      await expect(reader?.read()).resolves.toEqual({ done: true, value: undefined });
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("logs one sanitized DelegateWriting diagnostic from the production agent path without exposing it to the conversation", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const diagnostic = delegateWritingDiagnosticFixture();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runAgentLoop = vi.fn(async function* (options: RunAgentLoopOptions) {
      await options.onDelegateWritingDiagnostic?.(diagnostic);
      yield {
        output: {
          message: "No object generated: the model did not return a response.",
          status: "error",
          targetPath: diagnostic.targetPath,
        },
        toolCallId: "delegate-writing-1",
        toolName: "DelegateWriting",
        type: "tool-result" as const,
      };
      yield { text: "執筆委譲に失敗しました。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "SECRET_PROMPT_VALUE",
            conversationId: conversation.id,
            workspaceRoot,
          }),
          headers: { authorization: "Bearer sk-secret-key", "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(runAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          onDelegateWritingDiagnostic: expect.any(Function),
        }),
      );
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith("DelegateWriting diagnostic", {
        diagnostic,
        event: "delegate-writing-diagnostic",
      });

      const serializedLog = JSON.stringify(errorSpy.mock.calls);
      expect(serializedLog).toContain('"finishReason":"length"');
      expect(serializedLog).toContain('"outputTokens":4096');
      expect(serializedLog).toContain('"rawTextLength":4096');
      expect(serializedLog).not.toContain("SECRET_PROMPT_VALUE");
      expect(serializedLog).not.toContain("MANUSCRIPT_BODY_VALUE");
      expect(serializedLog).not.toContain("sk-secret-key");
      expect(serializedLog).not.toContain("RAW_RESPONSE_VALUE");
      expect(serializedLog).not.toContain(workspaceRoot);
      expect(errorSpy.mock.calls.flat().some((value) => value instanceof Error)).toBe(false);

      const serializedConversation = JSON.stringify(body.conversation);
      expect(serializedConversation).not.toContain("delegate-writing-error");
      expect(serializedConversation).not.toContain("empty_response");
      expect(serializedConversation).not.toContain("rawTextLength");
      expect(JSON.stringify(runAgentLoop.mock.calls[0]?.[0].messages)).not.toContain(
        "delegate-writing-error",
      );
    } finally {
      errorSpy.mockRestore();
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("preserves DelegateWriting error handling when diagnostic logging throws", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const diagnostic = delegateWritingDiagnosticFixture();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("logging failed");
    });
    const runAgentLoop = vi.fn(async function* (options: RunAgentLoopOptions) {
      await options.onDelegateWritingDiagnostic?.(diagnostic);
      yield {
        output: {
          message: diagnostic.errorMessage,
          status: "error",
          targetPath: diagnostic.targetPath,
        },
        toolCallId: "delegate-writing-1",
        toolName: "DelegateWriting",
        type: "tool-result" as const,
      };
      yield { text: "執筆委譲に失敗しました。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "続きを書いて",
            conversationId: conversation.id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.conversation.messages.at(-1)).toMatchObject({
        content: "執筆委譲に失敗しました。",
        role: "assistant",
      });
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not log a DelegateWriting diagnostic for a successful agent run", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runAgentLoop = vi.fn(async function* () {
      yield { text: "執筆案を作成しました。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "続きを書いて",
            conversationId: conversation.id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      expect(runAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          onDelegateWritingDiagnostic: expect.any(Function),
        }),
      );
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("stores the user message, runs the agent, and stores the assistant reply", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield { text: "了解しました。", type: "text-delta" as const };
      yield { text: "ファイルを確認します。", type: "text-delta" as const };
      yield { finishReason: "stop", totalUsage: { totalTokens: 12 }, type: "finish" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "READMEを見て",
            conversationId: conversation.id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.conversation.messages.map((message: { content: string; role: string }) => ({
        content: message.content,
        role: message.role,
      }))).toEqual([
        { content: "READMEを見て", role: "user" },
        { content: "了解しました。ファイルを確認します。", role: "assistant" },
      ]);
      expect(runAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ content: "READMEを見て", role: "user" }],
          workspaceRoot,
        }),
      );
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("auto-compacts before running the agent when the latest main context snapshot reaches the threshold", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    await appendConversationMessage({
      content: "古い依頼",
      conversationId: conversation.id,
      dataRoot,
      role: "user",
      workspaceRoot,
    });
    const withAssistant = await appendConversationMessage({
      content: "古い回答",
      conversationId: conversation.id,
      dataRoot,
      mainContextSnapshot: {
        contextWindowTokens: 1000,
        inputTokens: 700,
        llmProfileRole: "main",
        modelId: "deepseek-v4-pro",
        providerId: "deepseek",
      },
      role: "assistant",
      tokenUsage: { inputTokens: 10_000, outputTokens: 100, totalTokens: 10_100 },
      workspaceRoot,
    });
    const latestAssistantMessageId = withAssistant.messages.at(-1)?.id ?? "";
    const operationOrder: string[] = [];
    const compactConversation = vi.fn(async () => {
      operationOrder.push("compact");
      return {
        conversation: await appendConversationCompaction({
          compactedThroughMessageId: latestAssistantMessageId,
          conversationId: conversation.id,
          dataRoot,
          sourceMessageIds: withAssistant.messages.map((message) => message.id),
          summary: "自動圧縮要約。現在のファイル内容は必要に応じてReadする。",
          workspaceRoot,
        }),
        status: "compacted" as const,
      };
    });
    const runAgentLoop = vi.fn(async function* () {
      operationOrder.push("run");
      yield { text: "続けます。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      compactConversation,
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            autoCompactEnabled: true,
            autoCompactThresholdRatio: 0.7,
            content: "今回の依頼",
            conversationId: conversation.id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(operationOrder).toEqual(["compact", "run"]);
      expect(compactConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          compactedThroughMessageId: latestAssistantMessageId,
          conversationId: conversation.id,
          dataRoot,
          workspaceRoot,
        }),
      );
      expect(runAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { content: "自動圧縮要約。現在のファイル内容は必要に応じてReadする。", role: "system" },
            { content: "今回の依頼", role: "user" },
          ],
        }),
      );
      expect(body.conversation.messages.map((message: { content: string }) => message.content)).toContain(
        "今回の依頼",
      );
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not auto-compact from cumulative session usage when the latest main context snapshot is below the threshold", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    await appendConversationMessage({
      content: "古い依頼",
      conversationId: conversation.id,
      dataRoot,
      role: "user",
      workspaceRoot,
    });
    await appendConversationMessage({
      content: "古い回答",
      conversationId: conversation.id,
      dataRoot,
      mainContextSnapshot: {
        contextWindowTokens: 1000,
        inputTokens: 300,
        llmProfileRole: "main",
        modelId: "deepseek-v4-pro",
        providerId: "deepseek",
      },
      role: "assistant",
      tokenUsage: { inputTokens: 900_000, outputTokens: 100, totalTokens: 900_100 },
      workspaceRoot,
    });
    const compactConversation = vi.fn();
    const runAgentLoop = vi.fn(async function* () {
      yield { text: "続けます。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      compactConversation,
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            autoCompactEnabled: true,
            autoCompactThresholdRatio: 0.7,
            content: "今回の依頼",
            conversationId: conversation.id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      expect(compactConversation).not.toHaveBeenCalled();
      expect(runAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([{ content: "今回の依頼", role: "user" }]),
        }),
      );
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("sends compacted conversation context plus raw messages after the latest checkpoint to the agent", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const withOldUser = await appendConversationMessage({
      content: "古い依頼",
      conversationId: conversation.id,
      dataRoot,
      role: "user",
      workspaceRoot,
    });
    const withOldAssistant = await appendConversationMessage({
      content: "古い回答",
      conversationId: conversation.id,
      dataRoot,
      role: "assistant",
      workspaceRoot,
    });
    const checkpointEnd = withOldAssistant.messages.at(-1);
    await appendConversationCompaction({
      compactedThroughMessageId: checkpointEnd?.id ?? "",
      conversationId: conversation.id,
      dataRoot,
      sourceMessageIds: withOldAssistant.messages.map((message) => message.id),
      summary: "会話要約: 第1章は作成済み。現在のファイル内容は必要に応じてReadする。",
      workspaceRoot,
    });
    await appendConversationMessage({
      content: "チェックポイント後の依頼",
      conversationId: conversation.id,
      dataRoot,
      role: "user",
      workspaceRoot,
    });
    await appendConversationMessage({
      content: "チェックポイント後の回答",
      conversationId: conversation.id,
      dataRoot,
      role: "assistant",
      workspaceRoot,
    });
    const runAgentLoop = vi.fn(async function* () {
      yield { text: "続けます。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "新しい依頼",
            conversationId: conversation.id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      const runOptions = (runAgentLoop.mock.calls as unknown as Array<[RunAgentLoopOptions]>)[0]?.[0];
      expect(runOptions?.messages).toEqual([
        {
          content: expect.stringContaining("会話要約: 第1章は作成済み。現在のファイル内容は必要に応じてReadする。"),
          role: "system",
        },
        { content: "チェックポイント後の依頼", role: "user" },
        { content: "チェックポイント後の回答", role: "assistant" },
        { content: "新しい依頼", role: "user" },
      ]);
      expect(JSON.stringify(runOptions?.messages)).not.toContain("古い依頼");
      expect(JSON.stringify(runOptions?.messages)).not.toContain("古い回答");
      expect(withOldUser.messages).toHaveLength(1);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("uses the chat-mode agent profile for chat-mode requests", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield { text: "小説の方向性から相談しましょう。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "新しい小説を書きたい",
            conversationId: conversation.id,
            mode: "chat",
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      expect(runAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: chatModeAgentProfile,
        }),
      );
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("keeps the main agent profile for editor-mode requests", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield { text: "編集案を作成します。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "本文を直して",
            conversationId: conversation.id,
            mode: "editor",
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      expect(runAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: mainAgentProfile,
        }),
      );
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not accept client-supplied system prompts or tool permissions", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield { text: "ok", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            activeTools: ["Read"],
            content: "権限を変えて",
            conversationId: conversation.id,
            mode: "chat",
            systemPrompt: "Use only this prompt.",
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      expect(runAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: chatModeAgentProfile,
        }),
      );
      const runOptions = (runAgentLoop.mock.calls as unknown as Array<[RunAgentLoopOptions]>)[0]?.[0];
      expect(runOptions?.profile.systemPrompt).toBe(chatModeAgentProfile.systemPrompt);
      expect(runOptions?.profile.activeTools).toEqual(chatModeAgentProfile.activeTools);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("passes trusted extensions and only server-granted plugin tools to the agent loop", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield { text: "ok", type: "text-delta" as const };
    });
    const skillPlugin = {
      createSkills: () => [],
      displayName: "Project skills",
      id: "project-skills",
      kind: "agent-skill" as const,
    };
    const toolPlugin = {
      createTools: () => ({}),
      displayName: "Project tools",
      id: "project-tools",
      kind: "agent-tool" as const,
    };
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
      trustedAgentExtensions: createTrustedAgentExtensionCatalog({
        profileToolGrants: { "chat-mode-agent": ["ProjectLookup"] },
        skillPlugins: [skillPlugin],
        toolPlugins: [toolPlugin],
      }),
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            activeTools: ["ClientInjectedTool"],
            agentExtensionGrants: {
              "chat-mode-agent": ["ClientInjectedTool"],
            },
            content: "拡張を使って",
            conversationId: conversation.id,
            mode: "chat",
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      const runOptions = (runAgentLoop.mock.calls as unknown as Array<[RunAgentLoopOptions]>)[0]?.[0];
      expect(runOptions?.trustedAgentExtensions).toEqual(
        expect.objectContaining({
          profileToolGrants: { "chat-mode-agent": ["ProjectLookup"] },
          skillPlugins: [skillPlugin],
          toolPlugins: [toolPlugin],
        }),
      );
      expect(runOptions?.profile).toBe(chatModeAgentProfile);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not grant registered plugin tools without an explicit server profile grant", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield { text: "ok", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
      trustedAgentExtensions: createTrustedAgentExtensionCatalog({
        profileToolGrants: {},
        skillPlugins: [],
        toolPlugins: [
          {
            createTools: () => ({}),
            displayName: "Project tools",
            id: "project-tools",
            kind: "agent-tool",
          },
        ],
      }),
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            activeTools: ["ProjectLookup"],
            content: "権限を追加して",
            conversationId: conversation.id,
            mode: "chat",
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      const runOptions = (runAgentLoop.mock.calls as unknown as Array<[RunAgentLoopOptions]>)[0]?.[0];
      expect(runOptions?.profile.activeTools).toEqual(chatModeAgentProfile.activeTools);
      expect(runOptions?.profile.activeTools).not.toContain("ProjectLookup");
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("adds a chat-mode warning when tool calls repeatedly fail in one agent run", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield {
        output: { message: "Tool call was not emitted correctly.", status: "error" },
        toolCallId: "read-1",
        toolName: "Read",
        type: "tool-result" as const,
      };
      yield {
        output: { message: "Tool call was not emitted correctly again.", status: "error" },
        toolCallId: "grep-1",
        toolName: "Grep",
        type: "tool-result" as const,
      };
      yield { text: "ツール実行に失敗しました。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "本文を書いて",
            conversationId: conversation.id,
            mode: "chat",
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.conversation.messages.at(-1)).toMatchObject({
        content: "ツール実行に失敗しました。",
        role: "assistant",
        warnings: [
          {
            message: "ツール呼び出しの失敗が続いています。選択中のモデルはチャットモードで必要なファイル操作に十分対応していない可能性があります。LLMプロフィール設定でツール対応の強いモデルへ変更してください。",
            type: "chat_mode_tool_failures",
          },
        ],
      });
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("persists the latest main step context separately from main and writing session usage", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield { text: "回答です", type: "text-delta" as const };
      yield {
        finishReason: "tool-calls",
        type: "finish-step" as const,
        usage: { inputTokens: 10_000, outputTokens: 100, totalTokens: 10_100 },
      };
      yield {
        finishReason: "stop",
        type: "finish-step" as const,
        usage: { inputTokens: 80_000, outputTokens: 200, totalTokens: 80_200 },
      };
      yield {
        output: {
          status: "completed",
          tokenUsage: {
            inputTokens: 50_000,
            llmProfileRole: "writing",
            outputTokens: 5_000,
            totalTokens: 55_000,
          },
        },
        toolCallId: "writing-1",
        toolName: "DelegateWriting",
        type: "tool-result" as const,
      };
      yield {
        finishReason: "stop",
        totalUsage: {
          inputTokens: 90_000,
          outputTokens: 300,
          totalTokens: 90_300,
        },
        type: "finish" as const,
      };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      llmProviderPlugins: [
        {
          createModel: vi.fn(() => ({})) as never,
          displayName: "DeepSeek",
          envKey: "DEEPSEEK_API_KEY",
          id: "deepseek",
          kind: "llm-provider",
          connectionSettingsPolicy: "optional-base-url",
          models: [{
            contextWindowTokens: 1_000_000,
            displayName: "DeepSeek V4 Pro",
            id: "deepseek-v4-pro",
            supportsTools: true,
          }],
        },
      ],
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "質問です",
            conversationId: conversation.id,
            llmProfileId: "builtin:deepseek:main",
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.conversation.messages.at(-1)).toMatchObject({
        content: "回答です",
        mainContextSnapshot: {
          contextWindowTokens: 1_000_000,
          inputTokens: 80_000,
          llmProfileRole: "main",
          modelId: "deepseek-v4-pro",
          providerId: "deepseek",
        },
        role: "assistant",
        tokenUsage: {
          inputTokens: 140_000,
          llmProfileId: "builtin:deepseek:main",
          llmProfileRole: "main",
          modelId: "deepseek-v4-pro",
          outputTokens: 5_300,
          providerId: "deepseek",
          totalTokens: 145_300,
        },
      });
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("records a virtual profile id when the request uses a direct model selection", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield { text: "回答です", type: "text-delta" as const };
      yield {
        finishReason: "stop",
        totalUsage: {
          inputTokens: 12,
          outputTokens: 34,
          totalTokens: 46,
        },
        type: "finish" as const,
      };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      llmProviderPlugins: [
        {
          createModel: vi.fn(() => ({})) as never,
          displayName: "OpenAI",
          envKey: "OPENAI_API_KEY",
          id: "openai",
          kind: "llm-provider",
          connectionSettingsPolicy: "optional-base-url",
          models: [{ displayName: "GPT 5.4 Mini", id: "gpt-5.4-mini", supportsTools: true }],
        },
      ],
      llmProviderConfig: {
        defaultProviderId: "openai",
        providers: {
          anthropic: {},
          deepseek: {},
          gemini: {},
          openai: { apiKey: "openai-key" },
        },
      },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "質問です",
            conversationId: conversation.id,
            modelSelection: { modelId: "gpt-5.4-mini", providerId: "openai" },
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.conversation.messages.at(-1)).toMatchObject({
        content: "回答です",
        role: "assistant",
        tokenUsage: {
          inputTokens: 12,
          llmProfileId: "model:openai:gpt-5.4-mini",
          llmProfileRole: "main",
          modelId: "gpt-5.4-mini",
          outputTokens: 34,
          providerId: "openai",
          totalTokens: 46,
        },
      });
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("persists an assistant warning when the model stops because the output token limit was reached", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield { text: "途中までの回答です", type: "text-delta" as const };
      yield {
        finishReason: "length",
        totalUsage: {
          outputTokens: 12288,
          totalTokens: 20000,
        },
        type: "finish" as const,
      };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "長く書いて",
            conversationId: conversation.id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.conversation.messages.at(-1)).toMatchObject({
        content: "途中までの回答です",
        finishReason: "length",
        role: "assistant",
        warnings: [
          {
            message: "出力上限に達したため応答が途中で止まった可能性があります。",
            type: "output_limit",
          },
        ],
      });
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not persist an assistant warning for normal stop finish reasons", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield { text: "通常完了です", type: "text-delta" as const };
      yield { finishReason: "stop", totalUsage: { totalTokens: 12 }, type: "finish" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "短く答えて",
            conversationId: conversation.id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.conversation.messages.at(-1)).toMatchObject({
        content: "通常完了です",
        finishReason: "stop",
        role: "assistant",
      });
      expect(body.conversation.messages.at(-1).warnings).toBeUndefined();
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("accepts a server-validated model selection and passes the selected provider/model to the agent loop", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const modelProvider = { getLanguageModel: vi.fn() };
    const runAgentLoop = vi.fn(async function* () {
      yield { text: "ok", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      llmProviderPlugins: [
        {
          createModel: vi.fn(() => ({})) as never,
          displayName: "OpenAI",
          envKey: "OPENAI_API_KEY",
          id: "openai",
          kind: "llm-provider",
          connectionSettingsPolicy: "optional-base-url",
          models: [{ displayName: "GPT 5.4 Mini", id: "gpt-5.4-mini", supportsTools: true }],
        },
      ],
      modelProviderFactory: vi.fn(() => modelProvider),
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "READMEを見て",
            conversationId: conversation.id,
            modelSelection: { modelId: "gpt-5.4-mini", providerId: "openai" },
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      expect(runAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          modelProvider,
          profile: expect.objectContaining({ llmProfileRole: "main" }),
          resolveLlmProfileForRole: expect.any(Function),
        }),
      );
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("passes the current editor file path to the agent loop as normalized chapter context input", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield { text: "ok", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "続きを書いて",
            conversationId: conversation.id,
            currentFilePath: "小説\\第001章\\本文.txt",
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      expect(runAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          currentFilePath: "小説/第001章/本文.txt",
        }),
      );
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("logs agent loop errors to the server and persists them in the conversation", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runAgentLoop = vi.fn(async function* () {
      throw new Error("LLM request failed: rate limit");
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "続きを書いて",
            conversationId: conversation.id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.message).toBe("LLM request failed: rate limit");
      expect(errorSpy).toHaveBeenCalledWith(
        "Agent chat LLM execution failed",
        expect.objectContaining({
          conversationId: conversation.id,
          error: expect.any(Error),
          workspaceRoot,
        }),
      );
      expect(body.conversation.messages.map((message: { content: string; role: string }) => ({
        content: message.content,
        role: message.role,
      }))).toEqual([
        { content: "続きを書いて", role: "user" },
        { content: "LLMエラー: LLM request failed: rate limit", role: "system" },
      ]);
    } finally {
      errorSpy.mockRestore();
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("accepts an Anthropic model selection and passes it to the agent loop", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const modelProvider = { getLanguageModel: vi.fn() };
    const modelProviderFactory = vi.fn(() => modelProvider);
    const runAgentLoop = vi.fn(async function* () {
      yield { text: "ok", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      llmProviderPlugins: [
        {
          createModel: vi.fn(() => ({})) as never,
          displayName: "Anthropic",
          envKey: "ANTHROPIC_API_KEY",
          id: "anthropic",
          kind: "llm-provider",
          connectionSettingsPolicy: "optional-base-url",
          models: [
            { displayName: "Claude Sonnet 4.6", id: "claude-sonnet-4-6", supportsTools: true },
          ],
        },
      ],
      modelProviderFactory,
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "READMEを見て",
            conversationId: conversation.id,
            modelSelection: { modelId: "claude-sonnet-4-6", providerId: "anthropic" },
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      expect(modelProviderFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: "claude-sonnet-4-6",
          providerId: "anthropic",
        }),
      );
      expect(runAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          modelProvider,
          profile: expect.objectContaining({ llmProfileRole: "main" }),
          resolveLlmProfileForRole: expect.any(Function),
        }),
      );
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("accepts newly registered model selections and passes the model id through unchanged", async () => {
    const modelSelections = [
      { modelId: "deepseek-v4-flash", providerId: "deepseek" },
      { modelId: "gpt-5.5", providerId: "openai" },
      { modelId: "gemini-3.1-pro", providerId: "gemini" },
      { modelId: "gemini-3.1-flash", providerId: "gemini" },
      { modelId: "claude-opus-4-7", providerId: "anthropic" },
      { modelId: "claude-haiku-4-5", providerId: "anthropic" },
    ];

    for (const modelSelection of modelSelections) {
      const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
      const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
      const conversation = await createConversation({ dataRoot, workspaceRoot });
      const modelProvider = { getLanguageModel: vi.fn() };
      const modelProviderFactory = vi.fn(() => modelProvider);
      const runAgentLoop = vi.fn(async function* () {
        yield { text: "ok", type: "text-delta" as const };
      });
      const handler = createAgentChatApiHandler({
        dataRoot,
        llmProviderConfig: {
          providers: {
            anthropic: { apiKey: "anthropic-key" },
            deepseek: { apiKey: "deepseek-key" },
            gemini: { apiKey: "gemini-key" },
            openai: { apiKey: "openai-key" },
          },
        },
        modelProviderFactory,
        runAgentLoop,
      });

      try {
        const response = await handler(
          request(new URL("http://localhost/api/chat/messages"), {
            body: JSON.stringify({
              content: "READMEを見て",
              conversationId: conversation.id,
              modelSelection,
              workspaceRoot,
            }),
            headers: { "content-type": "application/json" },
            method: "POST",
          }),
        );

        expect(response.status).toBe(200);
        expect(modelProviderFactory).toHaveBeenCalledWith(
          expect.objectContaining(modelSelection),
        );
        expect(runAgentLoop).toHaveBeenCalledWith(
          expect.objectContaining({
            modelProvider,
            profile: expect.objectContaining({ llmProfileRole: "main" }),
            resolveLlmProfileForRole: expect.any(Function),
          }),
        );
      } finally {
        rmSync(dataRoot, { force: true, recursive: true });
        rmSync(workspaceRoot, { force: true, recursive: true });
      }
    }
  });

  it("resolves a user-defined OpenAI-compatible profile with its base URL and custom model id", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const modelProvider = { getLanguageModel: vi.fn() };
    const modelProviderFactory = vi.fn(() => modelProvider);
    const runAgentLoop = vi.fn(async function* (options: RunAgentLoopOptions) {
      if (!options.resolveLlmProfileForRole) {
        throw new Error("resolveLlmProfileForRole is required");
      }
      const mainProfile = await options.resolveLlmProfileForRole("main");
      expect(mainProfile).toEqual(
        expect.objectContaining({
          baseURL: "http://localhost:1234/v1",
          id: "user:lm-studio",
          modelId: "gemma-3-12b-it",
          providerId: "openai-compatible",
          supportsToolsOverride: true,
        }),
      );
      yield { text: "ok", type: "text-delta" as const };
    });

    const handler = createAgentChatApiHandler({
      dataRoot,
      llmProviderConfig: {
        providers: {
          anthropic: {},
          deepseek: {},
          gemini: {},
          openai: {},
          "openai-compatible": {},
        },
      },
      modelProviderFactory,
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "READMEを見て",
            conversationId: conversation.id,
            llmProfileId: "user:lm-studio",
            userProfiles: [
              {
                baseURL: "http://localhost:1234/v1",
                id: "user:lm-studio",
                maxOutputTokens: 4096,
                modelId: "gemma-3-12b-it",
                name: "LM Studio",
                providerId: "openai-compatible",
                source: "user",
                supportsToolsOverride: true,
                temperature: 0.3,
              },
            ],
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      expect(modelProviderFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: "http://localhost:1234/v1",
          modelId: "gemma-3-12b-it",
          providerId: "openai-compatible",
        }),
      );
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("rejects unknown model selections before running the agent", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const runAgentLoop = vi.fn(async function* () {
      yield { text: "should not run", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      llmProviderPlugins: [
        {
          createModel: vi.fn(() => ({})) as never,
          displayName: "DeepSeek",
          envKey: "DEEPSEEK_API_KEY",
          id: "deepseek",
          kind: "llm-provider",
          connectionSettingsPolicy: "optional-base-url",
          models: [{ displayName: "DeepSeek V4 Pro", id: "deepseek-v4-pro", supportsTools: true }],
        },
      ],
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "READMEを見て",
            modelSelection: { modelId: "not-a-model", providerId: "deepseek" },
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.message).toMatch(/Unknown model/);
      expect(runAgentLoop).not.toHaveBeenCalled();
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("persists Edit tool results as pending edit proposals", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(path.join(workspaceRoot, "note.txt"), "old", "utf8");
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield {
        output: {
          diff: "--- note.txt\n+++ note.txt\n@@\n-old\n+new",
          newText: "new",
          oldText: "old",
          path: "note.txt",
          title: "Edit note.txt",
        },
        toolCallId: "call-1",
        toolName: "Edit",
        type: "tool-result" as const,
      };
      yield { text: "編集案を作成しました。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "note.txtを直して",
            conversationId: conversation.id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.conversation.editProposals).toHaveLength(1);
      expect(body.conversation.editProposals[0]).toMatchObject({
        newText: "new",
        oldText: "old",
        path: "note.txt",
        status: "pending",
      });
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("auto-applies Edit tool results when the chat request is sent from chat mode", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const filePath = path.join(workspaceRoot, "note.txt");
    writeFileSync(filePath, "before old after", "utf8");
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield {
        output: {
          diff: "--- note.txt\n+++ note.txt\n@@\n-old\n+new",
          newText: "new",
          oldText: "old",
          path: "note.txt",
          title: "Edit note.txt",
        },
        toolCallId: "call-1",
        toolName: "Edit",
        type: "tool-result" as const,
      };
      yield { text: "編集を適用しました。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "note.txtを直して",
            conversationId: conversation.id,
            mode: "chat",
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(readFileSync(filePath, "utf8")).toBe("before new after");
      expect(body.conversation.editProposals).toHaveLength(1);
      expect(body.conversation.editProposals[0]).toMatchObject({
        newText: "new",
        oldText: "old",
        path: "note.txt",
        status: "applied",
        undoSnapshot: {
          afterContent: "before new after",
          beforeContent: "before old after",
        },
      });
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("keeps Edit tool results pending when the chat request is sent from editor mode", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const filePath = path.join(workspaceRoot, "note.txt");
    writeFileSync(filePath, "old", "utf8");
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield {
        output: {
          diff: "--- note.txt\n+++ note.txt\n@@\n-old\n+new",
          newText: "new",
          oldText: "old",
          path: "note.txt",
          title: "Edit note.txt",
        },
        toolCallId: "call-1",
        toolName: "Edit",
        type: "tool-result" as const,
      };
      yield { text: "編集案を作成しました。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "note.txtを直して",
            conversationId: conversation.id,
            mode: "editor",
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(readFileSync(filePath, "utf8")).toBe("old");
      expect(body.conversation.editProposals[0]).toMatchObject({
        path: "note.txt",
        status: "pending",
      });
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("auto-applies Create and CreateDirectory tool results when sent from chat mode", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield {
        output: {
          diff: "--- /dev/null\n+++ docs/\n@@\n+directory: docs",
          newText: "",
          oldText: "",
          operation: "createDirectory",
          path: "docs",
          title: "Create directory docs",
        },
        toolCallId: "call-dir",
        toolName: "CreateDirectory",
        type: "tool-result" as const,
      };
      yield {
        output: {
          diff: "--- /dev/null\n+++ docs/new.md\n@@\n+# New file",
          newText: "# New file\n",
          oldText: "",
          operation: "create",
          path: "docs/new.md",
          title: "Create docs/new.md",
        },
        toolCallId: "call-file",
        toolName: "Create",
        type: "tool-result" as const,
      };
      yield { text: "作成しました。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "docsを作って",
            conversationId: conversation.id,
            mode: "chat",
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(readFileSync(path.join(workspaceRoot, "docs", "new.md"), "utf8")).toBe("# New file\n");
      expect(body.conversation.editProposals).toEqual([
        expect.objectContaining({
          operation: "createDirectory",
          path: "docs",
          status: "applied",
        }),
        expect.objectContaining({
          operation: "create",
          path: "docs/new.md",
          status: "applied",
          undoSnapshot: {
            afterContent: "# New file\n",
            beforeContent: "",
          },
        }),
      ]);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("persists CreateWritingEditProposal tool results with writing sourceRole", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(path.join(workspaceRoot, "chapter.txt"), "old", "utf8");
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield {
        output: {
          diff: "--- chapter.txt\n+++ chapter.txt\n@@\n-old\n+new",
          newText: "new",
          oldText: "old",
          operation: "edit",
          path: "chapter.txt",
          sourceRole: "writing",
          title: "Edit chapter.txt",
        },
        toolCallId: "call-1",
        toolName: "CreateWritingEditProposal",
        type: "tool-result" as const,
      };
      yield { text: "編集案を作成しました。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "chapter.txtの続きを書いて",
            conversationId: conversation.id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.conversation.editProposals).toHaveLength(1);
      expect(body.conversation.editProposals[0]).toMatchObject({
        newText: "new",
        oldText: "old",
        operation: "edit",
        path: "chapter.txt",
        sourceRole: "writing",
        status: "pending",
      });
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("persists writing Create proposals from CreateWritingEditProposal", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    mkdirSync(path.join(workspaceRoot, "manuscript"), { recursive: true });
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield {
        output: {
          diff: "--- /dev/null\n+++ manuscript/scene-02.txt\n@@\n+Scene prose",
          newText: "Scene prose",
          oldText: "",
          operation: "create",
          path: "manuscript/scene-02.txt",
          sourceRole: "writing",
          title: "Create manuscript/scene-02.txt",
        },
        toolCallId: "call-1",
        toolName: "CreateWritingEditProposal",
        type: "tool-result" as const,
      };
      yield { text: "新規シーン案を作成しました。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "scene-02.txtを書いて",
            conversationId: conversation.id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.conversation.editProposals).toHaveLength(1);
      expect(body.conversation.editProposals[0]).toMatchObject({
        newText: "Scene prose",
        oldText: "",
        operation: "create",
        path: "manuscript/scene-02.txt",
        sourceRole: "writing",
        status: "pending",
      });
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("persists Create tool results as pending create proposals", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield {
        output: {
          diff: "--- /dev/null\n+++ docs/new.md\n@@\n+# New file",
          newText: "# New file\n",
          oldText: "",
          operation: "create",
          path: "docs/new.md",
          title: "Create docs/new.md",
        },
        toolCallId: "call-1",
        toolName: "Create",
        type: "tool-result" as const,
      };
      yield { text: "新規ファイル作成案を作成しました。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "docs/new.mdを作って",
            conversationId: conversation.id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.conversation.editProposals).toHaveLength(1);
      expect(body.conversation.editProposals[0]).toMatchObject({
        newText: "# New file\n",
        oldText: "",
        operation: "create",
        path: "docs/new.md",
        status: "pending",
      });
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("persists CreateDirectory tool results as pending directory proposals", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield {
        output: {
          diff: "--- /dev/null\n+++ docs/\n@@\n+directory: docs",
          newText: "",
          oldText: "",
          operation: "createDirectory",
          path: "docs",
          title: "Create directory docs",
        },
        toolCallId: "call-1",
        toolName: "CreateDirectory",
        type: "tool-result" as const,
      };
      yield { text: "ディレクトリ作成案を作成しました。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "docsディレクトリを作って",
            conversationId: conversation.id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.conversation.editProposals).toHaveLength(1);
      expect(body.conversation.editProposals[0]).toMatchObject({
        newText: "",
        oldText: "",
        operation: "createDirectory",
        path: "docs",
        status: "pending",
      });
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("streams tool activity events before the final conversation when NDJSON is requested", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield {
        input: { path: "README.md" },
        toolCallId: "call-1",
        toolName: "Read",
        type: "tool-call" as const,
      };
      yield {
        output: { content: "raw file content that should not be streamed", path: "README.md" },
        toolCallId: "call-1",
        toolName: "Read",
        type: "tool-result" as const,
      };
      yield { text: "読みました。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "READMEを見て",
            conversationId: conversation.id,
            workspaceRoot,
          }),
          headers: {
            accept: "application/x-ndjson",
            "content-type": "application/json",
          },
          method: "POST",
        }),
      );
      const text = await response.text();
      const events = text.trim().split("\n").map((line) => JSON.parse(line));

      expect(response.headers.get("content-type")).toContain("application/x-ndjson");
      expect(events).toEqual([
        {
          activity: expect.objectContaining({
            label: "Read README.md",
            status: "running",
            toolCallId: "call-1",
            toolName: "Read",
          }),
          type: "tool-activity",
        },
        {
          activity: expect.objectContaining({
            label: "Read README.md",
            status: "completed",
          }),
          type: "tool-activity",
        },
        { text: "読みました。", type: "text-delta" },
        { conversation: expect.objectContaining({ id: conversation.id }), type: "conversation" },
      ]);
      expect(text).not.toContain("raw file content");
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("streams and persists plan updates for the assistant message", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield {
        input: {
          items: [
            { id: "inspect", status: "completed", title: "関連ファイルを確認" },
            { id: "implement", status: "in_progress", title: "実装する" },
          ],
        },
        toolCallId: "plan-1",
        toolName: "UpdatePlan",
        type: "tool-call" as const,
      };
      yield {
        output: {
          items: [
            { id: "inspect", status: "completed", title: "関連ファイルを確認" },
            { id: "implement", status: "in_progress", title: "実装する" },
          ],
        },
        toolCallId: "plan-1",
        toolName: "UpdatePlan",
        type: "tool-result" as const,
      };
      yield { text: "進めます。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "計画して",
            conversationId: conversation.id,
            workspaceRoot,
          }),
          headers: {
            accept: "application/x-ndjson",
            "content-type": "application/json",
          },
          method: "POST",
        }),
      );
      const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
      const conversationEvent = events.at(-1);
      const assistantMessage = conversationEvent.conversation.messages.find(
        (message: { role: string }) => message.role === "assistant",
      );

      expect(events.filter((event) => event.type === "tool-activity")).toEqual([]);
      expect(events[0]).toEqual({
        plan: {
          items: [
            { id: "inspect", status: "completed", title: "関連ファイルを確認" },
            { id: "implement", status: "in_progress", title: "実装する" },
          ],
        },
        type: "plan-update",
      });
      expect(conversationEvent.conversation.plans).toEqual([
        expect.objectContaining({
          assistantMessageId: assistantMessage.id,
          items: [
            { id: "inspect", status: "completed", title: "関連ファイルを確認" },
            { id: "implement", status: "in_progress", title: "実装する" },
          ],
        }),
      ]);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("associates persisted tool activity with the assistant message from the same response", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield {
        input: { query: "runAgentLoop" },
        toolCallId: "grep-1",
        toolName: "Grep",
        type: "tool-call" as const,
      };
      yield {
        output: { matches: [{ line: "hidden raw result", path: "src/a.ts" }] },
        toolCallId: "grep-1",
        toolName: "Grep",
        type: "tool-result" as const,
      };
      yield { text: "検索しました。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "検索して",
            conversationId: conversation.id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();
      const assistantMessage = body.conversation.messages.find(
        (message: { role: string }) => message.role === "assistant",
      );

      expect(response.status).toBe(200);
      expect(assistantMessage).toMatchObject({
        content: "検索しました。",
        id: expect.any(String),
      });
      expect(body.conversation.toolActivities).toEqual([
        expect.objectContaining({
          assistantMessageId: assistantMessage.id,
          label: "Grep runAgentLoop",
          status: "completed",
          toolCallId: "grep-1",
          toolName: "Grep",
        }),
      ]);
      expect(JSON.stringify(body.conversation.toolActivities)).not.toContain("hidden raw result");
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("associates persisted edit proposals with the assistant message from the same response", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    const runAgentLoop = vi.fn(async function* () {
      yield {
        output: {
          diff: "--- /dev/null\n+++ docs/new.md\n@@\n+# New file",
          newText: "# New file\n",
          oldText: "",
          operation: "create",
          path: "docs/new.md",
          title: "Create docs/new.md",
        },
        toolCallId: "call-1",
        toolName: "Create",
        type: "tool-result" as const,
      };
      yield { text: "作成案を用意しました。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "docs/new.mdを作って",
            conversationId: conversation.id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();
      const assistantMessage = body.conversation.messages.find(
        (message: { role: string }) => message.role === "assistant",
      );

      expect(response.status).toBe(200);
      expect(body.conversation.editProposals).toEqual([
        expect.objectContaining({
          assistantMessageId: assistantMessage.id,
          operation: "create",
          path: "docs/new.md",
          status: "pending",
        }),
      ]);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("persists compact tool results and uses the compact strategy on the next production turn", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const conversation = await createConversation({ dataRoot, workspaceRoot });
    let invocation = 0;
    const receivedMessages: unknown[] = [];
    const runAgentLoop = vi.fn(async function* (options) {
      receivedMessages.push(options.messages);
      invocation += 1;
      if (invocation === 1) {
        yield {
          input: { path: "chapter.txt" },
          toolCallId: "read-1",
          toolName: "Read",
          type: "tool-call" as const,
        };
        yield {
          output: {
            content: "full manuscript must not be stored",
            path: "chapter.txt",
            totalLines: 8,
            truncated: false,
          },
          toolCallId: "read-1",
          toolName: "Read",
          type: "tool-result" as const,
        };
        yield { text: "確認しました。", type: "text-delta" as const };
      } else {
        yield { text: "続けます。", type: "text-delta" as const };
      }
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const send = (content: string) =>
        handler(
          request(new URL("http://localhost/api/chat/messages"), {
            body: JSON.stringify({ content, conversationId: conversation.id, workspaceRoot }),
            headers: { "content-type": "application/json" },
            method: "POST",
          }),
        );
      const firstResponse = await send("chapter.txtを読んで");
      const firstBody = await firstResponse.json();
      await send("続きを書いて");

      const assistantMessage = firstBody.conversation.messages.find(
        (message: { role: string }) => message.role === "assistant",
      );
      expect(firstBody.conversation.toolResultSummaries).toEqual([
        expect.objectContaining({
          assistantMessageId: assistantMessage.id,
          toolCallId: "read-1",
          toolName: "Read",
        }),
      ]);
      expect(JSON.stringify(firstBody.conversation.toolResultSummaries)).not.toContain(
        "full manuscript must not be stored",
      );
      expect(JSON.stringify(receivedMessages[1])).toContain("[圧縮された過去のツール履歴]");
      expect(JSON.stringify(receivedMessages[1])).toContain("Read chapter.txt");
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("stages valid dropped bytes and places the exact original bytes through run-scoped tools", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const originalBytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("本文\r\n二行目", "utf8"),
    ]);
    const runAgentLoop = vi.fn(async function* (options: RunAgentLoopOptions) {
      const prompt = JSON.stringify(options.messages);
      const droppedFileId = prompt.match(/droppedFileId=([0-9a-f-]{36})/)?.[1];
      expect(droppedFileId).toBeDefined();

      await expect(
        options.toolServices?.readDroppedTextFile?.({ droppedFileId: droppedFileId! }),
      ).resolves.toMatchObject({
        name: "memo.txt",
        totalLines: 2,
        truncated: false,
      });
      const proposal = await options.toolServices?.placeDroppedTextFile?.({
        droppedFileId: droppedFileId!,
        targetPath: "memo.txt",
      });
      yield {
        output: proposal,
        toolCallId: "place-drop-1",
        toolName: "PlaceDroppedTextFile",
        type: "tool-result" as const,
      };
      yield { text: "配置しました。", type: "text-delta" as const };
    });
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "適切な場所へ配置して",
            droppedTextFiles: [
              {
                contentBase64: originalBytes.toString("base64"),
                name: "memo.txt",
              },
            ],
            mode: "chat",
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(readFileSync(path.join(workspaceRoot, "memo.txt"))).toEqual(originalBytes);
      expect(body.conversation.editProposals).toEqual([
        expect.objectContaining({
          operation: "create",
          path: "memo.txt",
          status: "applied",
        }),
      ]);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("rejects invalid dropped file bytes or a non-chat mode before starting the agent", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-chat-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const runAgentLoop = vi.fn();
    const handler = createAgentChatApiHandler({
      dataRoot,
      modelProvider: { getLanguageModel: vi.fn() },
      runAgentLoop,
    });
    const send = (body: Record<string, unknown>) =>
      handler(
        request(new URL("http://localhost/api/chat/messages"), {
          body: JSON.stringify({
            content: "配置して",
            workspaceRoot,
            ...body,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

    try {
      const invalidUtf8 = await send({
        droppedTextFiles: [{ contentBase64: "/w==", name: "bad.txt" }],
        mode: "chat",
      });
      const editorMode = await send({
        droppedTextFiles: [{ contentBase64: "eA==", name: "memo.txt" }],
        mode: "editor",
      });

      expect(invalidUtf8.status).toBe(400);
      expect(editorMode.status).toBe(400);
      expect(runAgentLoop).not.toHaveBeenCalled();
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });
});
