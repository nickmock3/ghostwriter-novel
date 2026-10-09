import { describe, expect, it, vi } from "vitest";
import { getSubAgentProfile } from "./agentProfiles";
import type { SpawnSubAgentToolInput } from "./tools/agentTools";
import type { LlmProfileRole, ResolvedLlmProfile } from "../llm/profiles/llmProfiles";
import { createSubAgentRuntime } from "./subAgentRuntime";

function resolvedProfile(role: LlmProfileRole): ResolvedLlmProfile {
  return {
    available: true,
    contextWindowTokens: 100_000,
    id: `profile:${role}`,
    llmProfileRole: role,
    maxOutputTokens: 2048,
    modelId: `${role}-model`,
    name: `${role} profile`,
    providerId: "deepseek",
    source: "built-in",
    temperature: 0.2,
  };
}

describe("createSubAgentRuntime", () => {
  it("runs an allowed read-only profile and aggregates its summary and usage", async () => {
    const resolveLlmProfileForRole = vi.fn(resolvedProfile);
    const executeSubAgent = vi.fn(async function* ({ messages, profile }) {
      expect(profile.activeTools).toEqual(["Read", "Glob", "Grep", "Search"]);
      expect(messages).toEqual([
        {
          content: "Purpose: Locate the runtime\n\nFind sub-agent code.",
          role: "user",
        },
      ]);
      yield { text: "Found ", type: "text-delta" as const };
      yield { text: "the runtime", type: "text-delta" as const };
      yield {
        finishReason: "stop",
        totalUsage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
        type: "finish" as const,
      };
    });
    const runtime = createSubAgentRuntime({
      executeSubAgent,
      getProfile: getSubAgentProfile,
      maxSpawns: 1,
      resolveLlmProfileForRole,
    });

    await expect(
      runtime.spawnSubAgent({
        profileId: "read-only-sub-agent",
        prompt: "Find sub-agent code.",
        purpose: "Locate the runtime",
      }),
    ).resolves.toEqual({
      profileId: "read-only-sub-agent",
      status: "completed",
      summary: "Found the runtime",
      tokenUsage: {
        inputTokens: 8,
        llmProfileId: "profile:simple",
        llmProfileRole: "simple",
        modelId: "simple-model",
        outputTokens: 3,
        providerId: "deepseek",
        totalTokens: 11,
      },
    });
    expect(resolveLlmProfileForRole).toHaveBeenCalledWith("simple");
    expect(executeSubAgent).toHaveBeenCalledTimes(1);
  });

  it("keeps profile validation and the run-scoped spawn limit at the runtime boundary", async () => {
    const runtime = createSubAgentRuntime({
      executeSubAgent: async function* () {
        yield { text: "done", type: "text-delta" as const };
      },
      getProfile: getSubAgentProfile,
      maxSpawns: 1,
      resolveLlmProfileForRole: vi.fn(resolvedProfile),
    });

    await expect(
      runtime.spawnSubAgent({
        profileId: "missing-sub-agent",
        prompt: "Look around",
        purpose: "Invalid profile",
      } as unknown as SpawnSubAgentToolInput),
    ).resolves.toEqual({
      message: "Unknown sub-agent profile: missing-sub-agent",
      profileId: "missing-sub-agent",
      status: "error",
    });
    await expect(
      runtime.spawnSubAgent({
        profileId: "workspace-search-sub-agent",
        prompt: "First",
        purpose: "First search",
      }),
    ).resolves.toMatchObject({ status: "completed" });
    await expect(
      runtime.spawnSubAgent({
        profileId: "read-only-sub-agent",
        prompt: "Second",
        purpose: "Second search",
      }),
    ).resolves.toEqual({
      message: "Sub-agent spawn limit exceeded: 1",
      profileId: "read-only-sub-agent",
      status: "error",
    });
  });
});
