import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentPlanView } from "./AgentPlanView";

describe("AgentPlanView", () => {
  it("renders plan blocks with user-facing item statuses", () => {
    render(
      <AgentPlanView
        plan={{
          items: [
            { id: "inspect", status: "completed", title: "関連ファイルを確認" },
            { detail: "テスト追加から進める", id: "implement", status: "in_progress", title: "実装する" },
            { id: "verify", status: "pending", title: "確認する" },
            { id: "blocked", status: "blocked", title: "外部確認待ち" },
            { id: "skip", status: "skipped", title: "不要な作業" },
          ],
        }}
      />,
    );

    const plan = screen.getByRole("group", { name: "Plan" });
    expect(plan).toHaveTextContent("関連ファイルを確認");
    expect(plan).toHaveTextContent("実装する");
    expect(plan).toHaveTextContent("テスト追加から進める");
    expect(plan.querySelectorAll(".plan-item.is-in_progress")).toHaveLength(1);
    expect(plan).toHaveTextContent("完了");
    expect(plan).toHaveTextContent("進行中");
    expect(plan).toHaveTextContent("待機");
    expect(plan).toHaveTextContent("保留");
    expect(plan).toHaveTextContent("スキップ");
    expect(plan).not.toHaveTextContent("completed");
    expect(plan).not.toHaveTextContent("in_progress");
    expect(plan).not.toHaveTextContent("pending");
    expect(plan).not.toHaveTextContent("blocked");
    expect(plan).not.toHaveTextContent("skipped");
  });
});
