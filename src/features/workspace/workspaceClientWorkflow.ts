import { apiFetch } from "../../shared/client/apiTransport";
import { selectDesktopWorkspaceDirectory } from "../../shared/client/desktopWorkspaceDialog";
import { isTauriDesktop } from "../../shared/client/desktopRuntime";
import {
  workspaceSelectErrorSchema,
  workspaceSelectSuccessSchema,
  workspaceTemplateRequestSchema,
  workspaceTemplateSuccessSchema,
  workspaceValidateRequestSchema,
  type WorkspaceTemplateRequest,
  type WorkspaceTemplateSuccess,
} from "./workspaceSchemas";
import {
  workspaceTemplateListResponseSchema,
  type WorkspaceTemplate,
} from "./workspaceTemplateContracts";

async function parseResponseBody(response: Response): Promise<unknown> {
  return response.json();
}

function getErrorMessage(body: unknown, fallback: string): string {
  const parsedError = workspaceSelectErrorSchema.safeParse(body);
  return parsedError.success ? parsedError.data.message : fallback;
}

async function requireSuccessfulResponse(
  response: Response,
  fallbackErrorMessage: string,
): Promise<unknown> {
  const body = await parseResponseBody(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(body, fallbackErrorMessage));
  }

  return body;
}

export async function validateWorkspaceRoot(workspaceRoot: string): Promise<string> {
  const request = workspaceValidateRequestSchema.parse({ workspaceRoot });
  const response = await apiFetch("/api/workspace/validate", {
    body: JSON.stringify(request),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const body = await requireSuccessfulResponse(response, "ワークスペース検証に失敗しました");
  return workspaceSelectSuccessSchema.parse(body).workspaceRoot;
}

export async function pickWorkspaceRoot(): Promise<string | null> {
  if (isTauriDesktop()) {
    const selectedPath = await selectDesktopWorkspaceDirectory();
    return selectedPath === null ? null : validateWorkspaceRoot(selectedPath);
  }

  const response = await apiFetch("/api/workspace/select", { method: "POST" });
  const body = await requireSuccessfulResponse(response, "ワークスペース選択に失敗しました");
  return workspaceSelectSuccessSchema.parse(body).workspaceRoot;
}

export async function listWorkspaceTemplates(): Promise<WorkspaceTemplate[]> {
  const response = await apiFetch("/api/workspace/templates");
  const body = await requireSuccessfulResponse(response, "テンプレート一覧の取得に失敗しました");
  return workspaceTemplateListResponseSchema.parse(body).templates;
}

export async function applyWorkspaceTemplate(
  request: WorkspaceTemplateRequest,
): Promise<WorkspaceTemplateSuccess> {
  const parsedRequest = workspaceTemplateRequestSchema.parse(request);
  const response = await apiFetch("/api/workspace/template", {
    body: JSON.stringify(parsedRequest),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const body = await requireSuccessfulResponse(response, "テンプレート適用に失敗しました");
  return workspaceTemplateSuccessSchema.parse(body);
}
