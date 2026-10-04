import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatTokenUsageIndicator } from "./ChatTokenUsageIndicator";

describe("ChatTokenUsageIndicator", () => {
  it("returns null when main context snapshot is unknown", () => {
    const { container } = render(
      <ChatTokenUsageIndicator isRunning={false} mainContextSnapshot={null} sessionUsage={null} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows Codex session token counts without inventing a context percentage", () => {
    render(
      <ChatTokenUsageIndicator
        isRunning={false}
        mainContextSnapshot={null}
        sessionUsage={{ inputTokens: 12000, outputTokens: 4000, totalTokens: 16000 }}
      />,
    );

    const usage = screen.getByLabelText("Codexセッショントークン使用量");
    expect(usage).toHaveTextContent("セッション累計 入力 12k / 出力 4k / 合計 16k");
    expect(usage).not.toHaveTextContent("%");
    expect(usage.querySelector(".chat-token-usage-ring")).toBeNull();
  });

  it("shows latest main context separately from cumulative session usage", () => {
    render(
      <ChatTokenUsageIndicator
        isRunning={false}
        mainContextSnapshot={{
          contextWindowTokens: 200000,
          inputTokens: 80000,
          llmProfileRole: "main",
          modelId: "deepseek-v4-pro",
          providerId: "deepseek",
        }}
        sessionUsage={{
          inputTokens: 10000,
          outputTokens: 2600,
          totalTokens: 12600,
        }}
      />,
    );

    const usage = screen.getByLabelText("メインエージェントコンテキスト使用量");
    expect(usage.querySelector(".chat-token-usage-ring")).not.toBeNull();
    expect(usage.querySelector(".chat-token-usage-tooltip")).toHaveTextContent(
      "メインコンテキスト 80k / 200k (40%) deepseek/deepseek-v4-pro",
    );
    expect(usage.querySelector(".chat-token-usage-tooltip")).toHaveTextContent(
      "セッション累計 入力 10k / 出力 2.6k / 合計 12.6k",
    );
    expect(usage).toHaveStyle({ "--token-usage-degrees": "144deg" });
  });
});
