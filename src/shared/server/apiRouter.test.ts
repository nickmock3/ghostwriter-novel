import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { workspaceIdForRoot } from "../../features/ai-chat/conversationHistory";
import { resolveWorkspaceRoot } from "../../features/workspace/workspacePaths";
import { createTrustedAgentExtensionCatalog } from "../../features/ai-agent/trustedAgentExtensions";
import {
  createApiRouter,
  createProductionApiHandlers,
  type ApiHandler,
  type ApiRouterHandlers,
} from "./apiRouter";

const routeCases = [
  ["GET", "/api/siwc/status", "siwc"],
  ["POST", "/api/siwc/login", "siwc"],
  ["POST", "/api/workspace/select", "workspace"],
  ["POST", "/api/workspace/validate", "workspace"],
  ["POST", "/api/workspace/template", "workspace"],
  ["GET", "/api/workspace/templates", "workspaceTemplates"],
  ["PUT", "/api/workspace/templates/user-template", "workspaceTemplates"],
  ["GET", "/api/files/tree?workspaceRoot=%2Ftmp%2Fnovel", "fileTree"],
  ["PUT", "/api/files/content", "fileContent"],
  ["POST", "/api/files/import", "fileImport"],
  ["POST", "/api/files/operations", "fileOperations"],
  ["PATCH", "/api/conversations", "conversations"],
  ["POST", "/api/chat/messages", "agentChat"],
  ["GET", "/api/llm/providers", "modelProviders"],
  ["GET", "/api/llm/profiles", "llmProfiles"],
  ["GET", "/api/llm/secrets", "llmSecrets"],
  ["DELETE", "/api/llm/secrets/openai", "llmSecrets"],
] as const satisfies ReadonlyArray<
  readonly [method: string, path: string, handler: keyof ApiRouterHandlers]
>;

function createHandlers() {
  const handlers = {} as Record<keyof ApiRouterHandlers, ReturnType<typeof vi.fn>>;

  for (const [, , handlerName] of routeCases) {
    handlers[handlerName] ??= vi.fn(async (request: Request) => {
      return Response.json({
        handler: handlerName,
        method: request.method,
        url: request.url,
      });
    });
  }

  return handlers as unknown as ApiRouterHandlers;
}

describe("createApiRouter", () => {
  it.each(routeCases)(
    "routes %s %s to the %s handler without losing the request URL",
    async (method, path, handlerName) => {
      const handlers = createHandlers();
      const router = createApiRouter({ handlers });
      const request = new Request(`http://127.0.0.1:4317${path}`, { method });

      const response = await router(request);

      expect(response.status).toBe(200);
      expect(handlers[handlerName]).toHaveBeenCalledOnce();
      expect(handlers[handlerName]).toHaveBeenCalledWith(request);
      await expect(response.json()).resolves.toMatchObject({
        handler: handlerName,
        method,
        url: request.url,
      });
    },
  );

  it("serves a health endpoint without invoking feature handlers", async () => {
    const handlers = createHandlers();
    const router = createApiRouter({ handlers });

    const response = await router(new Request("http://127.0.0.1:4317/health"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    for (const handler of Object.values(handlers) as ApiHandler[]) {
      expect(handler).not.toHaveBeenCalled();
    }
  });

  it("rejects unsupported health methods", async () => {
    const router = createApiRouter({ handlers: createHandlers() });

    const response = await router(
      new Request("http://127.0.0.1:4317/health", { method: "POST" }),
    );

    expect(response.status).toBe(405);
  });

  it("returns 404 for unknown and lookalike API paths", async () => {
    const router = createApiRouter({ handlers: createHandlers() });

    for (const path of ["/api/unknown", "/api/files/tree-extra", "/not-api"]) {
      const response = await router(new Request(`http://127.0.0.1:4317${path}`));
      expect(response.status).toBe(404);
    }
  });
});

describe("createProductionApiHandlers", () => {

  it("validates trusted agent extensions while composing the production runtime", () => {
    const trustedAgentExtensions = createTrustedAgentExtensionCatalog({
      profileToolGrants: { "main-agent": ["ProjectLookup"] },
      skillPlugins: [],
      toolPlugins: [],
    });

    expect(() => createProductionApiHandlers({ trustedAgentExtensions })).not.toThrow();
  });
});

describe("createProductionApiHandlers", () => {
  it("injects the same explicit data root into conversation and template handlers", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-runtime-data-"));
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-workspace-"));
    const handlers = createProductionApiHandlers({ dataRoot });

    try {
      const conversationResponse = await handlers.conversations(
        new Request("http://localhost/api/conversations", {
          body: JSON.stringify({ workspaceRoot }),
          method: "POST",
        }),
      );
      const conversationBody = await conversationResponse.json();
      const templateResponse = await handlers.workspaceTemplates(
        new Request("http://localhost/api/workspace/templates/runtime-template", {
          body: JSON.stringify({
            items: [{ content: "runtime", kind: "file", path: "README.md" }],
            name: "Runtime template",
          }),
          method: "PUT",
        }),
      );

      expect(conversationResponse.status).toBe(201);
      expect(templateResponse.status).toBe(200);
      const workspaceId = workspaceIdForRoot(await resolveWorkspaceRoot(workspaceRoot));
      expect(
        JSON.parse(
          readFileSync(
            path.join(
              dataRoot,
              "conversations",
              workspaceId,
              `${conversationBody.conversation.id}.json`,
            ),
            "utf8",
          ),
        ).id,
      ).toBe(conversationBody.conversation.id);
      expect(
        JSON.parse(readFileSync(path.join(dataRoot, "workspace-templates.json"), "utf8"))
          .templates[0].id,
      ).toBe("runtime-template");
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });
});
