export type AgentTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

function numberFromUsage(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined;
}

export function tokenUsageFromUnknown(value: unknown): AgentTokenUsage | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const inputTokens = numberFromUsage(record.inputTokens ?? record.promptTokens);
  const outputTokens = numberFromUsage(record.outputTokens ?? record.completionTokens);
  const totalTokens = numberFromUsage(record.totalTokens ?? (inputTokens !== undefined || outputTokens !== undefined ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined));
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return null;
  return { ...(inputTokens !== undefined ? { inputTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}), ...(totalTokens !== undefined ? { totalTokens } : {}) };
}

export function addTokenUsage<T extends AgentTokenUsage>(left: T | null, right: T | null): T | null {
  if (!right) return left;
  if (!left) return right;
  return {
    ...left,
    ...right,
    ...(left.inputTokens !== undefined || right.inputTokens !== undefined ? { inputTokens: (left.inputTokens ?? 0) + (right.inputTokens ?? 0) } : {}),
    ...(left.outputTokens !== undefined || right.outputTokens !== undefined ? { outputTokens: (left.outputTokens ?? 0) + (right.outputTokens ?? 0) } : {}),
    ...(left.totalTokens !== undefined || right.totalTokens !== undefined ? { totalTokens: (left.totalTokens ?? 0) + (right.totalTokens ?? 0) } : {}),
  } as T;
}
