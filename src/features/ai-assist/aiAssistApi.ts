import type { SiwcService } from "../siwc/service";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  applyEditProposal,
  undoEditProposal,
  rejectEditProposal,
  type ApplyEditProposalInput,
} from "../edit-proposals/editProposalService";
import { editProposalSchema } from "../edit-proposals/editProposalSchemas";
import { createStandardAiAssistExecutionService } from "./aiAssistExecutionService";
import {
  aiAssistDefinitionInputSchema,
  aiAssistExecuteBodySchema,
  aiAssistStandardExecuteBodySchema,
} from "./aiAssistContracts";
import type { AiAssistExecutionResult } from "./aiAssistExecutionService";
import { localWorkspaceFileStore } from "../workspace/workspaceFileStore";
import type { EditProposal } from "../edit-proposals/editProposalSchemas";
import {
  applicationStorageUnavailableBody,
  isApplicationStorageError,
} from "../../shared/server/applicationStorage";
import { defaultConversationDataRoot } from "../ai-chat/conversationHistory";
import { createAiAssistStore, type AiAssistStore } from "./aiAssistStore";

const aiAssistApplyBodySchema = z.object({
  action: z.literal("apply"),
  dirtyPaths: z.array(z.string()),
  proposal: editProposalSchema,
  workspaceRoot: z.string().min(1),
});

const aiAssistRejectBodySchema = z.object({
  action: z.literal("reject"),
  proposal: editProposalSchema,
  workspaceRoot: z.string().min(1),
});

const aiAssistProposalBodySchema = z.discriminatedUnion("action", [
  aiAssistApplyBodySchema,
  aiAssistApplyBodySchema.extend({ action: z.literal("undo") }),
  aiAssistRejectBodySchema,
]);

type AiAssistExecutionHandlerResult =
  | { proposal: EditProposal; status: "completed" }
  | { message: string; status: "error" };

export type AiAssistApiHandlerDeps = {
  runStandard?: (input: z.infer<typeof aiAssistStandardExecuteBodySchema>) => Promise<AiAssistExecutionHandlerResult>;
  applyProposal?: (input: ApplyEditProposalInput) => Promise<EditProposal>;
  assistStore?: AiAssistStore;
};

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

function methodNotAllowed(): Response {
  return jsonResponse({ message: "Method not allowed" }, 405);
}

