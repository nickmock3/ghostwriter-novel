import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  type RenderOptions,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { LlmProfileRoleAssignments } from "../llm/profiles/llmProfiles";
import type { LlmProviderChoice, SelectedModel } from "../llm/selection/llmSelection";
import { ChatPane, type AppliedEditProposal, type ChatPaneProps } from "./ChatPane";
import { useChatConversationController } from "./useChatConversationController";

beforeEach(() => localStorage.clear());

type FlatChatPaneProps = {
  workspaceRoot: string | null;
  mode?: ChatPaneProps["mode"];
  layout?: ChatPaneProps["layout"];
  currentFilePath?: string | null;
  dirtyPaths?: string[];
  appendedTextRequest?: { id: number; text: string } | null;
  autoCompactEnabled?: boolean;
  autoCompactThresholdRatio?: number;
  modelSelection?: SelectedModel | null;
  llmProviders?: LlmProviderChoice[];
  llmProfiles?: ChatPaneProps["llm"] extends infer Llm | undefined
    ? Llm extends { profiles?: infer Profiles }
      ? Profiles
      : never
    : never;
  llmProfileRoleAssignments?: LlmProfileRoleAssignments | null;
  onMainLlmProfileIdChange?: (profileId: string | null) => void;
  onMainLlmModelSelectionChange?: (modelSelection: SelectedModel | null) => void;
  onModelSelectionChange?: (modelSelection: SelectedModel | null) => void;
  onAppliedEdit?: (proposal: AppliedEditProposal) => void;
  onOpenPath?: (path: string) => void;
  paneCollapseControl?: ReactNode;
  paneLayoutResetControl?: ReactNode;
};

function chatPaneProps(flat: FlatChatPaneProps): ChatPaneProps {
  const {
    workspaceRoot,
    currentFilePath,
    dirtyPaths,
    appendedTextRequest,
    autoCompactEnabled,
    autoCompactThresholdRatio,
    modelSelection,
    llmProviders,
    llmProfiles,
    llmProfileRoleAssignments,
    onMainLlmProfileIdChange,
    onMainLlmModelSelectionChange,
    onModelSelectionChange,
    onAppliedEdit,
    onOpenPath,
    paneCollapseControl,
    paneLayoutResetControl,
    mode,
    layout,
  } = flat;

  return {
    ...(mode !== undefined ? { mode } : {}),
    ...(layout !== undefined ? { layout } : {}),
    fileContext: {
      workspaceRoot,
      ...(currentFilePath !== undefined ? { currentFilePath } : {}),
      ...(dirtyPaths !== undefined ? { dirtyPaths } : {}),
      ...(appendedTextRequest !== undefined ? { appendedTextRequest } : {}),
    },
    ...(autoCompactEnabled !== undefined || autoCompactThresholdRatio !== undefined
      ? {
          conversationOptions: {
            ...(autoCompactEnabled !== undefined ? { autoCompactEnabled } : {}),
            ...(autoCompactThresholdRatio !== undefined ? { autoCompactThresholdRatio } : {}),
          },
        }
      : {}),
    ...((modelSelection !== undefined ||
      llmProviders !== undefined ||
      llmProfiles !== undefined ||
      llmProfileRoleAssignments !== undefined ||
      onMainLlmProfileIdChange !== undefined ||
      onMainLlmModelSelectionChange !== undefined ||
      onModelSelectionChange !== undefined)
      ? {
          llm: {
            ...(modelSelection !== undefined ? { modelSelection } : {}),
            ...(llmProviders !== undefined ? { providers: llmProviders } : {}),
            ...(llmProfiles !== undefined ? { profiles: llmProfiles } : {}),
            ...(llmProfileRoleAssignments !== undefined ? { roleAssignments: llmProfileRoleAssignments } : {}),
            ...(onMainLlmProfileIdChange !== undefined ? { onMainLlmProfileIdChange } : {}),
            ...(onMainLlmModelSelectionChange !== undefined ? { onMainLlmModelSelectionChange } : {}),
            ...(onModelSelectionChange !== undefined ? { onModelSelectionChange } : {}),
          },
        }
      : {}),
    ...((onAppliedEdit !== undefined || onOpenPath !== undefined)
      ? {
          editActions: {
            ...(onAppliedEdit !== undefined ? { onAppliedEdit } : {}),
            ...(onOpenPath !== undefined ? { onOpenPath } : {}),
          },
        }
      : {}),
    ...((paneCollapseControl !== undefined || paneLayoutResetControl !== undefined)
      ? {
          paneControls: {
            ...(paneCollapseControl !== undefined ? { paneCollapseControl } : {}),
            ...(paneLayoutResetControl !== undefined ? { paneLayoutResetControl } : {}),
          },
        }
      : {}),
  };
}

function TestChatPane(props: FlatChatPaneProps) {
  return <ChatPane {...chatPaneProps(props)} />;
}

function renderChatPane(props: FlatChatPaneProps, options?: RenderOptions) {
  return render(<TestChatPane {...props} />, options);
}

