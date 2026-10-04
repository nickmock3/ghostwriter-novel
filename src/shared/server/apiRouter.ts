import { existsSync } from "node:fs";
import { join } from "node:path";
import { protectPrivateDirectory } from "./privateDirectories";
import { createSiwcApiHandler } from "../../features/siwc/api";
import { getSiwcService } from "../../features/siwc/service";
import { createProductionAiAssistApiHandler } from "../../features/ai-assist/aiAssistApi";
import { createAgentChatApiHandler } from "../../features/ai-chat/agentChatApi";
import { createConversationApiHandler } from "../../features/ai-chat/conversationApi";
import { createLlmProfileApiHandler } from "../../features/ai-agent/llmProfileApi";
import { createLlmSecretApiHandler } from "../../features/ai-agent/llmSecretApi";
import { createModelProviderApiHandler } from "../../features/ai-agent/modelProviderApi";
import { createFileContentApiHandler } from "../../features/editor/fileContentApi";
import { createFileOperationsApiHandler } from "../../features/file-tree/fileOperationsApi";
import { createFileTreeApiHandler } from "../../features/file-tree/fileTreeApi";
import { createDroppedFileImportApiHandler } from "../../features/file-tree/droppedFileImportApi";
import { createWorkspaceApiHandler } from "../../features/workspace/workspaceApi";
import { createDirectoryPickerForPlatform } from "../../features/workspace/workspacePicker";
import { createWorkspaceTemplateApiHandler } from "../../features/workspace/workspaceTemplateApi";
import type { TrustedAgentExtensionCatalog } from "../../features/ai-agent/trustedAgentExtensions";
import { resolveServerDataRoot, type RuntimeEnv } from "./runtimeConfig";

export type ApiHandler = (request: Request) => Response | Promise<Response>;

export type ProductionApiRuntimeOptions = {
  cwd?: string;
  dataRoot?: string;
  env?: RuntimeEnv;
  trustedAgentExtensions?: TrustedAgentExtensionCatalog;
};

export type ApiRouterHandlers = {
  agentChat: ApiHandler;
  aiAssists: ApiHandler;
  siwc: ApiHandler;
  conversations: ApiHandler;
  fileContent: ApiHandler;
  fileImport: ApiHandler;
  fileOperations: ApiHandler;
  fileTree: ApiHandler;
  llmProfiles: ApiHandler;
  llmSecrets: ApiHandler;
  modelProviders: ApiHandler;
  workspace: ApiHandler;
  workspaceTemplates: ApiHandler;
};

type RouteMatcher = {
  handler: keyof ApiRouterHandlers;
  match: (pathname: string) => boolean;
};

const ROUTE_MATCHERS: RouteMatcher[] = [
  { handler: "siwc", match: pathname => pathname.startsWith("/api/siwc/") },
  {
    handler: "workspaceTemplates",
    match: (pathname) =>
      pathname === "/api/workspace/templates" ||
      pathname.startsWith("/api/workspace/templates/"),
  },
  {
    handler: "llmSecrets",
    match: (pathname) =>
      pathname === "/api/llm/secrets" || pathname.startsWith("/api/llm/secrets/"),
  },
  { handler: "workspace", match: (pathname) => pathname === "/api/workspace/select" },
  { handler: "workspace", match: (pathname) => pathname === "/api/workspace/validate" },
  { handler: "workspace", match: (pathname) => pathname === "/api/workspace/template" },
  { handler: "fileTree", match: (pathname) => pathname === "/api/files/tree" },
  { handler: "fileContent", match: (pathname) => pathname === "/api/files/content" },
  { handler: "fileImport", match: (pathname) => pathname === "/api/files/import" },
  { handler: "fileOperations", match: (pathname) => pathname === "/api/files/operations" },
  { handler: "conversations", match: (pathname) => pathname === "/api/conversations" },
  { handler: "agentChat", match: (pathname) => pathname === "/api/chat/messages" },
  { handler: "aiAssists", match: (pathname) => pathname === "/api/ai-assists/execute" },
  { handler: "aiAssists", match: (pathname) => pathname === "/api/ai-assists/proposals" },
  {
    handler: "aiAssists",
    match: (pathname) =>
      pathname === "/api/ai-assists" ||
      (pathname.startsWith("/api/ai-assists/") &&
        pathname !== "/api/ai-assists/execute" &&
        pathname !== "/api/ai-assists/proposals"),
  },
  { handler: "modelProviders", match: (pathname) => pathname === "/api/llm/providers" },
  { handler: "llmProfiles", match: (pathname) => pathname === "/api/llm/profiles" },
];

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

function matchHandler(pathname: string): keyof ApiRouterHandlers | null {
  for (const route of ROUTE_MATCHERS) {
    if (route.match(pathname)) {
      return route.handler;
    }
  }

  return null;
}

export function createProductionApiHandlers(
  options: ProductionApiRuntimeOptions = {},
): ApiRouterHandlers {
  const dataRoot = resolveServerDataRoot({
    cwd: options.cwd ?? process.cwd(),
    dataRoot: options.dataRoot,
    env: options.env ?? process.env,
  });
  const siwcService = (options.env ?? process.env).GHOSTWRITER_ENABLE_SIWC_PREVIEW === "1" ? getSiwcService(dataRoot) : undefined;
  if (existsSync(join(dataRoot, "siwc"))) protectPrivateDirectory(join(dataRoot, "siwc"));
  return {
    siwc: siwcService ? createSiwcApiHandler({ service: siwcService, enabled: true }) : () => new Response(null, { status: 404 }),
    agentChat: createAgentChatApiHandler({
      siwcService,
      dataRoot,
      trustedAgentExtensions: options.trustedAgentExtensions,
    }),
    aiAssists: createProductionAiAssistApiHandler({ dataRoot, siwcService }),
    conversations: createConversationApiHandler({
      siwcService,
      dataRoot,
    }),
    fileContent: createFileContentApiHandler(),
    fileImport: createDroppedFileImportApiHandler({ dataRoot }),
    fileOperations: createFileOperationsApiHandler({ dataRoot }),
    fileTree: createFileTreeApiHandler({ dataRoot }),
    llmProfiles: createLlmProfileApiHandler(),
    llmSecrets: createLlmSecretApiHandler(),
    modelProviders: createModelProviderApiHandler({ siwcService }),
    workspace: createWorkspaceApiHandler({
      dataRoot,
      selectDirectory: createDirectoryPickerForPlatform().selectDirectory,
    }),
    workspaceTemplates: createWorkspaceTemplateApiHandler({ dataRoot }),
  };
}

export function createProductionApiRouter(
  options: ProductionApiRuntimeOptions = {},
): ApiHandler {
  return createApiRouter({ handlers: createProductionApiHandlers(options) });
}

export function createApiRouter(options: { handlers: ApiRouterHandlers }): ApiHandler {
  return async function apiRouter(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/health") {
      if (request.method !== "GET") {
        return jsonResponse({ message: "Method not allowed" }, 405);
      }

      return jsonResponse({ ok: true }, 200);
    }

    const handlerName = matchHandler(pathname);
    if (!handlerName) {
      return jsonResponse({ message: "Not found" }, 404);
    }

    return options.handlers[handlerName](request);
  };
}
