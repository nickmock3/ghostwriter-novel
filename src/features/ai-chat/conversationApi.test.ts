import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createConversationApiHandler, type CompactConversationHandler } from "./conversationApi";
import {
  createConversation,
  updateConversationCodexThreadId,
  updateConversationCodexTurnState,
  workspaceIdForRoot,
} from "./conversationHistory";
import { resolveWorkspaceRoot } from "../workspace/workspacePaths";
import { readDroppedTextFile, stageDroppedTextFiles } from "./droppedTextFiles";

function request(url: URL, init?: RequestInit) {
  return new Request(url, init);
}

describe("conversation API", () => {

  it("cleans only the deleted conversation's staged dropped text files", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const deletedConversation = await createConversation({ dataRoot, workspaceRoot });
    const retainedConversation = await createConversation({ dataRoot, workspaceRoot });
    const deletedFiles = await stageDroppedTextFiles({
      conversationId: deletedConversation.id,
      dataRoot,
      files: [{ contentBase64: "YQ==", name: "deleted.txt" }],
      workspaceRoot,
    });
    const retainedFiles = await stageDroppedTextFiles({
      conversationId: retainedConversation.id,
      dataRoot,
      files: [{ contentBase64: "Yg==", name: "retained.txt" }],
      workspaceRoot,
    });
    const handler = createConversationApiHandler({ dataRoot });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/conversations"), {
          body: JSON.stringify({
            action: "deleteConversation",
            conversationId: deletedConversation.id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }),
      );

      expect(response.status).toBe(200);
      await expect(
        readDroppedTextFile({
          context: deletedFiles.context,
          droppedFileId: deletedFiles.files[0]!.id,
        }),
      ).rejects.toThrow(/not found|利用できません/i);
      await expect(
        readDroppedTextFile({
          context: retainedFiles.context,
          droppedFileId: retainedFiles.files[0]!.id,
        }),
      ).resolves.toMatchObject({ content: "b" });
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("creates and lists workspace conversations", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const handler = createConversationApiHandler({ dataRoot });

    try {
      const createResponse = await handler(
        request(new URL("http://localhost/api/conversations"), {
          body: JSON.stringify({ workspaceRoot }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const created = await createResponse.json();

      const listUrl = new URL("http://localhost/api/conversations");
      listUrl.searchParams.set("workspaceRoot", workspaceRoot);
      const listResponse = await handler(request(listUrl));
      const listed = await listResponse.json();

      expect(createResponse.status).toBe(201);
      expect(listResponse.status).toBe(200);
      expect(listed.activeConversation.id).toBe(created.conversation.id);
      expect(listed.conversations).toHaveLength(1);
      expect(listed.errors).toEqual([]);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("persists the selected runtime when creating a conversation", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const handler = createConversationApiHandler({ dataRoot });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/conversations"), {
          body: JSON.stringify({ agentRuntime: "vercel-ai", workspaceRoot }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.conversation.agentRuntime).toBe("vercel-ai");
      expect(
        JSON.parse(
          readFileSync(
            path.join(
              dataRoot,
              "conversations",
              workspaceIdForRoot(await resolveWorkspaceRoot(workspaceRoot)),
              `${body.conversation.id}.json`,
            ),
            "utf8",
          ),
        ),
      ).toMatchObject({ agentRuntime: "vercel-ai" });
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("keeps corrupt files recoverable when listing conversations", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const handler = createConversationApiHandler({ dataRoot });

    try {
      const workspaceId = workspaceIdForRoot(await resolveWorkspaceRoot(workspaceRoot));
      mkdirSync(path.join(dataRoot, "conversations", workspaceId), { recursive: true });
      writeFileSync(
        path.join(dataRoot, "conversations", workspaceId, "broken.json"),
        "{not-json",
        "utf8",
      );

      const listUrl = new URL("http://localhost/api/conversations");
      listUrl.searchParams.set("workspaceRoot", workspaceRoot);
      const response = await handler(request(listUrl));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.conversations).toEqual([]);
      expect(body.errors).toEqual([
        { fileName: "broken.json", message: "Invalid conversation history file" },
      ]);
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("runs conversation compaction through a validated PATCH action", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const compactConversation: CompactConversationHandler = vi.fn(async ({ conversationId }) => ({
      conversation: {
        agentRuntime: "vercel-ai" as const,
        codexTurnState: { phase: "idle" as const },
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
        id: conversationId,
        lastOpenedAt: "2026-05-09T00:00:00.000Z",
        messages: [],
        plans: [],
        title: "会話",
        toolActivities: [],
        toolResultSummaries: [],
        updatedAt: "2026-05-09T00:03:00.000Z",
        workspaceId: "workspace",
      },
      status: "compacted" as const,
    }));
    const handler = createConversationApiHandler({ compactConversation, dataRoot });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/conversations"), {
          body: JSON.stringify({
            action: "compactConversation",
            conversationId: "conv-compact",
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe("compacted");
      expect(body.conversation.conversationCompactions).toHaveLength(1);
      expect(compactConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "conv-compact",
          dataRoot,
          workspaceRoot,
        }),
      );
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not expose the configured data root when storage is unavailable", async () => {
    const parent = mkdtempSync(path.join(tmpdir(), "ghostwriter-api-unavailable-"));
    const dataRoot = path.join(parent, "not-a-directory");
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    writeFileSync(dataRoot, "occupied", "utf8");
    const handler = createConversationApiHandler({ dataRoot });

    try {
      const response = await handler(
        request(new URL("http://localhost/api/conversations"), {
          body: JSON.stringify({ workspaceRoot }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({ message: "Application data storage is unavailable" });
      expect(JSON.stringify(body)).not.toContain(dataRoot);
    } finally {
      rmSync(parent, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("appends multiple edit proposals and applies one at a time", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const handler = createConversationApiHandler({ dataRoot });

    try {
      const filePath = path.join(workspaceRoot, "note.txt");
      writeFileSync(filePath, "alpha beta gamma", "utf8");

      const createResponse = await handler(
        request(new URL("http://localhost/api/conversations"), {
          body: JSON.stringify({ workspaceRoot }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      const created = await createResponse.json();

      for (const [oldText, newText] of [
        ["alpha", "ALPHA"],
        ["gamma", "GAMMA"],
      ]) {
        const appendResponse = await handler(
          request(new URL("http://localhost/api/conversations"), {
            body: JSON.stringify({
              action: "appendEditProposal",
              conversationId: created.conversation.id,
              newText,
              oldText,
              path: "note.txt",
              workspaceRoot,
            }),
            headers: { "content-type": "application/json" },
            method: "PATCH",
          }),
        );
        expect(appendResponse.status).toBe(200);
      }

      const listUrl = new URL("http://localhost/api/conversations");
      listUrl.searchParams.set("workspaceRoot", workspaceRoot);
      const listed = await (await handler(request(listUrl))).json();
      expect(listed.activeConversation.editProposals).toHaveLength(2);

      const applyResponse = await handler(
        request(new URL("http://localhost/api/conversations"), {
          body: JSON.stringify({
            action: "applyEditProposal",
            conversationId: created.conversation.id,
            dirtyPaths: [],
            proposalId: listed.activeConversation.editProposals[0].id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }),
      );
      const applied = await applyResponse.json();

      expect(applyResponse.status).toBe(200);
      expect(applied.conversation.editProposals.map((item: { status: string }) => item.status)).toEqual([
        "applied",
        "pending",
      ]);
      expect(readFileSync(filePath, "utf8")).toBe("ALPHA beta gamma");
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("marks an edit proposal as rejected", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const handler = createConversationApiHandler({ dataRoot });

    try {
      writeFileSync(path.join(workspaceRoot, "note.txt"), "old", "utf8");
      const created = await (
        await handler(
          request(new URL("http://localhost/api/conversations"), {
            body: JSON.stringify({ workspaceRoot }),
            headers: { "content-type": "application/json" },
            method: "POST",
          }),
        )
      ).json();
      const withProposal = await (
        await handler(
          request(new URL("http://localhost/api/conversations"), {
            body: JSON.stringify({
              action: "appendEditProposal",
              conversationId: created.conversation.id,
              newText: "new",
              oldText: "old",
              path: "note.txt",
              workspaceRoot,
            }),
            headers: { "content-type": "application/json" },
            method: "PATCH",
          }),
        )
      ).json();

      const rejectResponse = await handler(
        request(new URL("http://localhost/api/conversations"), {
          body: JSON.stringify({
            action: "rejectEditProposal",
            conversationId: created.conversation.id,
            proposalId: withProposal.conversation.editProposals[0].id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }),
      );
      const rejected = await rejectResponse.json();

      expect(rejectResponse.status).toBe(200);
      expect(rejected.conversation.editProposals[0].status).toBe("rejected");
      expect(readFileSync(path.join(workspaceRoot, "note.txt"), "utf8")).toBe("old");
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("undoes the latest applied proposal when the file still matches the applied content", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const handler = createConversationApiHandler({ dataRoot });

    try {
      const filePath = path.join(workspaceRoot, "note.txt");
      writeFileSync(filePath, "old", "utf8");
      const created = await (
        await handler(
          request(new URL("http://localhost/api/conversations"), {
            body: JSON.stringify({ workspaceRoot }),
            headers: { "content-type": "application/json" },
            method: "POST",
          }),
        )
      ).json();
      const withProposal = await (
        await handler(
          request(new URL("http://localhost/api/conversations"), {
            body: JSON.stringify({
              action: "appendEditProposal",
              conversationId: created.conversation.id,
              newText: "new",
              oldText: "old",
              path: "note.txt",
              workspaceRoot,
            }),
            headers: { "content-type": "application/json" },
            method: "PATCH",
          }),
        )
      ).json();
      await handler(
        request(new URL("http://localhost/api/conversations"), {
          body: JSON.stringify({
            action: "applyEditProposal",
            conversationId: created.conversation.id,
            dirtyPaths: [],
            proposalId: withProposal.conversation.editProposals[0].id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }),
      );

      const undoResponse = await handler(
        request(new URL("http://localhost/api/conversations"), {
          body: JSON.stringify({
            action: "undoEditProposal",
            conversationId: created.conversation.id,
            proposalId: withProposal.conversation.editProposals[0].id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }),
      );
      const undone = await undoResponse.json();

      expect(undoResponse.status).toBe(200);
      expect(undone.conversation.editProposals[0].status).toBe("undone");
      expect(readFileSync(filePath, "utf8")).toBe("old");
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("marks undo as conflicted when the target changed after apply", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-api-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const handler = createConversationApiHandler({ dataRoot });

    try {
      const filePath = path.join(workspaceRoot, "note.txt");
      writeFileSync(filePath, "old", "utf8");
      const created = await (
        await handler(
          request(new URL("http://localhost/api/conversations"), {
            body: JSON.stringify({ workspaceRoot }),
            headers: { "content-type": "application/json" },
            method: "POST",
          }),
        )
      ).json();
      const withProposal = await (
        await handler(
          request(new URL("http://localhost/api/conversations"), {
            body: JSON.stringify({
              action: "appendEditProposal",
              conversationId: created.conversation.id,
              newText: "new",
              oldText: "old",
              path: "note.txt",
              workspaceRoot,
            }),
            headers: { "content-type": "application/json" },
            method: "PATCH",
          }),
        )
      ).json();
      await handler(
        request(new URL("http://localhost/api/conversations"), {
          body: JSON.stringify({
            action: "applyEditProposal",
            conversationId: created.conversation.id,
            dirtyPaths: [],
            proposalId: withProposal.conversation.editProposals[0].id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }),
      );
      writeFileSync(filePath, "new plus user change", "utf8");

      const undoResponse = await handler(
        request(new URL("http://localhost/api/conversations"), {
          body: JSON.stringify({
            action: "undoEditProposal",
            conversationId: created.conversation.id,
            proposalId: withProposal.conversation.editProposals[0].id,
            workspaceRoot,
          }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }),
      );
      const conflicted = await undoResponse.json();

      expect(undoResponse.status).toBe(200);
      expect(conflicted.conversation.editProposals[0].status).toBe("conflicted");
      expect(readFileSync(filePath, "utf8")).toBe("new plus user change");
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });
});
