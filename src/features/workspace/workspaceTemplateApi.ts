import { defaultServerDataRoot } from "../../shared/server/applicationStorage";
import {
  applicationStorageUnavailableBody,
  isApplicationStorageError,
} from "../../shared/server/applicationStorage";
import {
  deleteUserWorkspaceTemplate,
  listWorkspaceTemplates,
  saveUserWorkspaceTemplate,
} from "./workspaceTemplateStore";

import { saveWorkspaceTemplateBodySchema } from "./workspaceTemplateContracts";

export type WorkspaceTemplateApiOptions = {
  dataRoot?: string;
};

function jsonResponse<TBody>(body: TBody, status: number): Response {
  return Response.json(body, { status });
}

function requestMessage(error: unknown, fallbackMessage: string): string {
  return error instanceof Error ? error.message : fallbackMessage;
}

function statusForError(error: unknown): number {
  if (isApplicationStorageError(error)) {
    return 500;
  }

  if (
    error instanceof Error &&
    /^Built-in templates cannot be (edited|deleted)$/.test(error.message)
  ) {
    return 409;
  }

  return 400;
}

function apiErrorResponse(error: unknown, fallbackMessage: string): Response {
  if (isApplicationStorageError(error)) {
    return jsonResponse(applicationStorageUnavailableBody(), 500);
  }

  return jsonResponse({ message: requestMessage(error, fallbackMessage) }, statusForError(error));
}

function templateIdFromRequest(request: Request): string | null {
  const { pathname } = new URL(request.url);
  const prefix = "/api/workspace/templates/";

  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const templateId = decodeURIComponent(pathname.slice(prefix.length));
  return templateId.trim() ? templateId : null;
}

export function createWorkspaceTemplateApiHandler(
  options: WorkspaceTemplateApiOptions = {},
) {
  const dataRoot = options.dataRoot ?? defaultServerDataRoot();

  return async function workspaceTemplateApiHandler(
    request: Request,
  ): Promise<Response> {
    if (request.method === "GET") {
      try {
        return jsonResponse({ templates: await listWorkspaceTemplates({ dataRoot }) }, 200);
      } catch (error) {
        return apiErrorResponse(error, "Workspace template list failed");
      }
    }

    if (request.method === "PUT") {
      const templateId = templateIdFromRequest(request);
      if (!templateId) {
        return jsonResponse({ message: "Invalid workspace template ID" }, 400);
      }

      try {
        const parsedBody = saveWorkspaceTemplateBodySchema.safeParse(
          await request.json(),
        );
        if (!parsedBody.success) {
          return jsonResponse(
            { message: "Invalid workspace template request" },
            400,
          );
        }

        const template = await saveUserWorkspaceTemplate({
          dataRoot,
          template: { ...parsedBody.data, id: templateId },
        });

        return jsonResponse({ template }, 200);
      } catch (error) {
        return apiErrorResponse(error, "Workspace template save failed");
      }
    }

    if (request.method === "DELETE") {
      const templateId = templateIdFromRequest(request);
      if (!templateId) {
        return jsonResponse({ message: "Invalid workspace template ID" }, 400);
      }

      try {
        await deleteUserWorkspaceTemplate({
          dataRoot,
          templateId,
        });

        return jsonResponse({ ok: true }, 200);
      } catch (error) {
        return apiErrorResponse(error, "Workspace template delete failed");
      }
    }

    return jsonResponse({ message: "Method not allowed" }, 405);
  };
}
