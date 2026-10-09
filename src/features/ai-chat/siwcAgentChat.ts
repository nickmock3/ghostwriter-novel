import { createSiwcModelProvider, createSiwcProviderPlugin } from "../siwc/siwcResponses";
import type { SiwcService } from "../siwc/service";
import { BoundaryError } from "../siwc/result";
import { bindConversationSiwc, createConversation, getConversation } from "./conversationHistory";
import { createAgentChatApplicationService } from "./agentChatApplicationService";
import type { AgentChatApplicationServiceOptions, AgentChatApplicationInput, AgentChatApplicationEvent } from "./agentChatApplicationTypes";

// 通常APIと同じapplication service / runAgentLoop / 編集保存を使用する。
// leaseは圧縮・子エージェント・本文生成・tool・永続化を含めて保持する。
export async function runSiwcAgentChat(options: {
  trustedAgentExtensions?: AgentChatApplicationServiceOptions["trustedAgentExtensions"];
  dataRoot: string;
  service: SiwcService;
  input: AgentChatApplicationInput;
  onEvent?: (event: AgentChatApplicationEvent) => void;
}) {
  const result = await options.service.withRun(async run => {
    const inventory = await options.service.models();
    if (!inventory.ok) throw new BoundaryError(inventory.error);
    if (inventory.value.accountId !== run.accountId) throw new BoundaryError("account_changed");
    const existing = options.input.conversationId ? await getConversation({ dataRoot: options.dataRoot, workspaceRoot: options.input.workspaceRoot, conversationId: options.input.conversationId }) : undefined;
    const selected = options.input.modelSelection ?? options.input.userProfiles?.find(profile => profile.id === options.input.llmProfileId);
    if (selected && selected.providerId !== "openai-chatgpt") throw new BoundaryError("unsupported_request");
    const modelId = selected?.modelId ?? existing?.siwc?.modelId;
    if (!modelId || !inventory.value.models.some(model => model.slug === modelId)) throw new BoundaryError("invalid_model");
    const conversation = existing ?? await createConversation({ dataRoot: options.dataRoot, workspaceRoot: options.input.workspaceRoot });
    await bindConversationSiwc({ dataRoot: options.dataRoot, workspaceRoot: options.input.workspaceRoot, conversationId: conversation.id, accountId: run.accountId, modelId });
    // 指定modelを全roleの既定へ。API-key profileへの暗黙fallbackは行わない。
    const models = [...inventory.value.models].sort((a, b) => Number(b.slug === modelId) - Number(a.slug === modelId));
    const modelProvider = { ...createSiwcModelProvider(run, models), siwc: { accountId: run.accountId, modelId } };
    const application = createAgentChatApplicationService({
      dataRoot: options.dataRoot,
      trustedAgentExtensions: options.trustedAgentExtensions,
      modelProvider,
      llmProviderPlugins: [createSiwcProviderPlugin(run, models)],
      llmProviderConfig: { defaultProviderId: "openai-chatgpt", defaultModelId: modelId, providers: { anthropic: {}, deepseek: {}, gemini: {}, openai: {} } },
    });
    return application.runAgentChat({ ...options.input, conversationId: conversation.id, llmProfileId: undefined, modelSelection: { providerId: "openai-chatgpt", modelId } }, options.onEvent);
  });
  if (!result.ok) throw new BoundaryError(result.error);
  return result.value;
}
