import { describe, expect, it } from "vitest";
import { addTokenUsage, tokenUsageFromUnknown } from "./agentTokenUsage";

describe("agent token usage", () => {
  it("normalizes AI SDK and provider token field names, then aggregates them", () => {
    expect(tokenUsageFromUnknown({ promptTokens: 3.8, completionTokens: 2 })).toEqual({
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 5,
    });
    expect(addTokenUsage(
      { inputTokens: 3, modelId: "first", totalTokens: 3 },
      { outputTokens: 2, providerId: "deepseek", totalTokens: 2 },
    )).toEqual({
      inputTokens: 3,
      modelId: "first",
      outputTokens: 2,
      providerId: "deepseek",
      totalTokens: 5,
    });
    expect(tokenUsageFromUnknown({ inputTokens: -1 })).toBeNull();
  });
});
