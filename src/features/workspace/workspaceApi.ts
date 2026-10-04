import { notifyWorkspaceChanged } from "./workspaceChangedNotifier";
import { localWorkspaceFileStore } from "./workspaceFileStore";
import { resolveWorkspaceRoot } from "./workspacePaths";
import {
  workspaceSelectErrorSchema,
  workspaceSelectSuccessSchema,
  workspaceTemplateRequestSchema,
  workspaceTemplateSuccessSchema,
  workspaceValidateRequestSchema,
  type WorkspaceTemplateRequest,
  type WorkspaceTemplateSuccess,
  type WorkspaceValidateRequest,
  type WorkspaceSelectError,
  type WorkspaceSelectSuccess,
} from "./workspaceSchemas";
import {
  builtInWorkspaceTemplate,
  getWorkspaceTemplate,
  validateWorkspaceTemplateDefinition,
  type WorkspaceTemplate,
} from "./workspaceTemplateStore";
import { type WorkspaceTemplateItem } from "./workspaceTemplateContracts";

export type WorkspaceApiOptions = {
  dataRoot?: string;
  selectDirectory(): Promise<string>;
};

function jsonResponse<TBody>(body: TBody, status: number): Response {
  return Response.json(body, { status });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Workspace selection failed";
}

function workspaceErrorResponse(message: string, status: number): Response {
  const body: WorkspaceSelectError = workspaceSelectErrorSchema.parse({
    code: "workspace_selection_failed",
    message,
  });

  return jsonResponse(body, status);
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

function isTemplateDirectory(
  item: WorkspaceTemplateItem,
): item is Extract<WorkspaceTemplateItem, { kind: "directory" }> {
  return item.kind === "directory";
}

function isTemplateFile(
  item: WorkspaceTemplateItem,
): item is Extract<WorkspaceTemplateItem, { kind: "file" }> {
  return item.kind === "file";
}

async function validateWorkspaceRoot(
  workspaceRoot: string,
): Promise<WorkspaceSelectSuccess> {
  const resolvedWorkspaceRoot = await resolveWorkspaceRoot(workspaceRoot);

  return workspaceSelectSuccessSchema.parse({
    workspaceRoot: resolvedWorkspaceRoot,
  });
}

async function applyNewWorkspaceTemplate(
  request: WorkspaceTemplateRequest,
  options: Pick<WorkspaceApiOptions, "dataRoot">,
): Promise<WorkspaceTemplateSuccess> {
  const context = await localWorkspaceFileStore.createContext(
    request.workspaceRoot,
  );
  const resolvedWorkspaceRoot = context.workspaceRoot;
  const createdDirectories: string[] = [];
  const createdFiles: string[] = [];
  const skippedExisting: string[] = [];

  const selectedTemplate = await resolveSelectedTemplate(request, options);
  const templateItems: WorkspaceTemplateItem[] =
    selectedTemplate.source === "user"
      ? validateWorkspaceTemplateDefinition(selectedTemplate).items
      : [...selectedTemplate.items];

  const directories = templateItems.filter(isTemplateDirectory);
  const files = templateItems.filter(isTemplateFile);

  for (const directory of directories) {
    const directoryPath = directory.path;
    if (await localWorkspaceFileStore.exists(context, directoryPath)) {
      skippedExisting.push(directoryPath);
      continue;
    }

    await localWorkspaceFileStore.createDirectory(context, directoryPath);
    createdDirectories.push(directoryPath);
  }

  for (const file of files) {
    if (await localWorkspaceFileStore.exists(context, file.path)) {
      throw Object.assign(
        new Error(`Template target already exists: ${file.path}`),
        { status: 409 },
      );
    }

    await localWorkspaceFileStore.createFile(context, file.path, file.content);
    createdFiles.push(file.path);
  }

  notifyWorkspaceChanged(resolvedWorkspaceRoot);

  return workspaceTemplateSuccessSchema.parse({
    createdDirectories,
    createdFiles,
    skippedExisting,
    workspaceRoot: resolvedWorkspaceRoot,
  });
}

async function resolveSelectedTemplate(
  request: WorkspaceTemplateRequest,
  options: Pick<WorkspaceApiOptions, "dataRoot">,
): Promise<WorkspaceTemplate> {
  if (!request.templateId) {
    return builtInWorkspaceTemplate;
  }

  const template = await getWorkspaceTemplate({
    dataRoot: options.dataRoot,
    templateId: request.templateId,
  });

  if (!template) {
    throw Object.assign(new Error("Workspace template not found"), {
      status: 404,
    });
  }

  return template;
}

export function createWorkspaceApiHandler(options: WorkspaceApiOptions) {
  return async function workspaceApiHandler(
    request: Request,
  ): Promise<Response> {
    if (request.method !== "POST") {
      return workspaceErrorResponse("Method not allowed", 405);
    }

    const { pathname } = new URL(request.url);

    if (pathname === "/api/workspace/select") {
      try {
        const selectedPath = await options.selectDirectory();
        const body = await validateWorkspaceRoot(selectedPath);

        return jsonResponse(body, 200);
      } catch (error) {
        return workspaceErrorResponse(errorMessage(error), 500);
      }
    }

    if (pathname === "/api/workspace/validate") {
      try {
        const requestBody = workspaceValidateRequestSchema.safeParse(
          await request.json(),
        );

        if (!requestBody.success) {
          return workspaceErrorResponse("Invalid workspace root payload", 400);
        }

        const parsedRequest: WorkspaceValidateRequest = requestBody.data;
        const body = await validateWorkspaceRoot(parsedRequest.workspaceRoot);

        return jsonResponse(body, 200);
      } catch (error) {
        return workspaceErrorResponse(errorMessage(error), 400);
      }
    }

    if (pathname === "/api/workspace/template") {
      try {
        const requestBody = workspaceTemplateRequestSchema.safeParse(
          await request.json(),
        );

        if (!requestBody.success) {
          return workspaceErrorResponse(
            "Invalid workspace template payload",
            400,
          );
        }

        const body = await applyNewWorkspaceTemplate(requestBody.data, {
          dataRoot: options.dataRoot,
        });

        return jsonResponse(body, 200);
      } catch (error) {
        return workspaceErrorResponse(
          errorMessage(error),
          statusForError(error),
        );
      }
    }

    return workspaceErrorResponse("Not found", 404);
  };
}
