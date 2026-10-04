import { z } from "zod";
import { notifyWorkspaceChanged } from "../workspace/workspaceChangedNotifier";
import {
  localWorkspaceFileStore,
  type WorkspaceFileStore,
} from "../workspace/workspaceFileStore";
import {
  removeFileTreeOrderPath,
  renameFileTreeOrderPath,
} from "./fileTreeOrderStore";

const createOperationSchema = z.object({
  kind: z.enum(["directory", "file"]),
  operation: z.literal("create"),
  path: z.string().min(1),
  workspaceRoot: z.string().min(1),
});

const deleteOperationSchema = z.object({
  operation: z.literal("delete"),
  path: z.string().min(1),
  workspaceRoot: z.string().min(1),
});

const renameOperationSchema = z.object({
  newPath: z.string().min(1),
  operation: z.literal("rename"),
  path: z.string().min(1),
  workspaceRoot: z.string().min(1),
});

const fileOperationSchema = z.discriminatedUnion("operation", [
  createOperationSchema,
  deleteOperationSchema,
  renameOperationSchema,
]);

export type FileOperationsApiOptions = {
  dataRoot?: string;
  fileStore?: WorkspaceFileStore;
};

function jsonResponse<TBody>(body: TBody, status: number): Response {
  return Response.json(body, { status });
}

function requestMessage(error: unknown, fallbackMessage: string): string {
  return error instanceof Error ? error.message : fallbackMessage;
}

function statusForError(error: unknown): number {
  if (error instanceof Error && "status" in error) {
    const status = Number((error as { status: unknown }).status);
    if (Number.isInteger(status) && status >= 400 && status <= 599) {
      return status;
    }
  }

  return 400;
}

export function createFileOperationsApiHandler(
  options: FileOperationsApiOptions = {},
) {
  const fileStore = options.fileStore ?? localWorkspaceFileStore;

  return async function fileOperationsApiHandler(
    request: Request,
  ): Promise<Response> {
    if (request.method !== "POST") {
      return jsonResponse({ message: "Method not allowed" }, 405);
    }

    try {
      const parsedBody = fileOperationSchema.safeParse(await request.json());
      if (!parsedBody.success) {
        return jsonResponse({ message: "Invalid file operation request" }, 400);
      }

      const context = await fileStore.createContext(
        parsedBody.data.workspaceRoot,
      );

      if (parsedBody.data.operation === "create") {
        const createdPath =
          parsedBody.data.kind === "directory"
            ? await fileStore.createDirectory(context, parsedBody.data.path)
            : await fileStore.createFile(context, parsedBody.data.path, "");
        notifyWorkspaceChanged(parsedBody.data.workspaceRoot);

        return jsonResponse(
          {
            kind: parsedBody.data.kind,
            operation: "create",
            path: createdPath,
          },
          200,
        );
      }

      if (parsedBody.data.operation === "delete") {
        const deletedPath = await fileStore.delete(
          context,
          parsedBody.data.path,
        );
        if (options.dataRoot) {
          await removeFileTreeOrderPath({
            dataRoot: options.dataRoot,
            path: deletedPath,
            workspaceRoot: context.workspaceRoot,
          });
        }
        notifyWorkspaceChanged(parsedBody.data.workspaceRoot);

        return jsonResponse(
          {
            operation: "delete",
            path: deletedPath,
          },
          200,
        );
      }

      const renamedPath = await fileStore.rename(
        context,
        parsedBody.data.path,
        parsedBody.data.newPath,
      );
      if (options.dataRoot) {
        await renameFileTreeOrderPath({
          dataRoot: options.dataRoot,
          newPath: renamedPath.newPath,
          oldPath: renamedPath.path,
          workspaceRoot: context.workspaceRoot,
        });
      }
      notifyWorkspaceChanged(parsedBody.data.workspaceRoot);

      return jsonResponse(
        {
          operation: "rename",
          path: renamedPath.path,
          newPath: renamedPath.newPath,
        },
        200,
      );
    } catch (error) {
      return jsonResponse(
        { message: requestMessage(error, "File operation failed") },
        statusForError(error),
      );
    }
  };
}
