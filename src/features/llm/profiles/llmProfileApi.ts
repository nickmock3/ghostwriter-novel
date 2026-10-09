import {
  createDefaultRoleAssignments,
  listLlmProfiles,
  type LlmProfile,
  type LlmProfileRoleAssignments,
} from "./llmProfiles";
import {
  listAvailableLlmProviders,
  type LlmProviderPlugin,
} from "../modelProvider";
import { createLlmRuntime } from "../llmRuntime";
import type { LlmSecretStore } from "../secrets/llmSecretStore";
import type { LlmProviderConfig } from "../runtimeEnv";

export type LlmProfileApiOptions = {
  config?: LlmProviderConfig;
  llmProviderPlugins?: LlmProviderPlugin[];
  secretStore?: LlmSecretStore;
};

function jsonResponse<TBody>(body: TBody, status: number): Response {
  return Response.json(body, { status });
}

export function createLlmProfileApiHandler(options: LlmProfileApiOptions = {}) {
  const runtime = createLlmRuntime(options);

  return async function llmProfileApiHandler(request: Request): Promise<Response> {
    if (request.method !== "GET") {
      return jsonResponse({ message: "Method not allowed" }, 405);
    }

    const { config: resolvedConfig, plugins } = await runtime.resolve();
    const providers = listAvailableLlmProviders({
      config: resolvedConfig,
      plugins,
      requireTools: true,
    });
    const profiles = listLlmProfiles({ providers });
    const roleAssignments = createDefaultRoleAssignments({
      defaultProviderId: resolvedConfig.defaultProviderId,
      providers,
    });

    return jsonResponse<{
      profiles: Array<LlmProfile & { available: boolean; unavailableReason?: string }>;
      roleAssignments: LlmProfileRoleAssignments;
    }>({ profiles, roleAssignments }, 200);
  };
}
