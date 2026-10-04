import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StartGuideModal } from "./StartGuideModal";

describe("StartGuideModal", () => {
  it("shows connection guidance without requiring an external CLI", () => {
    render(
      <StartGuideModal
        onDismiss={vi.fn()}
        onIdeaConsult={vi.fn()}
        onOpenPath={vi.fn()}
        workspaceRoot="/workspace/novel"
      />,
    );

    expect(
      screen.getByText(
        "AIの接続は設定から行えます。",
      ),
    ).toBeInTheDocument();
  });
});
