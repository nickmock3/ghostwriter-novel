import { z } from "zod";
import {
  localWorkspaceFileStore,
  type WorkspaceFileStore,
  type WorkspaceFileTreeItem,
} from "../workspace/workspaceFileStore";
import { orderFileTreeItems } from "./fileTreeOrderStore";

const fileTreeQuerySchema = z.object({
  filter: z.string().trim().optional().default(""),
  includeNoisyDirectories: z.boolean().optional().default(false),
  workspaceRoot: z.string().min(1),
});

export type FileTreeItem = WorkspaceFileTreeItem;

export type FileTreeApiOptions = {
  dataRoot?: string;
  fileStore?: WorkspaceFileStore;
};

function jsonResponse<TBody>(body: TBody, status: number): Response {
  return Response.json(body, { status });
}

export function createFileTreeApiHandler(options: FileTreeApiOptions = {}) {
  const fileStore = options.fileStore ?? localWorkspaceFileStore;

  return async function fileTreeApiHandler(
    request: Request,
  ): Promise<Response> {
    if (request.method !== "GET") {
      return jsonResponse({ message: "Method not allowed" }, 405);
    }

    const parsedQuery = fileTreeQuerySchema.safeParse({
      filter: new URL(request.url).searchParams.get("filter") ?? "",
      includeNoisyDirectories:
        new URL(request.url).searchParams.get("includeNoisyDirectories") ===
        "true",
      workspaceRoot:
        new URL(request.url).searchParams.get("workspaceRoot") ?? "",
    });

    if (!parsedQuery.success) {
      return jsonResponse({ message: "Invalid file tree request" }, 400);
    }

    try {
      const context = await fileStore.createContext(
        parsedQuery.data.workspaceRoot,
      );
      const tree = await fileStore.getFileTree(context, {
        filter: parsedQuery.data.filter,
        includeNoisyDirectories: parsedQuery.data.includeNoisyDirectories,
        limit: 100,
      });

      const items = options.dataRoot
        ? await orderFileTreeItems({
            dataRoot: options.dataRoot,
            items: tree.items,
            workspaceRoot: context.workspaceRoot,
          })
        : tree.items;

      return jsonResponse({ ...tree, items }, 200);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "File tree request failed";
      return jsonResponse({ message }, 400);
    }
  };
}
