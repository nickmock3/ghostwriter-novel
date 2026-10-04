import path from "node:path";
import { TextDecoder } from "node:util";
import { z } from "zod";
import { notifyWorkspaceChanged } from "../workspace/workspaceChangedNotifier";
import { normalizeWorkspaceRelativePath } from "../workspace/workspaceFilePaths";
import {
  localWorkspaceFileStore,
  type WorkspaceFileStore,
} from "../workspace/workspaceFileStore";
import { insertFileTreeOrder } from "./fileTreeOrderStore";

const MAX_DROPPED_FILE_BYTES = 1024 * 1024;

const importRequestSchema = z.object({
  contentBase64: z.string(),
  insertBeforePath: z.string().min(1).optional(),
  name: z.string().min(1),
  parentPath: z.string(),
  workspaceRoot: z.string().min(1),
});

export type DroppedFileImportApiOptions = {
  dataRoot: string;
  fileStore?: WorkspaceFileStore;
};

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

function errorWithStatus(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
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

function isCanonicalBase64(value: string): boolean {
  if (value === "") {
    return true;
  }
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    return false;
  }
  return Buffer.from(value, "base64").toString("base64") === value;
}

function decodeDroppedContent(contentBase64: string): Uint8Array {
  if (
    contentBase64.length >
    4 * Math.ceil(MAX_DROPPED_FILE_BYTES / 3)
  ) {
    throw errorWithStatus("Dropped file is too large", 413);
  }
  if (!isCanonicalBase64(contentBase64)) {
    throw errorWithStatus("Invalid dropped file encoding", 400);
  }
  const content = Buffer.from(contentBase64, "base64");
  if (content.byteLength > MAX_DROPPED_FILE_BYTES) {
    throw errorWithStatus("Dropped file is too large", 413);
  }
  if (content.includes(0x00)) {
    throw errorWithStatus("Dropped file appears to be binary", 400);
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      content,
    );
  } catch {
    throw errorWithStatus("Dropped file is not valid UTF-8", 400);
  }
  if (!Buffer.from(decoded, "utf8").equals(content)) {
    throw errorWithStatus("Dropped file UTF-8 bytes do not round-trip", 400);
  }
  return content;
}

function validateBasename(name: string): string {
  if (
    name === "." ||
    name === ".." ||
    name.startsWith(".") ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\u0000") ||
    path.posix.basename(name) !== name
  ) {
    throw errorWithStatus("Invalid dropped file name", 400);
  }
  return name;
}

function normalizeRelativePath(
  value: string,
  options: { allowEmpty: boolean },
): string {
  try {
    return normalizeWorkspaceRelativePath(value, {
      allowEmpty: options.allowEmpty,
      rejectBackslashes: true,
      rejectHiddenSegments: true,
      rejectNullBytes: true,
      requireCanonical: true,
    });
  } catch {
    throw errorWithStatus("Invalid workspace-relative path", 400);
  }
}

function parentPathOf(filePath: string): string {
  const segments = filePath.split("/");
  return segments.length > 1 ? segments.slice(0, -1).join("/") : "";
}

export function createDroppedFileImportApiHandler(
  options: DroppedFileImportApiOptions,
) {
  const fileStore = options.fileStore ?? localWorkspaceFileStore;

  return async function droppedFileImportApiHandler(
    request: Request,
  ): Promise<Response> {
    if (request.method !== "POST") {
      return jsonResponse({ message: "Method not allowed" }, 405);
    }

    let createdPath: string | null = null;
    let context: Awaited<ReturnType<WorkspaceFileStore["createContext"]>> | null =
      null;
    try {
      const parsedBody = importRequestSchema.safeParse(await request.json());
      if (!parsedBody.success) {
        return jsonResponse({ message: "Invalid dropped file import request" }, 400);
      }

      const name = validateBasename(parsedBody.data.name);
      const parentPath = normalizeRelativePath(parsedBody.data.parentPath, {
        allowEmpty: true,
      });
      const insertBeforePath =
        parsedBody.data.insertBeforePath === undefined
          ? undefined
          : normalizeRelativePath(parsedBody.data.insertBeforePath, {
              allowEmpty: false,
            });
      if (
        insertBeforePath !== undefined &&
        parentPathOf(insertBeforePath) !== parentPath
      ) {
        throw errorWithStatus(
          "Insertion sibling is not in the requested parent",
          409,
        );
      }

      const content = decodeDroppedContent(parsedBody.data.contentBase64);
      context = await fileStore.createContext(parsedBody.data.workspaceRoot);
      const siblingFilePaths = await fileStore.listChildFiles(context, parentPath);
      if (
        insertBeforePath !== undefined &&
        !siblingFilePaths.includes(insertBeforePath)
      ) {
        throw errorWithStatus("Insertion sibling does not exist", 409);
      }

      const requestedPath = parentPath
        ? path.posix.join(parentPath, name)
        : name;
      if (await fileStore.exists(context, requestedPath)) {
        throw errorWithStatus("Target path already exists", 409);
      }

      createdPath = await fileStore.createFileBytes(
        context,
        requestedPath,
        content,
      );
      let orderedFilePaths: string[];
      try {
        orderedFilePaths = await insertFileTreeOrder({
          dataRoot: options.dataRoot,
          insertBeforePath,
          newPath: createdPath,
          parentPath,
          siblingFilePaths: [...siblingFilePaths, createdPath],
          workspaceRoot: context.workspaceRoot,
        });
      } catch (error) {
        if (error instanceof Error && "status" in error) {
          throw error;
        }
        throw errorWithStatus("Application data storage is unavailable", 500);
      }
      notifyWorkspaceChanged(context.workspaceRoot);

      return jsonResponse(
        {
          operation: "import",
          orderedFilePaths,
          parentPath,
          path: createdPath,
        },
        200,
      );
    } catch (error) {
      if (createdPath && context) {
        try {
          await fileStore.delete(context, createdPath);
        } catch {
          return jsonResponse(
            { message: "Dropped file import rollback failed" },
            500,
          );
        }
      }
      return jsonResponse(
        {
          message:
            error instanceof Error
              ? error.message
              : "Dropped file import failed",
        },
        statusForError(error),
      );
    }
  };
}
