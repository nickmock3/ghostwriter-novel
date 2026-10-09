import type { SiwcService } from "../siwc/service";
import type { AgentProfile } from "../ai-agent/agentProfiles";
import type { LlmProfile, LlmProfileRole, ResolvedLlmProfile } from "../llm/profiles/llmProfiles";
import type { LlmSecretStore } from "../llm/secrets/llmSecretStore";
import type {
  LlmProviderPlugin,
  ModelProvider,
  ResolvedChatModelSelection,
} from "../llm/modelProvider";
import type { LlmProviderConfig } from "../llm/runtimeEnv";
import type {
  AgentLoopEvent,
  RunAgentLoopOptions,
} from "../ai-agent/runAgentLoop";
import type { TrustedAgentExtensionCatalog } from "../ai-agent/trustedAgentExtensions";
import type { AgentChatStreamEffect } from "./agentChatEventAccumulator";
import type { CompactConversationResult } from "./conversationCompaction";
import type { Conversation } from "./conversationSchemas";
import type {
  DroppedTextFileContext,
  DroppedTextFileInput,
  DroppedTextFileMetadata,
} from "./droppedTextFiles";

export type RunAgentLoopFunction = (
  options: RunAgentLoopOptions,
) => AsyncGenerator<AgentLoopEvent> | AsyncIterable<AgentLoopEvent>;

export type ModelProviderFactory = (selection: ResolvedChatModelSelection) => ModelProvider;

export type AgentChatCompactConversationHandler = (options: {
  compactedThroughMessageId: string;
  conversationId: string;
  dataRoot: string;
  workspaceRoot: string;
}) => Promise<CompactConversationResult>;

export type AgentChatApplicationServiceOptions = {
  siwcService?: SiwcService;
  compactConversation?: AgentChatCompactConversationHandler;
  dataRoot?: string;
  llmProviderConfig?: LlmProviderConfig;
  llmProviderPlugins?: LlmProviderPlugin[];
  modelProvider?: ModelProvider;
  modelProviderFactory?: ModelProviderFactory;
  runAgentLoop?: RunAgentLoopFunction;
  secretStore?: LlmSecretStore;
  trustedAgentExtensions?: TrustedAgentExtensionCatalog;
};

export type AgentChatApplicationInput = {
  autoCompactEnabled: boolean;
  autoCompactThresholdRatio: number;
  content: string;
  conversationId?: string;
  currentFilePath?: string;
  droppedTextFiles?: DroppedTextFileInput[];
  llmProfileId?: string;
  mode?: "chat" | "editor";
  modelSelection?: {
    modelId: string;
    providerId: string;
  };
  userProfiles?: LlmProfile[];
  workspaceRoot: string;
};

export type AgentChatApplicationEvent =
  | AgentChatStreamEffect
  | { conversation: Conversation; type: "conversation" }
  | {
      file: {
        index: number;
        name: string;
        sizeBytes: number;
        status: "pending" | "placed" | "failed" | "unplaced";
        targetPath?: string;
      };
      type: "dropped-text-file-status";
    };

export type AgentChatApplicationResult = {
  conversation: Conversation;
};

export type AgentChatExecutionContext = {
  compactConversation: AgentChatCompactConversationHandler;
  currentFilePath: string | undefined;
  modelProvider: ModelProvider;
  profile: AgentProfile;
  resolveRoleProfile: (role: LlmProfileRole) => ResolvedLlmProfile;
};

export type StagedDroppedTextFiles = {
  context: DroppedTextFileContext;
  files: DroppedTextFileMetadata[];
};

export type PreparedConversation = {
  droppedTextFiles?: StagedDroppedTextFiles;
  userConversation: Conversation;
};

export type DroppedTextFileStatus = Extract<
  AgentChatApplicationEvent,
  { type: "dropped-text-file-status" }
>["file"]["status"];

export type DroppedTextFileStatusTracker = {
  emitPending: () => void;
  finalizePending: (status: Extract<DroppedTextFileStatus, "failed" | "unplaced">) => void;
  updatePlacement: (
    droppedFileId: string,
    status: Extract<DroppedTextFileStatus, "failed" | "placed">,
    targetPath: string,
  ) => void;
};
