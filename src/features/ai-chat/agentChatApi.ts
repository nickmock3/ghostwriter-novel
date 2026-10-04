import { z } from "zod";
import { llmProfileSchema } from "../ai-agent/llmProfiles";
import {
  APPLICATION_DATA_STORAGE_UNAVAILABLE,
  applicationStorageUnavailableBody,
  isApplicationStorageError,
} from "../../shared/server/applicationStorage";
import {
  createAgentChatApplicationService,
  type AgentChatApplicationServiceOptions,
} from "./agentChatApplicationService";
import type { Conversation } from "./conversationSchemas";
import { droppedTextFileInputsSchema } from "./droppedTextFiles";

const autoCompactThresholdRatioSchema = z.number().min(0.5).max(0.9);

const agentChatBodySchema = z
  .object({
    autoCompactEnabled: z.boolean().default(true),
    autoCompactThresholdRatio: autoCompactThresholdRatioSchema.default(0.7),
    content: z.string().min(1),
    conversationId: z.string().min(1).optional(),
    currentFilePath: z.string().min(1).optional(),
    droppedTextFiles: droppedTextFileInputsSchema.optional(),
    llmProfileId: z.string().min(1).optional(),
    mode: z.enum(["chat", "editor"]).optional(),
    modelSelection: z
      .object({
        modelId: z.string().min(1),
        providerId: z.string().min(1),
      })
      .optional(),
    userProfiles: z
      .array(llmProfileSchema.refine((profile) => profile.source === "user", "User profiles only"))
      .optional(),
    workspaceRoot: z.string().min(1),
  })
  .superRefine((body, context) => {
    if (body.droppedTextFiles?.length && body.mode !== "chat") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Dropped text files are available only in chat mode",
        path: ["droppedTextFiles"],
      });
    }
  });

function invalidChatRequestStatus(error: z.ZodError): number {
  return error.issues.some(
    (issue) =>
      issue.path[0] === "droppedTextFiles" &&
      (issue.code === "too_big" || issue.message.toLowerCase().includes("too large")),
  )
    ? 413
    : 400;
}

export type AgentChatApiOptions = AgentChatApplicationServiceOptions;
export type { AgentChatCompactConversationHandler } from "./agentChatApplicationService";

function jsonResponse<TBody>(body: TBody, status: number): Response {
  return Response.json(body, { status });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function chatErrorResponse(error: unknown): Response {
  if (isApplicationStorageError(error)) {
    return jsonResponse(applicationStorageUnavailableBody(), 500);
  }

  const conversation =
    typeof error === "object" && error !== null && "conversation" in error
      ? (error.conversation as Conversation)
      : undefined;

  return jsonResponse(
    {
      ...(conversation ? { conversation } : {}),
      message: errorMessage(error, "Chat message failed"),
    },
    400,
  );
}

function wantsNdjson(request: Request): boolean {
  return request.headers.get("accept")?.includes("application/x-ndjson") ?? false;
}

function encodeNdjsonLine(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

type NdjsonStreamController = {
  close(): void;
  enqueue(chunk: Uint8Array): void;
};

export function createNdjsonStreamWriter(controller: NdjsonStreamController) {
  let cancelled = false;
  let closed = false;

  function isInactive(): boolean {
    return cancelled || closed;
  }

  return {
    cancel(): void {
      cancelled = true;
    },
    close(): void {
      if (isInactive()) {
        return;
      }
      closed = true;
      try {
        controller.close();
      } catch {
        // Consumer may already have closed the stream.
      }
    },
    enqueue(value: unknown): void {
      if (isInactive()) {
        return;
      }
      try {
        controller.enqueue(encodeNdjsonLine(value));
      } catch {
        closed = true;
      }
    },
  };
}

export function createAgentChatApiHandler(options: AgentChatApiOptions = {}) {
  const { runAgentChat } = createAgentChatApplicationService(options);

  return async function agentChatApiHandler(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return jsonResponse({ message: "Method not allowed" }, 405);
    }

    try {
      const parsedBody = agentChatBodySchema.safeParse(await request.json());
      if (!parsedBody.success) {
        return jsonResponse(
          { message: "Invalid chat message request" },
          invalidChatRequestStatus(parsedBody.error),
        );
      }

      if (wantsNdjson(request)) {
        let writer: ReturnType<typeof createNdjsonStreamWriter> | undefined;
        const stream = new ReadableStream({
          cancel() {
            writer?.cancel();
          },
          async start(controller) {
            writer = createNdjsonStreamWriter(controller);
            try {
              await runAgentChat(parsedBody.data, (event) => {
                writer?.enqueue(event);
              });
              writer.close();
            } catch (error) {
              writer.enqueue({
                message: isApplicationStorageError(error)
                  ? APPLICATION_DATA_STORAGE_UNAVAILABLE
                  : errorMessage(error, "Chat message failed"),
                type: "error",
              });
              writer.close();
            }
          },
        });

        return new Response(stream, {
          headers: { "content-type": "application/x-ndjson; charset=utf-8" },
          status: 200,
        });
      }

      const result = await runAgentChat(parsedBody.data);
      return jsonResponse(result, 200);
    } catch (error) {
      return chatErrorResponse(error);
    }
  };
}