describe("ChatPane", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the latest conversation for the active workspace", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          activeConversation: {
            createdAt: "2026-05-09T00:00:00.000Z",
            editProposals: [],
            id: "conv-1",
            lastOpenedAt: "2026-05-09T00:00:00.000Z",
            messages: [
              {
                content: "保存済みメッセージ",
                createdAt: "2026-05-09T00:01:00.000Z",
                id: "msg-1",
                role: "user",
              },
            ],
            title: "会話 1",
            updatedAt: "2026-05-09T00:01:00.000Z",
            workspaceId: "workspace",
          },
          conversations: [],
          errors: [],
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    await waitFor(() => {
      expect(screen.getByText("保存済みメッセージ")).toBeInTheDocument();
    });
  });

  it("ignores a stale conversation load after the workspace changes", async () => {
    let resolveFirstLoad: ((response: Response) => void) | undefined;
    const firstLoad = new Promise<Response>((resolve) => {
      resolveFirstLoad = resolve;
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockReturnValueOnce(firstLoad)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            activeConversation: {
              createdAt: "2026-05-09T00:00:00.000Z",
              editProposals: [],
              id: "conv-new",
              lastOpenedAt: "2026-05-09T00:00:00.000Z",
              messages: [{
                content: "新しいワークスペースの会話",
                createdAt: "2026-05-09T00:01:00.000Z",
                id: "msg-new",
                role: "user",
              }],
              title: "新しい会話",
              updatedAt: "2026-05-09T00:01:00.000Z",
              workspaceId: "workspace-new",
            },
            conversations: [],
            errors: [],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );

    const { rerender } = render(<TestChatPane workspaceRoot="/tmp/workspace-old" />);
    rerender(<TestChatPane workspaceRoot="/tmp/workspace-new" />);

    expect(await screen.findByText("新しいワークスペースの会話")).toBeInTheDocument();

    resolveFirstLoad?.(
      new Response(
        JSON.stringify({
          activeConversation: {
            createdAt: "2026-05-08T00:00:00.000Z",
            editProposals: [],
            id: "conv-old",
            lastOpenedAt: "2026-05-08T00:00:00.000Z",
            messages: [{
              content: "古いワークスペースの会話",
              createdAt: "2026-05-08T00:01:00.000Z",
              id: "msg-old",
              role: "user",
            }],
            title: "古い会話",
            updatedAt: "2026-05-08T00:01:00.000Z",
            workspaceId: "workspace-old",
          },
          conversations: [],
          errors: [],
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.queryByText("古いワークスペースの会話")).not.toBeInTheDocument();
    });
  });

  it("ignores stale stream updates after the workspace changes", async () => {
    const encoder = new TextEncoder();
    let oldStreamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const oldStream = new ReadableStream<Uint8Array>({
      start(controller) {
        oldStreamController = controller;
      },
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ activeConversation: null, conversations: [], errors: [] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(oldStream, {
          headers: { "content-type": "application/x-ndjson" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            activeConversation: {
              createdAt: "2026-05-10T00:00:00.000Z",
              editProposals: [],
              id: "conv-new-stream",
              lastOpenedAt: "2026-05-10T00:00:00.000Z",
              messages: [{
                content: "切替先の会話",
                createdAt: "2026-05-10T00:01:00.000Z",
                id: "msg-new-stream",
                role: "user",
              }],
              title: "切替先",
              updatedAt: "2026-05-10T00:01:00.000Z",
              workspaceId: "workspace-new",
            },
            conversations: [],
            errors: [],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );

    const { rerender } = render(
      <TestChatPane
        mode="chat"
        modelSelection={{ modelId: "deepseek-v4-pro", providerId: "deepseek" }}
        workspaceRoot="/tmp/workspace-old"
      />,
    );
    const composer = await screen.findByPlaceholderText("書きたいこと、相談したいことを入力");
    fireEvent.change(composer, { target: { value: "旧workspaceへの質問" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByLabelText("AI応答生成中");

    rerender(
      <TestChatPane
        mode="chat"
        modelSelection={{ modelId: "deepseek-v4-pro", providerId: "deepseek" }}
        workspaceRoot="/tmp/workspace-new"
      />,
    );
    expect(await screen.findByText("切替先の会話")).toBeInTheDocument();

    await act(async () => {
      oldStreamController?.enqueue(
        encoder.encode(`${JSON.stringify({ text: "旧stream本文", type: "text-delta" })}\n`),
      );
      oldStreamController?.enqueue(
        encoder.encode(`${JSON.stringify({
          conversation: {
            conversationCompactions: [],
            createdAt: "2026-05-09T00:00:00.000Z",
            editProposals: [],
            id: "conv-old-stream",
            lastOpenedAt: "2026-05-09T00:00:00.000Z",
            messages: [{
              content: "旧stream本文",
              createdAt: "2026-05-09T00:01:00.000Z",
              id: "msg-old-stream",
              role: "assistant",
            }],
            plans: [],
            title: "旧stream",
            toolActivities: [],
            toolResultSummaries: [],
            updatedAt: "2026-05-09T00:01:00.000Z",
            workspaceId: "workspace-old",
          },
          type: "conversation",
        })}\n`),
      );
      oldStreamController?.close();
    });

    await waitFor(() => {
      expect(screen.getByText("切替先の会話")).toBeInTheDocument();
      expect(screen.queryByText("旧stream本文")).not.toBeInTheDocument();
    });
  });

  it("scrolls chat mode to the latest message after loading a conversation", async () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          activeConversation: {
            createdAt: "2026-05-09T00:00:00.000Z",
            editProposals: [],
            id: "conv-scroll",
            lastOpenedAt: "2026-05-09T00:00:00.000Z",
            messages: Array.from({ length: 30 }, (_, index) => ({
              content: `保存済みメッセージ ${index + 1}`,
              createdAt: `2026-05-09T00:${String(index + 1).padStart(2, "0")}:00.000Z`,
              id: `msg-${index + 1}`,
              role: index % 2 === 0 ? "user" : "assistant",
            })),
            title: "長い会話",
            toolActivities: [],
            updatedAt: "2026-05-09T00:30:00.000Z",
            workspaceId: "workspace",
          },
          conversations: [],
          errors: [],
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );

    render(<TestChatPane mode="chat" workspaceRoot="/tmp/workspace" />);

    await screen.findByText("保存済みメッセージ 30");
    const scrollArea = document.querySelector(".chat-scroll-area") as HTMLElement;
    Object.defineProperties(scrollArea, {
      clientHeight: { configurable: true, value: 120 },
      scrollHeight: { configurable: true, value: 900 },
    });
    scrollArea.scrollTop = 0;
    for (const callback of frameCallbacks.splice(0)) {
      callback(0);
    }

    await waitFor(() => {
      expect(scrollArea.scrollTop).toBe(780);
    });
  });

  it("keeps the user's past-log scroll position when new chat content appears", async () => {
    const encoder = new TextEncoder();
    let resolveRead: (value: ReadableStreamReadResult<Uint8Array>) => void = () => {};
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ text: "ストリーミング本文", type: "text-delta" }) + "\n"));
        return new Promise<void>((resolve) => {
          resolveRead = (value) => {
            if (!value.done) {
              controller.enqueue(value.value);
            }
            controller.close();
            resolve();
          };
        });
      },
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            activeConversation: {
              createdAt: "2026-05-09T00:00:00.000Z",
              editProposals: [],
              id: "conv-scroll",
              lastOpenedAt: "2026-05-09T00:00:00.000Z",
              messages: [{ content: "過去の会話", createdAt: "2026-05-09T00:01:00.000Z", id: "msg-1", role: "user" }],
              title: "長い会話",
              toolActivities: [],
              updatedAt: "2026-05-09T00:01:00.000Z",
              workspaceId: "workspace",
            },
            conversations: [],
            errors: [],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(responseBody, {
          headers: { "content-type": "application/x-ndjson" },
          status: 200,
        }),
      );

    render(<TestChatPane mode="chat" workspaceRoot="/tmp/workspace" />);

    await screen.findByText("過去の会話");
    const scrollArea = document.querySelector(".chat-scroll-area") as HTMLElement;
    Object.defineProperties(scrollArea, {
      clientHeight: { configurable: true, value: 120 },
      scrollHeight: { configurable: true, value: 900 },
    });
    scrollArea.scrollTop = 120;
    fireEvent.scroll(scrollArea);

    fireEvent.change(screen.getByPlaceholderText("書きたいこと、相談したいことを入力"), {
      target: { value: "続きを書いて" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    await screen.findByText("ストリーミング本文");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(scrollArea.scrollTop).toBe(120);
    resolveRead?.({
      done: false,
      value: encoder.encode(
        JSON.stringify({
          conversation: {
            conversationCompactions: [],
            createdAt: "2026-05-09T00:00:00.000Z",
            editProposals: [],
            id: "conv-scroll",
            lastOpenedAt: "2026-05-09T00:00:00.000Z",
            messages: [
              { content: "過去の会話", createdAt: "2026-05-09T00:01:00.000Z", id: "msg-1", role: "user" },
              { content: "続きを書いて", createdAt: "2026-05-09T00:02:00.000Z", id: "msg-2", role: "user" },
              { content: "ストリーミング本文", createdAt: "2026-05-09T00:03:00.000Z", id: "msg-3", role: "assistant" },
            ],
            plans: [],
            title: "長い会話",
            toolActivities: [],
            toolResultSummaries: [],
            updatedAt: "2026-05-09T00:03:00.000Z",
            workspaceId: "workspace",
          },
          type: "conversation",
        }) + "\n",
      ),
    });
  });

  it("does not move the chat scroll area outside chat mode", async () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          activeConversation: {
            createdAt: "2026-05-09T00:00:00.000Z",
            editProposals: [],
            id: "conv-editor-scroll",
            lastOpenedAt: "2026-05-09T00:00:00.000Z",
            messages: [{
              content: "エディットモードの会話",
              createdAt: "2026-05-09T00:01:00.000Z",
              id: "msg-editor-scroll",
              role: "user",
            }],
            title: "エディットモード",
            updatedAt: "2026-05-09T00:01:00.000Z",
            workspaceId: "workspace",
          },
          conversations: [],
          errors: [],
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );

    render(<TestChatPane mode="editor" workspaceRoot="/tmp/workspace" />);

    await screen.findByText("エディットモードの会話");
    const scrollArea = document.querySelector(".chat-scroll-area") as HTMLElement;
    Object.defineProperties(scrollArea, {
      clientHeight: { configurable: true, value: 120 },
      scrollHeight: { configurable: true, value: 900 },
    });
    scrollArea.scrollTop = 120;
    for (const callback of frameCallbacks.splice(0)) {
      callback(0);
    }

    expect(scrollArea.scrollTop).toBe(120);
  });

  it("hides the new chat guidance as soon as the first turn starts", async () => {
    const pendingResponse = new Promise<Response>(() => {});
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ activeConversation: null, conversations: [], errors: [] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockReturnValueOnce(pendingResponse);

    render(
      <TestChatPane
        modelSelection={{ modelId: "deepseek-v4-pro", providerId: "deepseek" }}
        workspaceRoot="/tmp/workspace"
      />,
    );

    expect(await screen.findByText("小説づくりをチャットで進めましょう。")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("書きたいこと、相談したいことを入力"), {
      target: { value: "物語の続きを考えて" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    expect(await screen.findByRole("status", { name: "AI応答生成中" })).toBeInTheDocument();
    expect(screen.queryByText("小説づくりをチャットで進めましょう。")).not.toBeInTheDocument();
  });

  it("creates a new conversation from the chat pane", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: {
              createdAt: "2026-05-09T00:00:00.000Z",
              editProposals: [],
              id: "conv-2",
              lastOpenedAt: "2026-05-09T00:00:00.000Z",
              messages: [],
              title: "新規会話",
              updatedAt: "2026-05-09T00:00:00.000Z",
              workspaceId: "workspace",
            },
          }),
          { headers: { "content-type": "application/json" }, status: 201 },
        ),
      );

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    fireEvent.click(await screen.findByRole("button", { name: "新規会話" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/conversations", {
        body: JSON.stringify({ workspaceRoot: "/tmp/workspace" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    });
  });

  it("shows Codex token usage separately from quota", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          activeConversation: {
            agentRuntime: "codex-app-server",
            conversationCompactions: [],
            createdAt: "2026-05-09T00:00:00.000Z",
            editProposals: [],
            id: "conv-codex-usage",
            lastOpenedAt: "2026-05-09T00:00:00.000Z",
            messages: [
              {
                content: "応答",
                createdAt: "2026-05-09T00:00:00.000Z",
                id: "message-1",
                role: "assistant",
                tokenUsage: { inputTokens: 12000, outputTokens: 4000, totalTokens: 16000 },
              },
            ],
            plans: [],
            title: "会話",
            toolActivities: [],
            toolResultSummaries: [],
            updatedAt: "2026-05-09T00:00:00.000Z",
            workspaceId: "workspace",
          },
          conversations: [],
          errors: [],
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    const usage = await screen.findByLabelText("Codexセッショントークン使用量");
    expect(usage).toHaveTextContent("合計 16k");
    expect(usage).not.toHaveTextContent("利用枠");
    expect(usage).not.toHaveTextContent("リセット");
    expect(screen.getByText(/旧Codex接続は廃止/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "continue" } });
    expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
    expect(screen.queryByRole("combobox", { name: "Codexモデル" })).not.toBeInTheDocument();
  });

  it("selects a conversation from the history modal and closes with Escape", async () => {
    const firstConversation = {
      createdAt: "2026-05-09T00:00:00.000Z",
      editProposals: [],
      id: "conv-1",
      lastOpenedAt: "2026-05-09T00:00:00.000Z",
      messages: [
        {
          content: "最初の会話",
          createdAt: "2026-05-09T00:01:00.000Z",
          id: "msg-1",
          role: "user",
        },
      ],
      title: "会話 1",
      updatedAt: "2026-05-09T00:01:00.000Z",
      workspaceId: "workspace",
    };
    const secondConversation = {
      ...firstConversation,
      id: "conv-2",
      lastOpenedAt: "2026-05-09T00:02:00.000Z",
      messages: [
        {
          content: "二番目の会話",
          createdAt: "2026-05-09T00:02:00.000Z",
          id: "msg-2",
          role: "assistant",
        },
      ],
      title: "会話 2",
      updatedAt: "2026-05-09T00:02:00.000Z",
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            activeConversation: firstConversation,
            conversations: [firstConversation, secondConversation],
            errors: [],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: secondConversation }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }));

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    await screen.findByText("最初の会話");
    fireEvent.click(screen.getByRole("button", { name: "会話履歴を開く" }));

    const dialog = screen.getByRole("dialog", { name: "会話履歴" });
    expect(dialog).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "会話履歴" })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "会話履歴を開く" }));
    fireEvent.click(screen.getByRole("button", { name: "会話 2" }));

    await waitFor(() => {
      expect(screen.getByText("二番目の会話")).toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog", { name: "会話履歴" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/conversations", {
      body: JSON.stringify({
        action: "touch",
        conversationId: "conv-2",
        workspaceRoot: "/tmp/workspace",
      }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
  });

  it("sends chat messages to the agent endpoint and renders the assistant reply", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: {
              createdAt: "2026-05-09T00:00:00.000Z",
              editProposals: [],
              id: "conv-3",
              lastOpenedAt: "2026-05-09T00:00:00.000Z",
              messages: [
                {
                  content: "質問です",
                  createdAt: "2026-05-09T00:01:00.000Z",
                  id: "msg-1",
                  role: "user",
                },
                {
                  content: "回答です",
                  createdAt: "2026-05-09T00:01:01.000Z",
                  id: "msg-2",
                  role: "assistant",
                },
              ],
              title: "質問です",
              updatedAt: "2026-05-09T00:01:01.000Z",
              workspaceId: "workspace",
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );

    render(
      <TestChatPane
        modelSelection={{ modelId: "deepseek-v4-pro", providerId: "deepseek" }}
        workspaceRoot="/tmp/workspace"
      />,
    );

    fireEvent.change(await screen.findByPlaceholderText("書きたいこと、相談したいことを入力"), {
      target: { value: "質問です" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    expect(await screen.findByText("回答です")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/chat/messages", {
      body: JSON.stringify({
        autoCompactEnabled: true,
        autoCompactThresholdRatio: 0.7,
        content: "質問です",
        conversationId: undefined,
        modelSelection: {
          modelId: "deepseek-v4-pro",
          providerId: "deepseek",
        },
        workspaceRoot: "/tmp/workspace",
      }),
      headers: { accept: "application/x-ndjson", "content-type": "application/json" },
      method: "POST",
    });
  });

  it("restores the submitted draft when streaming fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ activeConversation: null, conversations: [], errors: [] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "stream failed" }), {
          headers: { "content-type": "application/json" },
          status: 500,
        }),
      );

    render(
      <TestChatPane
        modelSelection={{ modelId: "deepseek-v4-pro", providerId: "deepseek" }}
        workspaceRoot="/tmp/workspace"
      />,
    );

    const composer = await screen.findByPlaceholderText("書きたいこと、相談したいことを入力");
    fireEvent.change(composer, { target: { value: "失敗しても戻す本文" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("stream failed");
    expect(composer).toHaveValue("失敗しても戻す本文");
  });

  it("prompts for API key setup before sending when the selected chat model is unavailable", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ activeConversation: null, conversations: [], errors: [] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

    render(
      <TestChatPane
        llmProviders={[
          {
            displayName: "OpenAI",
            id: "openai",
            models: [
              {
                available: false,
                displayName: "GPT 5.4 Mini",
                id: "gpt-5.4-mini",
                supportsTools: true,
                unavailableReason: "OpenAI のAPIキーが未設定です。",
              },
            ],
          },
        ]}
        modelSelection={{ modelId: "gpt-5.4-mini", providerId: "openai" }}
        workspaceRoot="/tmp/workspace"
      />,
    );

    const composer = await screen.findByPlaceholderText("書きたいこと、相談したいことを入力");
    fireEvent.change(composer, { target: { value: "本文を推敲して" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("AI機能を使うにはAPIキーが必要です");
    expect(screen.getByText("選択中のモデルを使うために、APIキーを設定してください。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "APIキーを設定" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: "モデル設定を開く" })).toHaveAttribute("href", "/llm-profiles");
    expect(composer).toHaveValue("本文を推敲して");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hides the main context indicator until usage is known", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          activeConversation: {
            createdAt: "2026-05-09T00:00:00.000Z",
            editProposals: [],
            id: "conv-unknown-context",
            lastOpenedAt: "2026-05-09T00:00:00.000Z",
            messages: [],
            title: "会話",
            updatedAt: "2026-05-09T00:00:00.000Z",
            workspaceId: "workspace",
          },
          conversations: [],
          errors: [],
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    await screen.findByText("小説づくりをチャットで進めましょう。");
    expect(screen.queryByLabelText("メインエージェントコンテキスト使用量")).not.toBeInTheDocument();
  });

  it("shows a warning on assistant messages that reached the output token limit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          activeConversation: {
            createdAt: "2026-05-09T00:00:00.000Z",
            editProposals: [],
            id: "conv-warning",
            lastOpenedAt: "2026-05-09T00:00:00.000Z",
            messages: [
              {
                content: "途中までの回答です",
                createdAt: "2026-05-09T00:01:00.000Z",
                finishReason: "length",
                id: "assistant-warning",
                role: "assistant",
                warnings: [
                  {
                    message: "出力上限に達したため応答が途中で止まった可能性があります。",
                    type: "output_limit",
                  },
                ],
              },
            ],
            title: "会話",
            updatedAt: "2026-05-09T00:01:00.000Z",
            workspaceId: "workspace",
          },
          conversations: [],
          errors: [],
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    expect(await screen.findByText("途中までの回答です")).toBeInTheDocument();
    expect(
      screen.getByText("出力上限に達したため応答が途中で止まった可能性があります。"),
    ).toBeInTheDocument();
  });

  it("sends the externally selected model on the next message", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: {
              createdAt: "2026-05-09T00:00:00.000Z",
              editProposals: [],
              id: "conv-model",
              lastOpenedAt: "2026-05-09T00:00:00.000Z",
              messages: [
                {
                  content: "モデル指定",
                  createdAt: "2026-05-09T00:01:00.000Z",
                  id: "msg-1",
                  role: "user",
                },
              ],
              title: "モデル指定",
              updatedAt: "2026-05-09T00:01:00.000Z",
              workspaceId: "workspace",
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );

    render(
      <TestChatPane
        modelSelection={{ modelId: "gpt-5.4-mini", providerId: "openai" }}
        workspaceRoot="/tmp/workspace"
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("書きたいこと、相談したいことを入力"), {
      target: { value: "モデル指定" },
    });
    const sendButton = screen.getByRole("button", { name: "送信" });
    await waitFor(() => {
      expect(sendButton).not.toBeDisabled();
    });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/chat/messages", {
        body: JSON.stringify({
          autoCompactEnabled: true,
          autoCompactThresholdRatio: 0.7,
          content: "モデル指定",
          conversationId: undefined,
          modelSelection: {
            modelId: "gpt-5.4-mini",
            providerId: "openai",
          },
          workspaceRoot: "/tmp/workspace",
        }),
        headers: { accept: "application/x-ndjson", "content-type": "application/json" },
        method: "POST",
      });
    });
  });

  it("sends the configured conversation mode with chat messages", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            activeConversation: {
              createdAt: "2026-05-09T00:00:00.000Z",
              editProposals: [],
              id: "conv-mode",
              lastOpenedAt: "2026-05-09T00:00:00.000Z",
              messages: [],
              title: "会話",
              updatedAt: "2026-05-09T00:00:00.000Z",
              workspaceId: "workspace",
            },
            conversations: [],
            errors: [],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          `${JSON.stringify({
            conversation: {
              createdAt: "2026-05-09T00:00:00.000Z",
              editProposals: [],
              id: "conv-mode",
              lastOpenedAt: "2026-05-09T00:00:00.000Z",
              messages: [],
              title: "会話",
              updatedAt: "2026-05-09T00:00:00.000Z",
              workspaceId: "workspace",
            },
            type: "conversation",
          })}\n`,
          { headers: { "content-type": "application/x-ndjson" }, status: 200 },
        ),
      );

    render(
      <TestChatPane
        mode="chat"
        modelSelection={{ modelId: "deepseek-v4-pro", providerId: "deepseek" }}
        workspaceRoot="/tmp/workspace"
      />,
    );

    fireEvent.change(await screen.findByPlaceholderText("書きたいこと、相談したいことを入力"), {
      target: { value: "続きを書いて" },
    });
    const sendButton = screen.getByRole("button", { name: "送信" });
    await waitFor(() => {
      expect(sendButton).not.toBeDisabled();
    });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
        content: "続きを書いて",
        conversationId: "conv-mode",
        mode: "chat",
        workspaceRoot: "/tmp/workspace",
      });
    });
  });

  it("runs /compact as a conversation command without sending a chat message", async () => {
    const compactedConversation = {
      conversationCompactions: [
        {
          compactedThroughCreatedAt: "2026-05-09T00:02:00.000Z",
          compactedThroughMessageId: "assistant-1",
          createdAt: "2026-05-09T00:03:00.000Z",
          id: "checkpoint-1",
          sourceMessageIds: ["user-1", "assistant-1"],
          summary: "ここまでの会話を要約しました。",
        },
      ],
      createdAt: "2026-05-09T00:00:00.000Z",
      editProposals: [],
      id: "conv-compact",
      lastOpenedAt: "2026-05-09T00:00:00.000Z",
      messages: [
        {
          content: "書き出しを相談",
          createdAt: "2026-05-09T00:01:00.000Z",
          id: "user-1",
          role: "user",
        },
        {
          content: "方向性を整理しました。",
          createdAt: "2026-05-09T00:02:00.000Z",
          id: "assistant-1",
          role: "assistant",
        },
      ],
      title: "書き出しを相談",
      updatedAt: "2026-05-09T00:03:00.000Z",
      workspaceId: "workspace",
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            activeConversation: {
              ...compactedConversation,
              conversationCompactions: [],
              updatedAt: "2026-05-09T00:02:00.000Z",
            },
            conversations: [],
            errors: [],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: compactedConversation,
            status: "compacted",
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    fireEvent.change(await screen.findByPlaceholderText("書きたいこと、相談したいことを入力"), {
      target: { value: " /compact " },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    expect(await screen.findByText("ここまでの会話を圧縮しました。")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/conversations", {
      body: JSON.stringify({
        action: "compactConversation",
        conversationId: "conv-compact",
        workspaceRoot: "/tmp/workspace",
      }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    expect(fetchMock.mock.calls.some(([input]) => input === "/api/chat/messages")).toBe(false);
  });

  it("shows and filters the slash command palette above the composer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    const input = await screen.findByPlaceholderText("書きたいこと、相談したいことを入力");
    fireEvent.change(input, { target: { value: "/" } });

    const palette = screen.getByRole("listbox", { name: "スラッシュコマンド" });
    const option = screen.getByRole("option", { name: /\/compact/ });
    expect(palette.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(option).toHaveTextContent("/compact");
    expect(option).toHaveTextContent("/圧縮");
    expect(option).toHaveTextContent("ここまでの会話を圧縮します");

    fireEvent.change(input, { target: { value: "/圧" } });
    expect(screen.getByRole("option", { name: /\/compact/ })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "/unknown" } });
    expect(screen.queryByRole("listbox", { name: "スラッシュコマンド" })).not.toBeInTheDocument();
  });

  it("selects slash commands by keyboard without executing them and dismisses with Escape", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    const input = await screen.findByPlaceholderText("書きたいこと、相談したいことを入力");
    fireEvent.change(input, { target: { value: "/" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /\/compact/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("/compact");
    expect(input).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { value: "/" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "スラッシュコマンド" })).not.toBeInTheDocument();
  });

  it("selects a slash command with the pointer without executing it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    const input = await screen.findByPlaceholderText("書きたいこと、相談したいことを入力");
    fireEvent.change(input, { target: { value: "/" } });
    fireEvent.click(screen.getByRole("option", { name: /\/compact/ }));

    expect(input).toHaveValue("/compact");
    expect(input).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows compaction progress while /compact is running", async () => {
    let resolveCompaction: ((response: Response) => void) | undefined;
    const conversation = {
      createdAt: "2026-05-09T00:00:00.000Z",
      editProposals: [],
      id: "conv-running-compact",
      lastOpenedAt: "2026-05-09T00:00:00.000Z",
      messages: [
        {
          content: "相談",
          createdAt: "2026-05-09T00:01:00.000Z",
          id: "user-1",
          role: "user",
        },
      ],
      title: "相談",
      updatedAt: "2026-05-09T00:01:00.000Z",
      workspaceId: "workspace",
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            activeConversation: conversation,
            conversations: [],
            errors: [],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveCompaction = resolve;
        }),
      );

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    fireEvent.change(await screen.findByPlaceholderText("書きたいこと、相談したいことを入力"), {
      target: { value: "/compact" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    expect(await screen.findByRole("status", { name: "会話圧縮中" })).toHaveTextContent(
      "会話を圧縮中",
    );

    resolveCompaction?.(
      new Response(
        JSON.stringify({
          conversation,
          reason: "Not enough eligible messages to compact",
          status: "skipped",
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    expect(await screen.findByText("圧縮できる履歴がまだありません。")).toBeInTheDocument();
  });

  it("shows a skipped compaction message for /圧縮 without sending chat content", async () => {
    const conversation = {
      createdAt: "2026-05-09T00:00:00.000Z",
      editProposals: [],
      id: "conv-skip-compact",
      lastOpenedAt: "2026-05-09T00:00:00.000Z",
      messages: [],
      title: "空の会話",
      updatedAt: "2026-05-09T00:00:00.000Z",
      workspaceId: "workspace",
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            activeConversation: conversation,
            conversations: [],
            errors: [],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation,
            reason: "Not enough eligible messages to compact",
            status: "skipped",
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    fireEvent.change(await screen.findByPlaceholderText("書きたいこと、相談したいことを入力"), {
      target: { value: "/圧縮" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    expect(await screen.findByText("圧縮できる履歴がまだありません。")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => input === "/api/chat/messages")).toBe(false);
  });

  it("shows guidance when a slash command is unsupported", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            activeConversation: null,
            conversations: [],
            errors: [],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    fireEvent.change(await screen.findByPlaceholderText("書きたいこと、相談したいことを入力"), {
      target: { value: "/help" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    expect(await screen.findByText("未対応のスラッシュコマンドです。")).toBeInTheDocument();
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it("requires an active conversation before running /compact", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            activeConversation: null,
            conversations: [],
            errors: [],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    fireEvent.change(await screen.findByPlaceholderText("書きたいこと、相談したいことを入力"), {
      target: { value: "/compact" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    expect(await screen.findByText("圧縮する会話がまだありません。")).toBeInTheDocument();
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it("sends the current editor file path as chat metadata", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: {
              createdAt: "2026-05-09T00:00:00.000Z",
              editProposals: [],
              id: "conv-current-file",
              lastOpenedAt: "2026-05-09T00:00:00.000Z",
              messages: [],
              title: "Current file",
              updatedAt: "2026-05-09T00:01:00.000Z",
              workspaceId: "workspace",
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );

    render(
      <TestChatPane
        currentFilePath="小説/第001章/本文.txt"
        workspaceRoot="/tmp/workspace"
      />,
    );

    fireEvent.change(await screen.findByPlaceholderText("書きたいこと、相談したいことを入力"), {
      target: { value: "続きを書いて" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/chat/messages", {
        body: JSON.stringify({
          autoCompactEnabled: true,
          autoCompactThresholdRatio: 0.7,
          content: "続きを書いて",
          conversationId: undefined,
          currentFilePath: "小説/第001章/本文.txt",
          workspaceRoot: "/tmp/workspace",
        }),
        headers: { accept: "application/x-ndjson", "content-type": "application/json" },
        method: "POST",
      });
    });
  });

  it("lets the chat pane change the selected model and uses it on submit", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: {
              createdAt: "2026-05-09T00:00:00.000Z",
              editProposals: [],
              id: "conv-chat-model",
              lastOpenedAt: "2026-05-09T00:00:00.000Z",
              messages: [
                {
                  content: "モデルを変えて送信",
                  createdAt: "2026-05-09T00:01:00.000Z",
                  id: "msg-1",
                  role: "user",
                },
              ],
              title: "モデルを変えて送信",
              updatedAt: "2026-05-09T00:01:00.000Z",
              workspaceId: "workspace",
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );
    let selectedModel = { modelId: "deepseek-v4-pro", providerId: "deepseek" };
    const onModelSelectionChange = vi.fn((nextModel) => {
      selectedModel = nextModel;
    });
    const { rerender } = render(
      <TestChatPane
        llmProviders={[
          {
            displayName: "DeepSeek",
            id: "deepseek",
            models: [
              {
                available: true,
                displayName: "DeepSeek V4 Pro",
                id: "deepseek-v4-pro",
                supportsTools: true,
              },
            ],
          },
          {
            displayName: "OpenAI",
            id: "openai",
            models: [
              {
                available: true,
                displayName: "GPT 5.4 Mini",
                id: "gpt-5.4-mini",
                supportsTools: true,
              },
            ],
          },
          {
            displayName: "Gemini",
            id: "gemini",
            models: [
              {
                available: false,
                displayName: "Gemini 3.1 Flash Lite",
                id: "gemini-3.1-flash-lite",
                supportsTools: true,
                unavailableReason: "Gemini のAPIキーが未設定です。",
              },
            ],
          },
          {
            displayName: "Anthropic",
            id: "anthropic",
            models: [
              {
                available: true,
                displayName: "Claude Sonnet 4.6",
                id: "claude-sonnet-4-6",
                supportsTools: true,
              },
            ],
          },
        ]}
        modelSelection={selectedModel}
        onModelSelectionChange={onModelSelectionChange}
        workspaceRoot="/tmp/workspace"
      />,
    );

    const selector = await screen.findByLabelText("チャットLLMモデル");
    expect(selector).toHaveValue("deepseek:deepseek-v4-pro");
    expect(within(selector).getByRole("option", { name: "DeepSeek V4 Pro" })).toBeEnabled();
    expect(within(selector).getByRole("option", { name: "GPT 5.4 Mini" })).toBeEnabled();
    expect(within(selector).queryByRole("option", { name: "DeepSeek / DeepSeek V4 Pro" })).not.toBeInTheDocument();
    expect(within(selector).queryByRole("option", { name: "OpenAI / GPT 5.4 Mini" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Gemini 3.1 Flash Lite/ })).toBeDisabled();
    expect(screen.getByRole("option", { name: /Claude Sonnet 4.6/ })).toBeEnabled();
    expect(screen.queryByText("Gemini のAPIキーが未設定です。")).not.toBeInTheDocument();

    fireEvent.change(selector, { target: { value: "anthropic:claude-sonnet-4-6" } });
    expect(onModelSelectionChange).toHaveBeenCalledWith({
      modelId: "claude-sonnet-4-6",
      providerId: "anthropic",
    });

    rerender(
      <TestChatPane
        llmProviders={[]}
        modelSelection={selectedModel}
        onModelSelectionChange={onModelSelectionChange}
        workspaceRoot="/tmp/workspace"
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("書きたいこと、相談したいことを入力"), {
      target: { value: "モデルを変えて送信" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/chat/messages", {
        body: JSON.stringify({
          autoCompactEnabled: true,
          autoCompactThresholdRatio: 0.7,
          content: "モデルを変えて送信",
          conversationId: undefined,
          modelSelection: {
            modelId: "claude-sonnet-4-6",
            providerId: "anthropic",
          },
          workspaceRoot: "/tmp/workspace",
        }),
        headers: { accept: "application/x-ndjson", "content-type": "application/json" },
        method: "POST",
      });
    });
  });

  it("lets the user choose a user-defined profile even when provider models are available", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ activeConversation: null, conversations: [], errors: [] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: {
              createdAt: "2026-05-09T00:00:00.000Z",
              editProposals: [],
              id: "conv-profile",
              lastOpenedAt: "2026-05-09T00:00:00.000Z",
              messages: [
                {
                  content: "プロフィール指定",
                  createdAt: "2026-05-09T00:01:00.000Z",
                  id: "msg-1",
                  role: "user",
                },
              ],
              title: "プロフィール指定",
              updatedAt: "2026-05-09T00:01:00.000Z",
              workspaceId: "workspace",
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );
    const onModelSelectionChange = vi.fn();
    const onMainLlmProfileIdChange = vi.fn();
    const lmStudioProfile = {
      available: true,
      baseURL: "http://localhost:1234/v1",
      id: "user:lm-studio",
      maxOutputTokens: 4096,
      modelId: "gemma-3-12b-it",
      name: "LM Studio",
      providerId: "openai-compatible" as const,
      source: "user" as const,
      supportsToolsOverride: true,
      temperature: 0.3,
    };
    const roleAssignments = {
      main: { kind: "profile" as const, profileId: "user:lm-studio" },
      search: { kind: "profile" as const, profileId: "builtin:deepseek:search" },
      simple: { kind: "profile" as const, profileId: "builtin:deepseek:simple" },
      writing: { kind: "profile" as const, profileId: "builtin:deepseek:writing" },
    };

    render(
      <TestChatPane
        llmProviders={[
          {
            displayName: "OpenAI互換",
            id: "openai-compatible",
            models: [
              {
                available: false,
                displayName: "local-model",
                id: "local-model",
                supportsTools: false,
                unavailableReason: "このモデルはツール実行に対応していません。",
              },
            ],
          },
        ]}
        llmProfiles={[lmStudioProfile]}
        llmProfileRoleAssignments={roleAssignments}
        modelSelection={{ modelId: "deepseek-v4-pro", providerId: "deepseek" }}
        onMainLlmProfileIdChange={onMainLlmProfileIdChange}
        onModelSelectionChange={onModelSelectionChange}
        workspaceRoot="/tmp/workspace"
      />,
    );

    const selector = await screen.findByLabelText("チャットLLMモデル");
    expect(selector).toHaveValue("profile:user:lm-studio");
    expect(within(selector).getByRole("option", { name: /LM Studio/ })).toBeEnabled();

    fireEvent.change(selector, { target: { value: "profile:user:lm-studio" } });
    expect(onMainLlmProfileIdChange).toHaveBeenCalledWith("user:lm-studio");
    expect(onModelSelectionChange).toHaveBeenCalledWith(null);

    fireEvent.change(screen.getByPlaceholderText("書きたいこと、相談したいことを入力"), {
      target: { value: "プロフィール指定" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/chat/messages", {
        body: JSON.stringify({
          autoCompactEnabled: true,
          autoCompactThresholdRatio: 0.7,
          content: "プロフィール指定",
          conversationId: undefined,
          llmProfileId: "user:lm-studio",
          userProfiles: [lmStudioProfile],
          workspaceRoot: "/tmp/workspace",
        }),
        headers: { accept: "application/x-ndjson", "content-type": "application/json" },
        method: "POST",
      });
    });
  });

  it("submits the composer with the existing command-enter keyboard shortcut", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: {
              createdAt: "2026-05-09T00:00:00.000Z",
              editProposals: [],
              id: "conv-keyboard",
              lastOpenedAt: "2026-05-09T00:00:00.000Z",
              messages: [
                {
                  content: "キーボード送信",
                  createdAt: "2026-05-09T00:01:00.000Z",
                  id: "msg-1",
                  role: "user",
                },
              ],
              title: "キーボード送信",
              updatedAt: "2026-05-09T00:01:00.000Z",
              workspaceId: "workspace",
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );

    render(
      <TestChatPane
        modelSelection={{ modelId: "deepseek-v4-pro", providerId: "deepseek" }}
        workspaceRoot="/tmp/workspace"
      />,
    );

    const input = await screen.findByPlaceholderText("書きたいこと、相談したいことを入力");
    fireEvent.change(input, { target: { value: "キーボード送信" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/chat/messages", {
        body: JSON.stringify({
          autoCompactEnabled: true,
          autoCompactThresholdRatio: 0.7,
          content: "キーボード送信",
          conversationId: undefined,
          modelSelection: {
            modelId: "deepseek-v4-pro",
            providerId: "deepseek",
          },
          workspaceRoot: "/tmp/workspace",
        }),
        headers: { accept: "application/x-ndjson", "content-type": "application/json" },
        method: "POST",
      });
    });
  });

  it.each([
    { expectedMode: undefined, name: "editor mode" },
    { expectedMode: "chat" as const, name: "chat mode" },
  ])("submits the composer with enter in $name", async ({ expectedMode }) => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: {
              createdAt: "2026-05-09T00:00:00.000Z",
              editProposals: [],
              id: "conv-enter",
              lastOpenedAt: "2026-05-09T00:00:00.000Z",
              messages: [
                {
                  content: "Enterで送信",
                  createdAt: "2026-05-09T00:01:00.000Z",
                  id: "msg-1",
                  role: "user",
                },
              ],
              title: "Enterで送信",
              updatedAt: "2026-05-09T00:01:00.000Z",
              workspaceId: "workspace",
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );

    render(
      <TestChatPane
        mode={expectedMode}
        modelSelection={{ modelId: "deepseek-v4-pro", providerId: "deepseek" }}
        workspaceRoot="/tmp/workspace"
      />,
    );

    const input = await screen.findByPlaceholderText("書きたいこと、相談したいことを入力");
    fireEvent.change(input, { target: { value: "Enterで送信" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/chat/messages", {
        body: JSON.stringify({
          autoCompactEnabled: true,
          autoCompactThresholdRatio: 0.7,
          content: "Enterで送信",
          conversationId: undefined,
          ...(expectedMode ? { mode: expectedMode } : {}),
          modelSelection: {
            modelId: "deepseek-v4-pro",
            providerId: "deepseek",
          },
          workspaceRoot: "/tmp/workspace",
        }),
        headers: { accept: "application/x-ndjson", "content-type": "application/json" },
        method: "POST",
      });
    });
  });

  it("keeps shift-enter as a composer newline input instead of submitting", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );

    render(
      <TestChatPane
        modelSelection={{ modelId: "deepseek-v4-pro", providerId: "deepseek" }}
        workspaceRoot="/tmp/workspace"
      />,
    );

    const input = await screen.findByPlaceholderText("書きたいこと、相談したいことを入力");
    fireEvent.change(input, { target: { value: "1行目" } });
    const defaultWasNotPrevented = fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(defaultWasNotPrevented).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not submit enter while IME composition is active", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );

    render(
      <TestChatPane
        modelSelection={{ modelId: "deepseek-v4-pro", providerId: "deepseek" }}
        workspaceRoot="/tmp/workspace"
      />,
    );

    const input = await screen.findByPlaceholderText("書きたいこと、相談したいことを入力");
    fireEvent.change(input, { target: { value: "変換中" } });
    const defaultWasNotPrevented = fireEvent.keyDown(input, { isComposing: true, key: "Enter" });

    expect(defaultWasNotPrevented).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not submit enter when Safari reports IME composition as keyCode 229", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );

    render(
      <TestChatPane
        modelSelection={{ modelId: "deepseek-v4-pro", providerId: "deepseek" }}
        workspaceRoot="/tmp/workspace"
      />,
    );

    const input = await screen.findByPlaceholderText("書きたいこと、相談したいことを入力");
    fireEvent.change(input, { target: { value: "変換中" } });
    const defaultWasNotPrevented = fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });

    expect(defaultWasNotPrevented).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("inserts dropped editor text into the composer without submitting", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    const input = await screen.findByPlaceholderText("書きたいこと、相談したいことを入力") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "このコードを説明:\n" } });
    input.setSelectionRange("このコードを説明:\n".length, "このコードを説明:\n".length);

    fireEvent.drop(input, {
      dataTransfer: {
        getData: (type: string) => (type === "text/plain" ? "const value = 1;\nconsole.log(value);" : ""),
      },
    });

    expect(input).toHaveValue("このコードを説明:\nconst value = 1;\nconsole.log(value);");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("attaches OS text files in chat mode without inserting a local file URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    render(<TestChatPane mode="chat" workspaceRoot="/tmp/workspace" />);
    const input = await screen.findByPlaceholderText("書きたいこと、相談したいことを入力");
    const droppedFile = new File(["本文"], "memo.txt", { type: "text/plain" });
    Object.defineProperty(droppedFile, "arrayBuffer", {
      value: async () => new TextEncoder().encode("本文").buffer,
    });

    fireEvent.drop(input, {
      dataTransfer: {
        files: [droppedFile],
        getData: () => "file:///Users/example/memo.txt",
      },
    });

    expect(input).toHaveValue("");
    expect(await screen.findByText("memo.txt")).toBeInTheDocument();
    expect(screen.getByText("6 B")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "memo.txt を添付から削除" }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("removes a dropped attachment before sending", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    render(<TestChatPane mode="chat" workspaceRoot="/tmp/workspace" />);
    const input = await screen.findByPlaceholderText("書きたいこと、相談したいことを入力");
    const droppedFile = new File(["memo"], "memo.txt");
    Object.defineProperty(droppedFile, "arrayBuffer", {
      value: async () => new TextEncoder().encode("memo").buffer,
    });

    fireEvent.drop(input, {
      dataTransfer: { files: [droppedFile], getData: () => "" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "memo.txt を添付から削除" }),
    );

    expect(screen.queryByText("memo.txt")).not.toBeInTheDocument();
  });

  it("sends dropped files as canonical Base64 with a chat message", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          conversation: {
            agentRuntime: "vercel-ai",
            codexTurnState: { phase: "idle" },
            createdAt: "2026-05-09T00:00:00.000Z",
            editProposals: [],
            id: "conv-drop",
            lastOpenedAt: "2026-05-09T00:00:00.000Z",
            messages: [],
            title: "配置して",
            updatedAt: "2026-05-09T00:00:00.000Z",
            workspaceId: "workspace",
          },
        }),
      );
    render(
      <TestChatPane
        mode="chat"
        modelSelection={{ modelId: "deepseek-v4-pro", providerId: "deepseek" }}
        workspaceRoot="/tmp/workspace"
      />,
    );
    const input = await screen.findByPlaceholderText("書きたいこと、相談したいことを入力");
    const droppedFile = new File(["本文\r\n二行目"], "memo.txt");
    Object.defineProperty(droppedFile, "arrayBuffer", {
      value: async () => new TextEncoder().encode("本文\r\n二行目").buffer,
    });
    fireEvent.drop(input, {
      dataTransfer: { files: [droppedFile], getData: () => "" },
    });
    fireEvent.change(input, { target: { value: "適切な場所へ配置して" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([url]) => url === "/api/chat/messages");
      expect(post).toBeDefined();
      const body = JSON.parse(String(post?.[1]?.body));
      expect(body).toMatchObject({
        content: "適切な場所へ配置して",
        droppedTextFiles: [
          {
            contentBase64: Buffer.from("本文\r\n二行目").toString("base64"),
            name: "memo.txt",
          },
        ],
        mode: "chat",
        workspaceRoot: "/tmp/workspace",
      });
    });
  });

  it("shows a placement result for each dropped text file after sending", async () => {
    const conversation = {
      agentRuntime: "vercel-ai",
      codexTurnState: { phase: "idle" },
      createdAt: "2026-07-23T00:00:00.000Z",
      editProposals: [],
      id: "conv-drop-results",
      lastOpenedAt: "2026-07-23T00:00:00.000Z",
      messages: [],
      title: "配置して",
      updatedAt: "2026-07-23T00:00:00.000Z",
      workspaceId: "workspace",
    };
    const stream = [
      {
        file: { index: 0, name: "placed.txt", sizeBytes: 6, status: "pending" },
        type: "dropped-text-file-status",
      },
      {
        file: {
          index: 0,
          name: "placed.txt",
          sizeBytes: 6,
          status: "placed",
          targetPath: "資料/placed.txt",
        },
        type: "dropped-text-file-status",
      },
      {
        file: { index: 1, name: "unplaced.txt", sizeBytes: 6, status: "unplaced" },
        type: "dropped-text-file-status",
      },
      { conversation, type: "conversation" },
    ];
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ activeConversation: null, conversations: [], errors: [] }),
      )
      .mockResolvedValueOnce(
        new Response(stream.map((line) => JSON.stringify(line)).join("\n"), {
          headers: { "content-type": "application/x-ndjson" },
        }),
      );
    render(
      <TestChatPane
        mode="chat"
        modelSelection={{ modelId: "deepseek-v4-pro", providerId: "deepseek" }}
        workspaceRoot="/tmp/workspace"
      />,
    );
    const input = await screen.findByPlaceholderText("書きたいこと、相談したいことを入力");
    const placedFile = new File(["placed"], "placed.txt");
    const unplacedFile = new File(["unused"], "unplaced.txt");
    Object.defineProperty(placedFile, "arrayBuffer", {
      value: async () => new TextEncoder().encode("placed").buffer,
    });
    Object.defineProperty(unplacedFile, "arrayBuffer", {
      value: async () => new TextEncoder().encode("unused").buffer,
    });
    fireEvent.drop(input, {
      dataTransfer: { files: [placedFile, unplacedFile], getData: () => "" },
    });
    fireEvent.change(input, { target: { value: "配置して" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    const results = await screen.findByLabelText("添付ファイルの処理結果");
    expect(within(results).getByText("placed.txt")).toBeInTheDocument();
    expect(within(results).getByText("配置済み: 資料/placed.txt")).toBeInTheDocument();
    expect(within(results).getByText("unplaced.txt")).toBeInTheDocument();
    expect(within(results).getByText("未配置")).toBeInTheDocument();
  });

  it("appends selected editor text requests to the composer without submitting", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );

    const { rerender } = render(
      <TestChatPane
        appendedTextRequest={{ id: 1, text: "const value = 1;" }}
        workspaceRoot="/tmp/workspace"
      />,
    );

    const input = await screen.findByPlaceholderText("書きたいこと、相談したいことを入力");
    expect(input).toHaveValue("const value = 1;");

    rerender(
      <TestChatPane
        appendedTextRequest={{ id: 2, text: "console.log(value);" }}
        workspaceRoot="/tmp/workspace"
      />,
    );

    expect(input).toHaveValue("const value = 1;\nconsole.log(value);");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not append the same editor selection again when a session's view remounts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({
      activeConversation: null, conversations: [], errors: [],
    }));
    function Session({ visible }: { visible: boolean }) {
      const controller = useChatConversationController({ workspaceRoot: "/tmp/workspace" });
      return visible ? <ChatPane controller={controller} fileContext={{
        workspaceRoot: "/tmp/workspace",
        appendedTextRequest: { id: 1, text: "選択した文章" },
      }} /> : null;
    }
    const { rerender } = render(<Session visible />);
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("選択した文章"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "書き直した質問" } });
    rerender(<Session visible={false} />);
    rerender(<Session visible />);
    expect(screen.getByRole("textbox")).toHaveValue("書き直した質問");
  });

  it("renders streamed tool activity while the agent is still responding", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `${JSON.stringify({
              activity: {
                detail: "実行中",
                label: "Grep runAgentLoop",
                status: "running",
                toolCallId: "grep-1",
                toolName: "Grep",
              },
              type: "tool-activity",
            })}\n`,
          ),
        );
        controller.enqueue(
          new TextEncoder().encode(
            `${JSON.stringify({
              activity: {
                detail: "3件",
                label: "Grep runAgentLoop",
                status: "completed",
                toolCallId: "grep-1",
                toolName: "Grep",
              },
              type: "tool-activity",
            })}\n${JSON.stringify({
              conversation: {
                createdAt: "2026-05-09T00:00:00.000Z",
                editProposals: [],
                id: "conv-4",
                lastOpenedAt: "2026-05-09T00:00:00.000Z",
                messages: [
                  {
                    content: "検索して",
                    createdAt: "2026-05-09T00:01:00.000Z",
                    id: "msg-1",
                    role: "user",
                  },
                  {
                    content: "検索しました。",
                    createdAt: "2026-05-09T00:01:01.000Z",
                    id: "msg-2",
                    role: "assistant",
                  },
                ],
                title: "検索して",
                toolActivities: [
                  {
                    createdAt: "2026-05-09T00:01:00.000Z",
                    detail: "3件",
                    id: "activity-1",
                    label: "Grep runAgentLoop",
                    status: "completed",
                    toolCallId: "grep-1",
                    toolName: "Grep",
                  },
                ],
                updatedAt: "2026-05-09T00:01:01.000Z",
                workspaceId: "workspace",
              },
              type: "conversation",
            })}\n`,
          ),
        );
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(stream, {
          headers: { "content-type": "application/x-ndjson" },
          status: 200,
        }),
      );

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    fireEvent.change(await screen.findByPlaceholderText("書きたいこと、相談したいことを入力"), {
      target: { value: "検索して" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    expect(await screen.findByRole("button", { name: /ツール履歴 1件/ })).toHaveTextContent("Grep");
    expect(await screen.findByText("検索しました。")).toBeInTheDocument();
    expect(screen.queryByLabelText("Grep 完了")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("ツールの進行状況")).not.toBeInTheDocument();
  });

  it("shows waiting status, streams bounded reasoning separately, and clears it on completion", async () => {
    let reasoningController: ReadableStreamDefaultController<Uint8Array>;
    let finishStream: (() => void) | undefined;
    const stream = new ReadableStream({
      start(controller) {
        reasoningController = controller;
        finishStream = () => {
          controller.enqueue(
            new TextEncoder().encode(
              `${JSON.stringify({
                conversation: {
                  createdAt: "2026-05-09T00:00:00.000Z",
                  editProposals: [],
                  id: "conv-running",
                  lastOpenedAt: "2026-05-09T00:00:00.000Z",
                  messages: [
                    {
                      content: "待機表示",
                      createdAt: "2026-05-09T00:01:00.000Z",
                      id: "msg-1",
                      role: "user",
                    },
                    {
                      content: "完了しました。",
                      createdAt: "2026-05-09T00:01:01.000Z",
                      id: "msg-2",
                      role: "assistant",
                    },
                  ],
                  title: "待機表示",
                  toolActivities: [],
                  updatedAt: "2026-05-09T00:01:01.000Z",
                  workspaceId: "workspace",
                },
                type: "conversation",
              })}\n`,
            ),
          );
          controller.close();
        };
      },
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(stream, {
          headers: { "content-type": "application/x-ndjson" },
          status: 200,
        }),
      );

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    fireEvent.change(await screen.findByPlaceholderText("書きたいこと、相談したいことを入力"), {
      target: { value: "待機表示" },
    });
    const sendButton = screen.getByRole("button", { name: "送信" });
    await waitFor(() => {
      expect(sendButton).not.toBeDisabled();
    });
    fireEvent.click(sendButton);

    const runningStatus = await screen.findByRole("status", { name: "AI応答生成中" });
    expect(runningStatus).toHaveTextContent("AIが応答を生成中");
    expect(runningStatus.querySelector("svg")).not.toBeNull();

    reasoningController!.enqueue(new TextEncoder().encode(JSON.stringify({ type: "reasoning-delta", text: null }) + "\n"));
    reasoningController!.enqueue(new TextEncoder().encode(JSON.stringify({ type: "reasoning-delta", text: "章のつながりを" }) + "\n"));
    expect(await screen.findByText("章のつながりを", { exact: true })).toBeInTheDocument();
    reasoningController!.enqueue(new TextEncoder().encode(JSON.stringify({ type: "reasoning-delta", text: "確認しています" }) + "\n"));
    expect(await screen.findByText("章のつながりを確認しています", { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "推論の途中経過" }));
    expect(screen.getByRole("button", { name: "推論の途中経過" })).toHaveAttribute("aria-expanded", "true");
    reasoningController!.enqueue(new TextEncoder().encode(JSON.stringify({ type: "reasoning-delta", text: "長".repeat(12_500) + "末尾" }) + "\n"));
    await waitFor(() => expect(screen.getByRole("region", { name: "推論の詳細" }).textContent).toHaveLength(12_000));
    expect(screen.getByRole("region", { name: "推論の詳細" }).textContent).toMatch(/末尾$/);
    expect(screen.queryByText("章のつながりを確認しています", { exact: true })).not.toBeInTheDocument();

    finishStream?.();

    await waitFor(() => expect(screen.queryByRole("button", { name: "推論の途中経過" })).not.toBeInTheDocument());
    expect(await screen.findByText("完了しました。")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("status", { name: "AI応答生成中" })).not.toBeInTheDocument();
    });
  });

  it("adds transient completion feedback only when a streamed tool changes from running to completed", async () => {
    let publishCompleted: (() => void) | undefined;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `${JSON.stringify({
              activity: {
                detail: "実行中",
                label: "Grep runAgentLoop",
                status: "running",
                toolCallId: "grep-1",
                toolName: "Grep",
              },
              type: "tool-activity",
            })}\n`,
          ),
        );
        publishCompleted = () => {
          controller.enqueue(
            new TextEncoder().encode(
              `${JSON.stringify({
                activity: {
                  detail: "2件",
                  label: "Grep runAgentLoop",
                  status: "completed",
                  toolCallId: "grep-1",
                  toolName: "Grep",
                },
                type: "tool-activity",
              })}\n`,
            ),
          );
        };
      },
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ activeConversation: null, conversations: [], errors: [] }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(stream, {
          headers: { "content-type": "application/x-ndjson" },
          status: 200,
        }),
      );

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    fireEvent.change(await screen.findByPlaceholderText("書きたいこと、相談したいことを入力"), {
      target: { value: "検索して" },
    });
    const sendButton = screen.getByRole("button", { name: "送信" });
    await waitFor(() => {
      expect(sendButton).not.toBeDisabled();
    });
    fireEvent.click(sendButton);

    const runningSummary = await screen.findByRole("button", { name: /ツール履歴 1件/ });
    expect(runningSummary).toHaveTextContent("実行中");
    fireEvent.click(runningSummary);
    const runningStatus = await screen.findByLabelText("Grep 実行中");
    expect(runningStatus.closest(".tool-activity")).not.toHaveClass("has-completion-feedback");

    publishCompleted?.();

    const completedStatus = await screen.findByLabelText("Grep 完了");
    expect(screen.getByRole("button", { name: /ツール履歴 1件/ })).toHaveTextContent("完了");
    expect(completedStatus.closest(".tool-activity")).toHaveClass("has-completion-feedback");
    await waitFor(
      () => {
        expect(completedStatus.closest(".tool-activity")).not.toHaveClass("has-completion-feedback");
      },
      { timeout: 2200 },
    );
  });

  it("renders persisted tool activity inside the assistant message it belongs to", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          activeConversation: {
            createdAt: "2026-05-09T00:00:00.000Z",
            editProposals: [],
            id: "conv-activity",
            lastOpenedAt: "2026-05-09T00:00:00.000Z",
            messages: [
              {
                content: "最初の質問",
                createdAt: "2026-05-09T00:01:00.000Z",
                id: "user-1",
                role: "user",
              },
              {
                content: "最初の回答",
                createdAt: "2026-05-09T00:01:01.000Z",
                id: "assistant-1",
                role: "assistant",
              },
              {
                content: "次の質問",
                createdAt: "2026-05-09T00:02:00.000Z",
                id: "user-2",
                role: "user",
              },
              {
                content: "次の回答",
                createdAt: "2026-05-09T00:02:01.000Z",
                id: "assistant-2",
                role: "assistant",
              },
            ],
            title: "会話",
            toolActivities: [
              {
                assistantMessageId: "assistant-1",
                createdAt: "2026-05-09T00:01:00.500Z",
                detail: "1件",
                id: "activity-1",
                label: "Read README.md",
                status: "completed",
                toolCallId: "read-1",
                toolName: "Read",
              },
              {
                assistantMessageId: "assistant-2",
                createdAt: "2026-05-09T00:02:00.500Z",
                detail: "2件",
                id: "activity-2",
                label: "Grep runAgentLoop",
                status: "completed",
                toolCallId: "grep-1",
                toolName: "Grep",
              },
            ],
            updatedAt: "2026-05-09T00:02:01.000Z",
            workspaceId: "workspace",
          },
          conversations: [],
          errors: [],
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    const firstAssistant = await screen.findByText("最初の回答");
    const secondAssistant = screen.getByText("次の回答");
    expect(firstAssistant.closest("article")).toHaveTextContent("ツール履歴 1件");
    expect(firstAssistant.closest("article")).toHaveTextContent("Read");
    expect(firstAssistant.closest("article")).not.toHaveTextContent("Read README.md");
    expect(firstAssistant.closest("article")).not.toHaveTextContent("Grep runAgentLoop");
    expect(secondAssistant.closest("article")).toHaveTextContent("Grep");
    expect(screen.queryByLabelText("ツールの進行状況")).not.toBeInTheDocument();
  });

  it("renders edit proposals inside the assistant message they belong to", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          activeConversation: {
            createdAt: "2026-05-09T00:00:00.000Z",
            editProposals: [
              {
                assistantMessageId: "assistant-1",
                createdAt: "2026-05-09T00:00:00.000Z",
                diff: "--- docs/new.md\n+++ docs/new.md\n@@\n+# New",
                id: "proposal-1",
                newText: "# New\n",
                oldText: "",
                operation: "create",
                path: "docs/new.md",
                status: "pending",
                title: "Create docs/new.md",
                updatedAt: "2026-05-09T00:00:00.000Z",
              },
            ],
            id: "conv-proposals",
            lastOpenedAt: "2026-05-09T00:00:00.000Z",
            messages: [
              {
                content: "作って",
                createdAt: "2026-05-09T00:01:00.000Z",
                id: "user-1",
                role: "user",
              },
              {
                content: "作成案です。",
                createdAt: "2026-05-09T00:01:01.000Z",
                id: "assistant-1",
                role: "assistant",
              },
            ],
            title: "会話",
            toolActivities: [],
            updatedAt: "2026-05-09T00:01:01.000Z",
            workspaceId: "workspace",
          },
          conversations: [],
          errors: [],
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    const assistantMessage = (await screen.findByText("作成案です。")).closest(".assistant-message");
    expect(assistantMessage).not.toBeNull();
    expect(assistantMessage).toHaveTextContent("Create docs/new.md");
    expect(assistantMessage).toHaveTextContent("docs/new.md");
    expect(assistantMessage).not.toHaveTextContent("+++ docs/new.md");
    expect(assistantMessage?.querySelector(".diff-token-insert")).toHaveTextContent("# New");
    expect(screen.queryByRole("button", { name: "docs/new.md を開く" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("編集案")).not.toBeInTheDocument();
  });

  it("keeps tool activity and edit proposal diffs outside Markdown rendering", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          activeConversation: {
            createdAt: "2026-05-09T00:00:00.000Z",
            editProposals: [
              {
                assistantMessageId: "assistant-1",
                createdAt: "2026-05-09T00:00:00.000Z",
                diff: "--- note.md\n+++ note.md\n@@\n-# Old\n+# New",
                id: "proposal-1",
                newText: "# New",
                oldText: "# Old",
                operation: "edit",
                path: "note.md",
                status: "pending",
                title: "Edit note.md",
                updatedAt: "2026-05-09T00:00:00.000Z",
              },
            ],
            id: "conv-markdown-boundary",
            lastOpenedAt: "2026-05-09T00:00:00.000Z",
            messages: [
              {
                content: "## Assistant body",
                createdAt: "2026-05-09T00:01:01.000Z",
                id: "assistant-1",
                role: "assistant",
              },
            ],
            title: "会話",
            toolActivities: [
              {
                assistantMessageId: "assistant-1",
                createdAt: "2026-05-09T00:01:00.500Z",
                detail: "`not code`",
                id: "activity-1",
                label: "Read # heading.md",
                status: "completed",
                toolCallId: "read-1",
                toolName: "Read",
              },
            ],
            updatedAt: "2026-05-09T00:01:01.000Z",
            workspaceId: "workspace",
          },
          conversations: [],
          errors: [],
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );

    render(<TestChatPane workspaceRoot="/tmp/workspace" />);

    const assistantMessage = (await screen.findByRole("heading", { level: 2, name: "Assistant body" })).closest(
      ".assistant-message",
    );
    expect(assistantMessage).not.toBeNull();
    fireEvent.click(within(assistantMessage as HTMLElement).getByRole("button", { name: /ツール履歴 1件/ }));
    expect(assistantMessage?.querySelector(".tool-activity h3")).toHaveTextContent("Read # heading.md");
    expect(assistantMessage?.querySelector(".tool-activity code")).toBeNull();
    const proposal = assistantMessage?.querySelector(".edit-proposal");
    expect(proposal).not.toBeNull();
    expect(proposal?.querySelector(".message-markdown")).toBeNull();
    expect(proposal?.querySelector("pre")).toBeNull();
    expect(proposal).toHaveTextContent("# Old");
    expect(proposal?.querySelector("h1")).toBeNull();
  });

  it("shows pending edit proposal diffs and sends apply requests one proposal at a time", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            activeConversation: {
              createdAt: "2026-05-09T00:00:00.000Z",
              editProposals: [
                {
                  createdAt: "2026-05-09T00:00:00.000Z",
                  diff: "--- note.txt\n+++ note.txt\n@@\n-old\n+new",
                  id: "proposal-1",
                  newText: "new",
                  oldText: "old",
                  path: "note.txt",
                  status: "pending",
                  title: "Edit note.txt",
                  updatedAt: "2026-05-09T00:00:00.000Z",
                },
                {
                  createdAt: "2026-05-09T00:00:00.000Z",
                  diff: "--- other.txt\n+++ other.txt\n@@\n-a\n+b",
                  id: "proposal-2",
                  newText: "b",
                  oldText: "a",
                  path: "other.txt",
                  status: "pending",
                  title: "Edit other.txt",
                  updatedAt: "2026-05-09T00:00:00.000Z",
                },
              ],
              id: "conv-1",
              lastOpenedAt: "2026-05-09T00:00:00.000Z",
              messages: [],
              title: "会話 1",
              updatedAt: "2026-05-09T00:00:00.000Z",
              workspaceId: "workspace",
            },
            conversations: [],
            errors: [],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: {
              createdAt: "2026-05-09T00:00:00.000Z",
              editProposals: [],
              id: "conv-1",
              lastOpenedAt: "2026-05-09T00:00:00.000Z",
              messages: [],
              title: "会話 1",
              updatedAt: "2026-05-09T00:00:00.000Z",
              workspaceId: "workspace",
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );

    render(
      <TestChatPane
        dirtyPaths={[]}
        onAppliedEdit={() => undefined}
        workspaceRoot="/tmp/workspace"
      />,
    );

    expect(await screen.findByText("Edit note.txt")).toBeInTheDocument();
    expect(screen.getByText("old")).toHaveClass("diff-token-delete");
    expect(screen.getByText("new")).toHaveClass("diff-token-insert");
    fireEvent.click(screen.getAllByRole("button", { name: "Apply" })[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/conversations", {
        body: JSON.stringify({
          action: "applyEditProposal",
          conversationId: "conv-1",
          dirtyPaths: [],
          proposalId: "proposal-1",
          workspaceRoot: "/tmp/workspace",
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
    });
  });

  it("sends apply requests for directory create proposals", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            activeConversation: {
              createdAt: "2026-05-09T00:00:00.000Z",
              editProposals: [
                {
                  createdAt: "2026-05-09T00:00:00.000Z",
                  diff: "--- /dev/null\n+++ docs/\n@@\n+directory: docs",
                  id: "proposal-1",
                  newText: "",
                  oldText: "",
                  operation: "createDirectory",
                  path: "docs",
                  status: "pending",
                  title: "Create directory docs",
                  updatedAt: "2026-05-09T00:00:00.000Z",
                },
              ],
              id: "conv-1",
              lastOpenedAt: "2026-05-09T00:00:00.000Z",
              messages: [],
              title: "会話 1",
              updatedAt: "2026-05-09T00:00:00.000Z",
              workspaceId: "workspace",
            },
            conversations: [],
            errors: [],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: {
              createdAt: "2026-05-09T00:00:00.000Z",
              editProposals: [
                {
                  createdAt: "2026-05-09T00:00:00.000Z",
                  diff: "--- /dev/null\n+++ docs/\n@@\n+directory: docs",
                  id: "proposal-1",
                  newText: "",
                  oldText: "",
                  operation: "createDirectory",
                  path: "docs",
                  status: "applied",
                  title: "Create directory docs",
                  updatedAt: "2026-05-09T00:00:01.000Z",
                },
              ],
              id: "conv-1",
              lastOpenedAt: "2026-05-09T00:00:00.000Z",
              messages: [],
              title: "会話 1",
              updatedAt: "2026-05-09T00:00:01.000Z",
              workspaceId: "workspace",
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );
    const onAppliedEdit = vi.fn();

    render(
      <TestChatPane
        dirtyPaths={[]}
        onAppliedEdit={onAppliedEdit}
        workspaceRoot="/tmp/workspace"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/conversations", {
        body: JSON.stringify({
          action: "applyEditProposal",
          conversationId: "conv-1",
          dirtyPaths: [],
          proposalId: "proposal-1",
          workspaceRoot: "/tmp/workspace",
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      expect(onAppliedEdit).toHaveBeenCalledWith({
        operation: "createDirectory",
        path: "docs",
      });
    });
  });

  it("sends apply requests when accepting an edit proposal", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            activeConversation: {
              createdAt: "2026-05-09T00:00:00.000Z",
              editProposals: [
                {
                  assistantMessageId: "assistant-1",
                  createdAt: "2026-05-09T00:00:00.000Z",
                  diff: "--- note.txt\n+++ note.txt\n@@\n-old\n+new",
                  id: "proposal-1",
                  newText: "new",
                  oldText: "old",
                  path: "note.txt",
                  status: "pending",
                  title: "Edit note.txt",
                  updatedAt: "2026-05-09T00:00:00.000Z",
                },
              ],
              id: "conv-1",
              lastOpenedAt: "2026-05-09T00:00:00.000Z",
              messages: [
                {
                  content: "編集案です。",
                  createdAt: "2026-05-09T00:00:00.000Z",
                  id: "assistant-1",
                  role: "assistant",
                },
              ],
              title: "会話 1",
              toolActivities: [],
              updatedAt: "2026-05-09T00:00:00.000Z",
              workspaceId: "workspace",
            },
            conversations: [],
            errors: [],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: {
              createdAt: "2026-05-09T00:00:00.000Z",
              editProposals: [
                {
                  assistantMessageId: "assistant-1",
                  createdAt: "2026-05-09T00:00:00.000Z",
                  diff: "--- note.txt\n+++ note.txt\n@@\n-old\n+new",
                  id: "proposal-1",
                  newText: "new",
                  oldText: "old",
                  path: "note.txt",
                  status: "applied",
                  title: "Edit note.txt",
                  updatedAt: "2026-05-09T00:00:01.000Z",
                },
              ],
              id: "conv-1",
              lastOpenedAt: "2026-05-09T00:00:00.000Z",
              messages: [
                {
                  content: "編集案です。",
                  createdAt: "2026-05-09T00:00:00.000Z",
                  id: "assistant-1",
                  role: "assistant",
                },
              ],
              title: "会話 1",
              toolActivities: [],
              updatedAt: "2026-05-09T00:00:01.000Z",
              workspaceId: "workspace",
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );

    render(<TestChatPane dirtyPaths={[]} workspaceRoot="/tmp/workspace" />);

    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/conversations", {
        body: JSON.stringify({
          action: "applyEditProposal",
          conversationId: "conv-1",
          dirtyPaths: [],
          proposalId: "proposal-1",
          workspaceRoot: "/tmp/workspace",
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      expect(screen.getByText("applied")).toBeInTheDocument();
    });
  });

  it("sends undo requests for the latest applied proposal", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            activeConversation: {
              createdAt: "2026-05-09T00:00:00.000Z",
              editProposals: [
                {
                  assistantMessageId: "assistant-1",
                  createdAt: "2026-05-09T00:00:00.000Z",
                  diff: "--- note.txt\n+++ note.txt\n@@\n-old\n+new",
                  id: "proposal-1",
                  newText: "new",
                  oldText: "old",
                  path: "note.txt",
                  status: "applied",
                  title: "Edit note.txt",
                  undoSnapshot: {
                    afterContent: "new",
                    beforeContent: "old",
                  },
                  updatedAt: "2026-05-09T00:00:00.000Z",
                },
              ],
              id: "conv-1",
              lastOpenedAt: "2026-05-09T00:00:00.000Z",
              messages: [
                {
                  content: "適用しました。",
                  createdAt: "2026-05-09T00:00:00.000Z",
                  id: "assistant-1",
                  role: "assistant",
                },
              ],
              title: "会話 1",
              toolActivities: [],
              updatedAt: "2026-05-09T00:00:00.000Z",
              workspaceId: "workspace",
            },
            conversations: [],
            errors: [],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation: {
              createdAt: "2026-05-09T00:00:00.000Z",
              editProposals: [
                {
                  assistantMessageId: "assistant-1",
                  createdAt: "2026-05-09T00:00:00.000Z",
                  diff: "--- note.txt\n+++ note.txt\n@@\n-old\n+new",
                  id: "proposal-1",
                  newText: "new",
                  oldText: "old",
                  path: "note.txt",
                  status: "undone",
                  title: "Edit note.txt",
                  undoSnapshot: {
                    afterContent: "new",
                    beforeContent: "old",
                  },
                  updatedAt: "2026-05-09T00:00:01.000Z",
                },
              ],
              id: "conv-1",
              lastOpenedAt: "2026-05-09T00:00:00.000Z",
              messages: [
                {
                  content: "適用しました。",
                  createdAt: "2026-05-09T00:00:00.000Z",
                  id: "assistant-1",
                  role: "assistant",
                },
              ],
              title: "会話 1",
              toolActivities: [],
              updatedAt: "2026-05-09T00:00:01.000Z",
              workspaceId: "workspace",
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );

    render(<TestChatPane mode="chat" workspaceRoot="/tmp/workspace" />);

    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/conversations", {
        body: JSON.stringify({
          action: "undoEditProposal",
          conversationId: "conv-1",
          proposalId: "proposal-1",
          workspaceRoot: "/tmp/workspace",
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      expect(screen.getByText("undone")).toBeInTheDocument();
    });
  });
});
