import { afterEach, describe, expect, it, vi } from "vitest";
import { resetApiTransportForTests } from "../../shared/client/apiTransport";
import { deleteConversation, sendChatMessage } from "./chatConversationClient";

afterEach(() => {
  resetApiTransportForTests();
  vi.unstubAllGlobals();
});

describe("deleteConversation", () => {
  it("deletes a conversation through the existing PATCH action", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          conversationId: "conversation-2",
        },
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deleteConversation("/workspace", "conversation-2"),
    ).resolves.toEqual({
      conversationId: "conversation-2",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/conversations",
      expect.objectContaining({
        body: JSON.stringify({
          action: "deleteConversation",
          conversationId: "conversation-2",
          workspaceRoot: "/workspace",
        }),
        method: "PATCH",
      }),
    );
  });

  it("does not expose an arbitrary server error when deletion fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { message: "raw stderr token-secret manuscript" },
          { status: 500 },
        ),
      ),
    );

    await expect(
      deleteConversation("/workspace", "conversation-2"),
    ).rejects.toThrow("会話の削除に失敗しました。");
    await expect(
      deleteConversation("/workspace", "conversation-2"),
    ).rejects.not.toThrow(/token-secret|manuscript/);
  });
});

describe("sendChatMessage dropped text file status events", () => {
  it("parses per-file placement outcomes from the NDJSON stream", async () => {
    const conversation = {
      agentRuntime: "vercel-ai",
      codexTurnState: { phase: "idle" },
      createdAt: "2026-07-23T00:00:00.000Z",
      editProposals: [],
      id: "conversation-drop",
      lastOpenedAt: "2026-07-23T00:00:00.000Z",
      messages: [],
      title: "配置",
      updatedAt: "2026-07-23T00:00:00.000Z",
      workspaceId: "workspace",
    };
    const lines = [
      {
        file: { index: 0, name: "memo.txt", sizeBytes: 6, status: "pending" },
        type: "dropped-text-file-status",
      },
      {
        file: {
          index: 0,
          name: "memo.txt",
          sizeBytes: 6,
          status: "placed",
          targetPath: "資料/memo.txt",
        },
        type: "dropped-text-file-status",
      },
      { conversation, type: "conversation" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(lines.map((line) => JSON.stringify(line)).join("\n"), {
          headers: { "content-type": "application/x-ndjson" },
        }),
      ),
    );
    const onDroppedTextFileStatus = vi.fn();

    await sendChatMessage(
      "/workspace",
      undefined,
      "配置して",
      null,
      null,
      undefined,
      [],
      { mode: "chat", onDroppedTextFileStatus },
    );

    expect(onDroppedTextFileStatus).toHaveBeenNthCalledWith(1, lines[0]!.file);
    expect(onDroppedTextFileStatus).toHaveBeenNthCalledWith(2, lines[1]!.file);
  });
});
