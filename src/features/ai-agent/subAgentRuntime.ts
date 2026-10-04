import type { ModelMessage } from "ai";
import type { AgentProfile } from "./agentProfiles";
import type { SpawnSubAgentToolInput, SpawnSubAgentToolOutput } from "./agentTools";
import type { LlmProfileRole, ResolvedLlmProfile } from "./llmProfiles";
import { addTokenUsage, tokenUsageFromUnknown, type AgentTokenUsage } from "./agentTokenUsage";

export type SubAgentLoopEvent =
  | { text: string; type: "text-delta" }
  | { finishReason: unknown; totalUsage: unknown; type: "finish" };

export type ExecuteSubAgentOptions = {
  messages: ModelMessage[];
  profile: AgentProfile;
};

export type ExecuteSubAgent = (
  options: ExecuteSubAgentOptions,
) => AsyncIterable<SubAgentLoopEvent>;

type SubAgentTokenUsage = AgentTokenUsage & {
  inputTokens?: number;
  llmProfileId?: string;
  llmProfileRole?: string;
  modelId?: string;
  outputTokens?: number;
  providerId?: string;
  totalTokens?: number;
};

export type CreateSubAgentRuntimeOptions = {
  executeSubAgent: ExecuteSubAgent;
  getProfile: (profileId: string) => AgentProfile | null;
  maxSpawns: number;
  resolveLlmProfileForRole: (
    role: LlmProfileRole,
  ) => Promise<ResolvedLlmProfile> | ResolvedLlmProfile;
};

export type SubAgentRuntime = {
  spawnSubAgent: (input: SpawnSubAgentToolInput) => Promise<SpawnSubAgentToolOutput>;
};


function createSubAgentMessages(input: SpawnSubAgentToolInput): ModelMessage[] {
  return [
    {
      content: [`Purpose: ${input.purpose}`, "", input.prompt].join("\n"),
      role: "user",
    },
  ];
}

export function createSubAgentRuntime(options: CreateSubAgentRuntimeOptions): SubAgentRuntime {
  let spawnCount = 0;

  return {
    spawnSubAgent: async (input) => {
      const profile = options.getProfile(input.profileId);
      if (!profile) {
        return {
          message: `Unknown sub-agent profile: ${input.profileId}`,
          profileId: input.profileId,
          status: "error",
        };
      }
      if (spawnCount >= options.maxSpawns) {
        return {
          message: `Sub-agent spawn limit exceeded: ${options.maxSpawns}`,
          profileId: input.profileId,
          status: "error",
        };
      }
      spawnCount += 1;

      let summary = "";
      let tokenUsage: SubAgentTokenUsage | null = null;
      try {
        const subAgentResolvedLlmProfile = await options.resolveLlmProfileForRole(
          profile.llmProfileRole,
        );
        for await (const event of options.executeSubAgent({
          messages: createSubAgentMessages(input),
          profile,
        })) {
          if (event.type === "text-delta") {
            summary += event.text;
          }
          if (event.type === "finish") {
            const finishUsage = tokenUsageFromUnknown(event.totalUsage);
            tokenUsage = addTokenUsage(
              tokenUsage,
              finishUsage
                ? {
                    ...finishUsage,
                    llmProfileId: subAgentResolvedLlmProfile.id,
                    llmProfileRole: subAgentResolvedLlmProfile.llmProfileRole,
                    modelId: subAgentResolvedLlmProfile.modelId,
                    providerId: subAgentResolvedLlmProfile.providerId,
                  }
                : null,
            );
          }
        }
      } catch (error) {
        return {
          message: error instanceof Error ? error.message : "Sub-agent execution failed",
          profileId: input.profileId,
          status: "error",
        };
      }

      return {
        profileId: input.profileId,
        status: "completed",
        summary: summary.trim(),
        ...(tokenUsage ? { tokenUsage } : {}),
      };
    },
  };
}
