import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  resolveContextWindowTokens,
} from "./contextWindow";

describe("resolveContextWindowTokens", () => {
  it("falls back to 200000 when model metadata is unknown", () => {
    expect(resolveContextWindowTokens({})).toBe(200_000);
    expect(DEFAULT_CONTEXT_WINDOW_TOKENS).toBe(200_000);
  });

  it("prefers a user profile override over model metadata and fallback", () => {
    expect(
      resolveContextWindowTokens({
        contextWindowTokens: 1_000_000,
        contextWindowTokensOverride: 128_000,
      }),
    ).toBe(128_000);
  });

  it("uses model metadata when no profile override exists", () => {
    expect(resolveContextWindowTokens({ contextWindowTokens: 400_000 })).toBe(400_000);
  });
});
