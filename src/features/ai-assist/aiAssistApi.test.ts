import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EditProposal } from "../edit-proposals/editProposalSchemas";
import { createAiAssistApiHandler } from "./aiAssistApi";
import { createAiAssistStore } from "./aiAssistStore";

const pendingProposal: EditProposal = {
  createdAt: "2026-07-14T00:00:00.000Z",
  diff: "diff",
  id: "proposal-1",
  newText: "after",
  oldText: "before",
  operation: "edit",
  path: "draft.txt",
  status: "pending",
  title: "Edit draft.txt",
  updatedAt: "2026-07-14T00:00:00.000Z",
};

const executionBody = {
  assistId: "polish",
  editorContent: "before",
  runtime: "vercel-ai" as const,
  targetRange: { end: 0, start: 0 },
  workspaceRelativePath: "draft.txt",
  workspaceRoot: "/workspace",
};

function request(path: string, body: unknown, method = "POST") {
  return new Request(`http://localhost${path}`, {
    ...(method === "GET" || method === "HEAD" ? {} : { body: JSON.stringify(body) }),
    headers: { "content-type": "application/json" },
    method,
  });
}

describe("AI assist API", () => {
  it("lists, saves, updates, and deletes custom definitions while protecting built-ins", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-ai-assist-api-"));
    const handler = createAiAssistApiHandler({
      assistStore: createAiAssistStore({ dataRoot }),
      applyProposal: vi.fn(),
      runStandard: vi.fn(),
    });

    try {
      const createResponse = await handler(
        request("/api/ai-assists/custom-polish", {
          additionalInstructionPlaceholder: "今回だけの補足",
          description: "作品固有の表現を整えます。",
          fixedInstruction: "作品固有の表現を保って本文を整えてください。",
          name: "作品用推敲",
          resultType: "edit-proposal",
          targetType: "text",
        }, "PUT"),
      );
      expect(createResponse.status).toBe(200);
      expect(await createResponse.json()).toMatchObject({
        assist: { id: "custom-polish", isBuiltIn: false, name: "作品用推敲" },
      });

      const listResponse = await handler(request("/api/ai-assists", undefined, "GET"));
      expect(listResponse.status).toBe(200);
      expect((await listResponse.json()).assists).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "polish", isBuiltIn: true }),
          expect.objectContaining({ id: "custom-polish", isBuiltIn: false }),
        ]),
      );

      const updateResponse = await handler(
        request("/api/ai-assists/custom-polish", {
          additionalInstructionPlaceholder: "更新後の補足",
          description: "更新後の説明",
          fixedInstruction: "更新後の固定指示です。",
          name: "更新後の推敲",
          resultType: "edit-proposal",
          targetType: "text",
        }, "PUT"),
      );
      expect(await updateResponse.json()).toMatchObject({
        assist: { description: "更新後の説明", name: "更新後の推敲" },
      });

      const builtInResponse = await handler(
        request("/api/ai-assists/polish", {
          additionalInstructionPlaceholder: "変更",
          description: "変更",
          fixedInstruction: "変更",
          name: "変更",
          resultType: "edit-proposal",
          targetType: "text",
        }, "PUT"),
      );
      expect(builtInResponse.status).toBe(409);

      const deleteResponse = await handler(
        request("/api/ai-assists/custom-polish", undefined, "DELETE"),
      );
      expect(deleteResponse.status).toBe(200);
      const afterDeleteResponse = await handler(request("/api/ai-assists", undefined, "GET"));
      expect((await afterDeleteResponse.json()).assists).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "custom-polish" })]),
      );
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
    }
  });

  it("runs standard execution and rejects the retired runtime", async () => {
    const runStandard = vi.fn(async () => ({ proposal: pendingProposal, status: "completed" as const }));
    const handler = createAiAssistApiHandler({
      applyProposal: vi.fn(),
      runStandard,
    });

    const standardResponse = await handler(
      request("/api/ai-assists/execute", executionBody),
    );
    expect(standardResponse.status).toBe(200);
    expect(runStandard).toHaveBeenCalledWith(expect.objectContaining({ assistId: "polish" }));

    const codexResponse = await handler(
      request("/api/ai-assists/execute", {
        ...executionBody,
        runtime: "codex-app-server",
        selectedModel: "gpt-5.6-codex",
      }),
    );
    expect(codexResponse.status).toBe(400);
    expect(runStandard).toHaveBeenCalledTimes(1);
  });

  it("applies or rejects a proposal without creating conversation state", async () => {
    const applyProposal = vi.fn(async () => ({ ...pendingProposal, status: "applied" as const }));
    const handler = createAiAssistApiHandler({
      applyProposal,
      runStandard: vi.fn(),
    });

    const applyResponse = await handler(
      request(
        "/api/ai-assists/proposals",
        {
          action: "apply",
          dirtyPaths: [],
          proposal: pendingProposal,
          workspaceRoot: "/workspace",
        },
        "PATCH",
      ),
    );
    expect(applyResponse.status).toBe(200);
    expect(applyProposal).toHaveBeenCalledWith({
      dirtyPaths: [],
      proposal: pendingProposal,
      workspaceRoot: "/workspace",
    });

    const rejectResponse = await handler(
      request(
        "/api/ai-assists/proposals",
        {
          action: "reject",
          proposal: pendingProposal,
          workspaceRoot: "/workspace",
        },
        "PATCH",
      ),
    );
    expect(rejectResponse.status).toBe(200);
    expect(await rejectResponse.json()).toMatchObject({ proposal: { status: "rejected" } });
    expect(applyProposal).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid additional instructions and methods before execution", async () => {
    const runStandard = vi.fn();
    const handler = createAiAssistApiHandler({
      applyProposal: vi.fn(),
      runStandard,
    });

    const invalidResponse = await handler(
      request("/api/ai-assists/execute", {
        ...executionBody,
        additionalInstruction: "x".repeat(501),
      }),
    );
    expect(invalidResponse.status).toBe(400);
    expect(runStandard).not.toHaveBeenCalled();

    const methodResponse = await handler(
      request("/api/ai-assists/execute", executionBody, "GET"),
    );
    expect(methodResponse.status).toBe(405);
  });

  it("returns a JSON error when execution or apply services reject", async () => {
    const handler = createAiAssistApiHandler({
      applyProposal: vi.fn(async () => {
        throw new Error("proposal conflict");
      }),
      runStandard: vi.fn(async () => {
        throw new Error("provider unavailable");
      }),
    });

    const executeResponse = await handler(request("/api/ai-assists/execute", executionBody));
    expect(executeResponse.status).toBe(400);
    expect(await executeResponse.json()).toEqual({ message: "provider unavailable" });

    const applyResponse = await handler(
      request(
        "/api/ai-assists/proposals",
        {
          action: "apply",
          dirtyPaths: [],
          proposal: pendingProposal,
          workspaceRoot: "/workspace",
        },
        "PATCH",
      ),
    );
    expect(applyResponse.status).toBe(400);
    expect(await applyResponse.json()).toEqual({ message: "proposal conflict" });
  });

  it("passes standard model selection overrides to the standard execution handler", async () => {
    const runStandard = vi.fn(async () => ({ proposal: pendingProposal, status: "completed" as const }));
    const handler = createAiAssistApiHandler({
      applyProposal: vi.fn(),
      runStandard,
    });

    const response = await handler(
      request("/api/ai-assists/execute", {
        ...executionBody,
        standardModelSelection: {
          kind: "model",
          modelId: "gpt-5.4-mini",
          providerId: "openai",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(runStandard).toHaveBeenCalledWith(
      expect.objectContaining({
        standardModelSelection: {
          kind: "model",
          modelId: "gpt-5.4-mini",
          providerId: "openai",
        },
      }),
    );
  });
});

it("applies and undoes through real files, rejecting dirty undo without changing content", async () => {
  const { readFile, writeFile } = await import("node:fs/promises");
  const { applyEditProposal } = await import("../edit-proposals/editProposalService");
  const root = mkdtempSync(path.join(tmpdir(), "assist-undo-"));
  const handler = createAiAssistApiHandler({ applyProposal: applyEditProposal });
  try {
    await writeFile(path.join(root, "draft.txt"), "before");
    const applied = await handler(request("/api/ai-assists/proposals", { action: "apply", dirtyPaths: [], proposal: pendingProposal, workspaceRoot: root }, "PATCH"));
    const { proposal } = await applied.json();
    expect(await readFile(path.join(root, "draft.txt"), "utf8")).toBe("after");
    const undo = (dirtyPaths: string[]) => handler(request("/api/ai-assists/proposals", { action: "undo", dirtyPaths, proposal, workspaceRoot: root }, "PATCH"));
    expect((await undo(["draft.txt"])).status).toBe(400);
    expect(await readFile(path.join(root, "draft.txt"), "utf8")).toBe("after");
    expect((await undo([])).status).toBe(200);
    expect(await readFile(path.join(root, "draft.txt"), "utf8")).toBe("before");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
