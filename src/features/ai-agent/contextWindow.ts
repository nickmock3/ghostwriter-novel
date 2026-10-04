export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;

export type ResolveContextWindowTokensInput = {
  contextWindowTokens?: number;
  contextWindowTokensOverride?: number;
};

export function resolveContextWindowTokens(input: ResolveContextWindowTokensInput): number {
  if (input.contextWindowTokensOverride !== undefined) {
    return input.contextWindowTokensOverride;
  }
  if (input.contextWindowTokens !== undefined) {
    return input.contextWindowTokens;
  }
  return DEFAULT_CONTEXT_WINDOW_TOKENS;
}
