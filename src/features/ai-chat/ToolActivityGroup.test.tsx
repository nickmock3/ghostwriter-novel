import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolActivityGroup } from "./ToolActivityGroup";

describe("ToolActivityGroup", () => {
  it("shows writing progress even when tool history is collapsed", () => {
    render(<ToolActivityGroup activities={[{toolCallId: "w1", toolName: "DelegateWriting", label: "本文作成 chapter.txt", status: "running", detail: "本文を生成中・1200文字受信"}]} groupId="w1" isExpanded={false} onToggle={() => {}} />);
    expect(screen.getByText(/本文を生成中・1200文字受信/)).toBeVisible();
  });
  it("marks running state with an icon and accessible status label", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <ToolActivityGroup
        activities={[
          {
            detail: "READMEを確認しています",
            label: "Read README.md",
            status: "running",
            toolCallId: "read-1",
            toolName: "Read",
          },
        ]}
        groupId="read-1"
        isExpanded={false}
        onToggle={onToggle}
      />,
    );

    const summary = screen.getByRole("button", { name: /ツール履歴 1件/ });
    expect(summary).toHaveTextContent("実行中");
    expect(summary).toHaveTextContent("Read");

    fireEvent.click(summary);
    expect(onToggle).toHaveBeenCalled();

    rerender(
      <ToolActivityGroup
        activities={[
          {
            detail: "READMEを確認しています",
            label: "Read README.md",
            status: "running",
            toolCallId: "read-1",
            toolName: "Read",
          },
        ]}
        groupId="read-1"
        isExpanded
        onToggle={onToggle}
      />,
    );

    const toolStatus = screen.getByLabelText("Read 実行中");
    expect(toolStatus).toHaveTextContent("running");
    expect(toolStatus.querySelector("svg")).not.toBeNull();
  });

  it("does not replay completion feedback without feedbackToolCallIds", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <ToolActivityGroup
        activities={[
          {
            createdAt: "2026-05-09T00:01:00.500Z",
            detail: "1件",
            id: "activity-1",
            label: "Read README.md",
            status: "completed",
            toolCallId: "read-1",
            toolName: "Read",
          },
        ]}
        groupId="activity-1"
        isExpanded={false}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /ツール履歴 1件/ }));
    expect(onToggle).toHaveBeenCalled();

    rerender(
      <ToolActivityGroup
        activities={[
          {
            createdAt: "2026-05-09T00:01:00.500Z",
            detail: "1件",
            id: "activity-1",
            label: "Read README.md",
            status: "completed",
            toolCallId: "read-1",
            toolName: "Read",
          },
        ]}
        groupId="activity-1"
        isExpanded
        onToggle={onToggle}
      />,
    );

    const completedStatus = screen.getByLabelText("Read 完了");
    const completedActivity = completedStatus.closest(".tool-activity");
    expect(completedActivity).toHaveClass("is-completed");
    expect(completedActivity).not.toHaveClass("has-completion-feedback");
  });

  it("expands a tool history summary back to individual activities", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <ToolActivityGroup
        activities={[
          {
            createdAt: "2026-05-09T00:01:00.000Z",
            detail: "ok",
            id: "activity-1",
            label: "Read README.md",
            status: "completed",
            toolCallId: "read-1",
            toolName: "Read",
          },
          {
            createdAt: "2026-05-09T00:01:01.000Z",
            detail: "failed",
            id: "activity-2",
            label: "Grep heroine",
            status: "failed",
            toolCallId: "grep-1",
            toolName: "Grep",
          },
        ]}
        groupId="activity-1:activity-2"
        isExpanded={false}
        onToggle={onToggle}
      />,
    );

    const summary = screen.getByRole("button", { name: /ツール履歴 2件/ });
    expect(summary).toHaveTextContent("一部失敗");
    expect(summary).toHaveTextContent("Read・Grep");
    expect(screen.queryByText("Read README.md")).not.toBeInTheDocument();

    fireEvent.click(summary);
    expect(onToggle).toHaveBeenCalled();

    rerender(
      <ToolActivityGroup
        activities={[
          {
            createdAt: "2026-05-09T00:01:00.000Z",
            detail: "ok",
            id: "activity-1",
            label: "Read README.md",
            status: "completed",
            toolCallId: "read-1",
            toolName: "Read",
          },
          {
            createdAt: "2026-05-09T00:01:01.000Z",
            detail: "failed",
            id: "activity-2",
            label: "Grep heroine",
            status: "failed",
            toolCallId: "grep-1",
            toolName: "Grep",
          },
        ]}
        groupId="activity-1:activity-2"
        isExpanded
        onToggle={onToggle}
      />,
    );

    expect(screen.getByText("Read README.md")).toBeInTheDocument();
    expect(screen.getByText("Grep heroine")).toBeInTheDocument();
    expect(screen.getByLabelText("Grep 失敗")).toBeInTheDocument();
  });

  it("summarizes repeated tool names before expanding", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <ToolActivityGroup
        activities={[
          {
            createdAt: "2026-05-09T00:01:00.500Z",
            detail: "1件",
            id: "activity-1",
            label: "Read README.md",
            status: "completed",
            toolCallId: "read-1",
            toolName: "Read",
          },
          {
            createdAt: "2026-05-09T00:01:00.600Z",
            detail: "検索に失敗しました",
            id: "activity-2",
            label: "Grep heroine",
            status: "failed",
            toolCallId: "grep-1",
            toolName: "Grep",
          },
          {
            createdAt: "2026-05-09T00:01:00.700Z",
            detail: "1件",
            id: "activity-3",
            label: "Read notes.md",
            status: "completed",
            toolCallId: "read-2",
            toolName: "Read",
          },
        ]}
        groupId="activity-1:activity-2:activity-3"
        isExpanded={false}
        onToggle={onToggle}
      />,
    );

    const summary = screen.getByRole("button", { name: /ツール履歴 3件/ });
    expect(summary).toHaveTextContent("一部失敗");
    expect(summary).toHaveTextContent("Read x2・Grep");
    expect(screen.queryByText("Read README.md")).not.toBeInTheDocument();
    expect(screen.queryByText("Grep heroine")).not.toBeInTheDocument();

    fireEvent.click(summary);
    expect(onToggle).toHaveBeenCalled();

    rerender(
      <ToolActivityGroup
        activities={[
          {
            createdAt: "2026-05-09T00:01:00.500Z",
            detail: "1件",
            id: "activity-1",
            label: "Read README.md",
            status: "completed",
            toolCallId: "read-1",
            toolName: "Read",
          },
          {
            createdAt: "2026-05-09T00:01:00.600Z",
            detail: "検索に失敗しました",
            id: "activity-2",
            label: "Grep heroine",
            status: "failed",
            toolCallId: "grep-1",
            toolName: "Grep",
          },
          {
            createdAt: "2026-05-09T00:01:00.700Z",
            detail: "1件",
            id: "activity-3",
            label: "Read notes.md",
            status: "completed",
            toolCallId: "read-2",
            toolName: "Read",
          },
        ]}
        groupId="activity-1:activity-2:activity-3"
        isExpanded
        onToggle={onToggle}
      />,
    );

    expect(screen.getByText("Read README.md")).toBeInTheDocument();
    expect(screen.getByText("Grep heroine")).toBeInTheDocument();
    expect(screen.getByLabelText("Grep 失敗")).toBeInTheDocument();
  });
});
