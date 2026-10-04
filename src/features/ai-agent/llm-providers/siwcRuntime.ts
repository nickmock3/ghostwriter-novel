import { BoundaryError } from "../../siwc/result";
import type { SiwcService } from "../../siwc/service";
import type { LlmProviderConfig } from "../runtimeEnv";
import type { LlmProviderPlugin, ModelProvider } from "./types";
import { createSiwcModelProvider, createSiwcProviderPlugin } from "./siwcResponses";

export async function withSiwcRuntime<T>(options: {
  service: SiwcService;
  modelId: string;
  accountId?: string;
  execute: (runtime: { config: LlmProviderConfig; plugins: LlmProviderPlugin[]; modelProvider: ModelProvider }) => Promise<T>;
}): Promise<T> {
  const result = await options.service.withRun(async run => {
    if (options.accountId && run.accountId !== options.accountId) throw new BoundaryError("account_changed");
    const inventory = await options.service.models();
    if (!inventory.ok) throw new BoundaryError(inventory.error);
    if (inventory.value.accountId !== run.accountId) throw new BoundaryError("account_changed");
    if (!inventory.value.models.some(model => model.slug === options.modelId)) throw new BoundaryError("invalid_model");
    const models = [...inventory.value.models].sort((a, b) => Number(b.slug === options.modelId) - Number(a.slug === options.modelId));
    return options.execute({
      config: { defaultProviderId: "openai-chatgpt", defaultModelId: options.modelId, providers: { anthropic: {}, deepseek: {}, gemini: {}, openai: {} } },
      plugins: [createSiwcProviderPlugin(run, models)],
      modelProvider: { ...createSiwcModelProvider(run, models), siwc: { accountId: run.accountId, modelId: options.modelId } },
    });
  });
  if (!result.ok) throw new BoundaryError(result.error);
  return result.value;
}
