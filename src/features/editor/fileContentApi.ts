import { z } from "zod";
import {
  localWorkspaceFileStore,
  type WorkspaceFileStore,
} from "../workspace/workspaceFileStore";

const MAX_READ_BYTES = 1024 * 1024;

const readQuerySchema = z.object({
  path: z.string().min(1),
  workspaceRoot: z.string().min(1),
});

const writeBodySchema = z.object({
  content: z.string(),
  path: z.string().min(1),
  workspaceRoot: z.string().min(1),
});

export type FileContentApiOptions = {
  fileStore?: WorkspaceFileStore;
};

function jsonResponse<TBody>(body: TBody, status: number): Response {
  return Response.json(body, { status });
}

function requestMessage(error: unknown, fallbackMessage: string): string {
  return error instanceof Error ? error.message : fallbackMessage;
}

export function createFileContentApiHandler(
  options: FileContentApiOptions = {},
) {
  const fileStore = options.fileStore ?? localWorkspaceFileStore;

  return async function fileContentApiHandler(
    request: Request,
  ): Promise<Response> {
    if (request.method === "GET") {
      const parsedQuery = readQuerySchema.safeParse({
        path: new URL(request.url).searchParams.get("path") ?? "",
        workspaceRoot:
          new URL(request.url).searchParams.get("workspaceRoot") ?? "",
      });

      if (!parsedQuery.success) {
        return jsonResponse({ message: "Invalid file read request" }, 400);
      }

      try {
        const context = await fileStore.createContext(
          parsedQuery.data.workspaceRoot,
        );
        const fileContent = await fileStore.readTextFile(
          context,
          parsedQuery.data.path,
          {
            maxBytes: MAX_READ_BYTES,
          },
        );

        return jsonResponse(
          {
            content: fileContent.content,
            path: fileContent.path,
            truncated: fileContent.truncated,
          },
          200,
        );
      } catch (error) {
        return jsonResponse(
          { message: requestMessage(error, "File read failed") },
          error instanceof Error &&
            error.message.startsWith("File is too large")
            ? 413
            : 400,
        );
      }
    }

    if (request.method === "PUT") {
      try {
        const parsedBody = writeBodySchema.safeParse(await request.json());
        if (!parsedBody.success) {
          return jsonResponse({ message: "Invalid file write request" }, 400);
        }

        const context = await fileStore.createContext(
          parsedBody.data.workspaceRoot,
        );
        const savedPath = await fileStore.saveTextFile(
          context,
          parsedBody.data.path,
          parsedBody.data.content,
        );

        return jsonResponse(
          {
            content: parsedBody.data.content,
            path: savedPath,
          },
          200,
        );
      } catch (error) {
        return jsonResponse(
          { message: requestMessage(error, "File write failed") },
          400,
        );
      }
    }

    return jsonResponse({ message: "Method not allowed" }, 405);
  };
}