function notFound(): Response {
  return jsonResponse({ message: "Not found" }, 404);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function statusForAssistStoreError(error: unknown): number {
  if (isApplicationStorageError(error)) {
    return 500;
  }

  if (
    error instanceof Error &&
    /^Built-in AI assists cannot be (edited|deleted)$/.test(error.message)
  ) {
    return 409;
  }

  return 400;
}

function assistStoreErrorResponse(error: unknown, fallback: string): Response {
  if (isApplicationStorageError(error)) {
    return jsonResponse(applicationStorageUnavailableBody(), 500);
  }

  return jsonResponse(
    { message: errorMessage(error, fallback) },
    statusForAssistStoreError(error),
  );
}

function assistIdFromPath(pathname: string): string | null {
  const prefix = "/api/ai-assists/";

  if (!pathname.startsWith(prefix)) {
    return null;
  }

  try {
    const assistId = decodeURIComponent(pathname.slice(prefix.length));
    return assistId.trim() ? assistId : null;
  } catch {
    return null;
  }
}

async function readSavedFile(input: { path: string; workspaceRoot: string }) {
  const context = await localWorkspaceFileStore.createContext(input.workspaceRoot);
  const file = await localWorkspaceFileStore.readTextFile(context, input.path);
  return {
    content: file.content,
    path: file.path,
  };
}

export function createProductionAiAssistApiHandler(options: {
  siwcService?: SiwcService;
  dataRoot?: string;
}): (request: Request) => Promise<Response> {
  const dataRoot = options.dataRoot ?? defaultConversationDataRoot();
  const assistStore = createAiAssistStore({ dataRoot });
  const resolveAiAssist = (assistId: string) => assistStore.getAiAssist(assistId);
  const standardService = createStandardAiAssistExecutionService({
    siwcService: options.siwcService,
    resolveAiAssist,
  });
  return createAiAssistApiHandler({
    applyProposal: applyEditProposal,
    assistStore,
    runStandard: async (input) => {
      const result = await standardService.run(input);
      if (result.status === "error") {
        return result;
      }
      return { proposal: result.proposal, status: result.status };
    },
  });
}

export function createAiAssistApiHandler(deps: AiAssistApiHandlerDeps) {
  const applyProposal = deps.applyProposal ?? applyEditProposal;
  const runStandard = deps.runStandard;
  const assistStore = deps.assistStore;

  return async function aiAssistApiHandler(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/ai-assists") {
      if (request.method !== "GET") {
        return methodNotAllowed();
      }

      if (!assistStore) {
        return jsonResponse({ message: "AI assist storage is unavailable" }, 500);
      }

      try {
        return jsonResponse({ assists: await assistStore.listAiAssists() }, 200);
      } catch (error) {
        return assistStoreErrorResponse(error, "AI assist list failed");
      }
    }

    const assistId = assistIdFromPath(pathname);
    if (assistId && assistId !== "execute" && assistId !== "proposals") {
      if (!assistStore) {
        return jsonResponse({ message: "AI assist storage is unavailable" }, 500);
      }

      if (request.method === "PUT") {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ message: "Invalid JSON body" }, 400);
        }

        const parsedBody = aiAssistDefinitionInputSchema.safeParse(body);
        if (!parsedBody.success) {
          return jsonResponse({ message: parsedBody.error.message }, 400);
        }

        try {
          const assist = await assistStore.saveCustomAiAssist(parsedBody.data, assistId);
          return jsonResponse({ assist }, 200);
        } catch (error) {
          return assistStoreErrorResponse(error, "AI assist save failed");
        }
      }

      if (request.method === "DELETE") {
        try {
          await assistStore.deleteCustomAiAssist(assistId);
          return jsonResponse({ ok: true }, 200);
        } catch (error) {
          return assistStoreErrorResponse(error, "AI assist delete failed");
        }
      }

      return methodNotAllowed();
    }

    if (pathname === "/api/ai-assists/execute") {
      if (request.method !== "POST") {
        return methodNotAllowed();
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ message: "Invalid JSON body" }, 400);
      }

      const parsedExecute = aiAssistExecuteBodySchema.safeParse(body);
      if (!parsedExecute.success) {
        return jsonResponse({ message: parsedExecute.error.message }, 400);
      }

      if (!runStandard) {
        return jsonResponse({ message: "AI assist execution is unavailable" }, 500);
      }

      if (parsedExecute.data.runtime === "vercel-ai") {
        const parsedStandard = aiAssistStandardExecuteBodySchema.safeParse(body);
        if (!parsedStandard.success) {
          return jsonResponse({ message: parsedStandard.error.message }, 400);
        }

        let result: AiAssistExecutionHandlerResult;
        try {
          result = await runStandard(parsedStandard.data);
        } catch (error) {
          return jsonResponse({ message: errorMessage(error, "AI assist execution failed") }, 400);
        }
        if (result.status === "error") {
          return jsonResponse({ message: result.message }, 400);
        }

        return jsonResponse({ proposal: result.proposal, status: result.status }, 200);
      }

      return jsonResponse({ message: "Unsupported AI runtime" }, 400);
    }

    if (pathname === "/api/ai-assists/proposals") {
      if (request.method !== "PATCH") {
        return methodNotAllowed();
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ message: "Invalid JSON body" }, 400);
      }

      const parsedBody = aiAssistProposalBodySchema.safeParse(body);
      if (!parsedBody.success) {
        return jsonResponse({ message: parsedBody.error.message }, 400);
      }

      if (parsedBody.data.action === "apply") {
        let proposal: EditProposal;
        try {
          proposal = await applyProposal({
            dirtyPaths: parsedBody.data.dirtyPaths,
            proposal: parsedBody.data.proposal,
            workspaceRoot: parsedBody.data.workspaceRoot,
          });
        } catch (error) {
          return jsonResponse({ message: errorMessage(error, "Edit proposal apply failed") }, 400);
        }
        return jsonResponse({ proposal }, 200);
      }

      if (parsedBody.data.action === "undo") {
        if (parsedBody.data.dirtyPaths.length > 0) return jsonResponse({ message: "先に未保存の原稿を保存してください。" }, 400);
        try {
          return jsonResponse({ proposal: await undoEditProposal(parsedBody.data) }, 200);
        } catch (error) { return jsonResponse({ message: errorMessage(error, "Edit proposal undo failed") }, 400); }
      }
      const proposal = rejectEditProposal(parsedBody.data.proposal);
      return jsonResponse({ proposal }, 200);
    }

    return notFound();
  };
}
