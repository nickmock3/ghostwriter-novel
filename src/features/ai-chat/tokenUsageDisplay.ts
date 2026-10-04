import type { Conversation, MainContextSnapshot, TokenUsage } from "./conversationSchemas";

function addTokenCount(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined && right === undefined) {
    return undefined;
  }
  return (left ?? 0) + (right ?? 0);
}

export function sessionTokenUsage(conversation: Conversation | null): TokenUsage | null {
  let hasUsage = false;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let totalTokens: number | undefined;
  for (const message of conversation?.messages ?? []) {
    if (message.role !== "assistant" || !message.tokenUsage) {
      continue;
    }
    hasUsage = true;
    inputTokens = addTokenCount(inputTokens, message.tokenUsage.inputTokens);
    outputTokens = addTokenCount(outputTokens, message.tokenUsage.outputTokens);
    totalTokens = addTokenCount(totalTokens, message.tokenUsage.totalTokens);
  }
  return hasUsage ? { inputTokens, outputTokens, totalTokens } : null;
}

export function formatTokenCount(value: number | undefined): string {
  if (value === undefined) {
    return "--";
  }
  if (value >= 1000) {
    const rounded = Math.round(value / 100) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}k`;
  }
  return String(value);
}

export function latestMainContextSnapshot(conversation: Conversation | null): MainContextSnapshot | null {
  for (let index = (conversation?.messages.length ?? 0) - 1; index >= 0; index -= 1) {
    const message = conversation?.messages[index];
    if (message?.role === "assistant" && message.mainContextSnapshot) {
      return message.mainContextSnapshot;
    }
  }
  return null;
}

export function mainContextUsagePercent(snapshot: MainContextSnapshot): number {
  return Math.min(100, Math.round((snapshot.inputTokens / snapshot.contextWindowTokens) * 100));
}

export function buildTokenUsageTooltip(
  snapshot: MainContextSnapshot | null,
  sessionUsage: TokenUsage | null,
): string {
  const lines: string[] = [];
  if (snapshot) {
    const percent = mainContextUsagePercent(snapshot);
    lines.push(
      `メインコンテキスト ${formatTokenCount(snapshot.inputTokens)} / ${formatTokenCount(snapshot.contextWindowTokens)} (${percent}%) ${snapshot.providerId}/${snapshot.modelId}`,
    );
  } else {
    lines.push("メインコンテキスト 不明");
  }
  if (sessionUsage) {
    lines.push(
      `セッション累計 入力 ${formatTokenCount(sessionUsage.inputTokens)} / 出力 ${formatTokenCount(sessionUsage.outputTokens)} / 合計 ${formatTokenCount(sessionUsage.totalTokens)}`,
    );
  } else {
    lines.push("セッション累計 不明");
  }
  return lines.join("\n");
}

export function tokenUsageDegrees(usagePercentage: number): number {
  return Math.round(usagePercentage * 3.6);
}
