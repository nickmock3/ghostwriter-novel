import type { CSSProperties } from "react";
import type { MainContextSnapshot, TokenUsage } from "./conversationSchemas";
import { buildTokenUsageTooltip, mainContextUsagePercent, tokenUsageDegrees } from "./tokenUsageDisplay";

export type ChatTokenUsageIndicatorProps = {
  isRunning: boolean;
  mainContextSnapshot: MainContextSnapshot | null;
  sessionUsage: TokenUsage | null;
};

function sessionOnlyTokenUsageTooltip(sessionUsage: TokenUsage): string {
  const tooltip = buildTokenUsageTooltip(null, sessionUsage);
  return tooltip.split("\n").find((line) => line.startsWith("セッション累計")) ?? tooltip;
}

export function ChatTokenUsageIndicator({
  isRunning,
  mainContextSnapshot,
  sessionUsage,
}: ChatTokenUsageIndicatorProps) {
  if (!mainContextSnapshot && !sessionUsage) {
    return null;
  }

  if (mainContextSnapshot) {
    const mainContextPercent = mainContextUsagePercent(mainContextSnapshot);
    const tokenUsageTitle = buildTokenUsageTooltip(mainContextSnapshot, sessionUsage);
    const tokenUsageStyle = {
      "--token-usage-degrees": `${tokenUsageDegrees(mainContextPercent)}deg`,
    } as CSSProperties;

    return (
      <div
        aria-label="メインエージェントコンテキスト使用量"
        className={`chat-token-usage${isRunning ? " is-running" : ""}`}
        style={tokenUsageStyle}
      >
        <span className="chat-token-usage-ring" aria-hidden="true" />
        <span className="chat-token-usage-tooltip" role="tooltip">
          {tokenUsageTitle}
        </span>
      </div>
    );
  }

  const tokenUsageTitle = sessionOnlyTokenUsageTooltip(sessionUsage!);

  return (
    <div
      aria-label="Codexセッショントークン使用量"
      className={`chat-token-usage chat-token-usage--session-only${isRunning ? " is-running" : ""}`}
    >
      <span className="chat-token-usage-tooltip" role="tooltip">
        {tokenUsageTitle}
      </span>
    </div>
  );
}
