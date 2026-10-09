import {
  listAvailableLlmProviders,
  type LlmProviderPlugin,
} from "./modelProvider";
import { createLlmRuntime } from "./llmRuntime";
import type { LlmSecretStore } from "./secrets/llmSecretStore";
import type { LlmProviderConfig } from "./runtimeEnv";

// The composition root supplies the connection's inventory without importing SIWC here.
export type ConnectedModelInventory = {
  models: (signal?: AbortSignal) => Promise<
    | { ok: true; value: { models: readonly { slug: string; displayName: string }[] } }
    | { ok: false }
  >;
};

export type ModelProviderApiOptions = {
  siwcService?: ConnectedModelInventory;
  config?: LlmProviderConfig;
  llmProviderPlugins?: LlmProviderPlugin[];
  secretStore?: LlmSecretStore;
};

function jsonResponse<TBody>(body: TBody, status: number): Response {
  return Response.json(body, { status });
}

export function createModelProviderApiHandler(options: ModelProviderApiOptions = {}) {
  const runtime = createLlmRuntime(options);

  return async function modelProviderApiHandler(request: Request): Promise<Response> {
    if (request.method !== "GET") {
      return jsonResponse({ message: "Method not allowed" }, 405);
    }

    const { config, plugins } = await runtime.resolve();

    const providers = listAvailableLlmProviders({ config, plugins, requireTools: true });
    if (options.siwcService) {
      const inventory = await options.siwcService.models(request.signal);
      providers.push({ id: "openai-chatgpt", displayName: "ChatGPT プラン", models: inventory.ok ? inventory.value.models.map(model => ({ id: model.slug, displayName: model.displayName, available: true, supportsTools: true, supportsTemperature: false })) : [] });
    }
    return jsonResponse({ providers }, 200);
  };
}
