import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DesktopRuntimeGate } from "./DesktopRuntimeGate";
import { createDesktopRuntimeController } from "./desktopRuntime";

describe("DesktopRuntimeGate", () => {
  it("shows only the loading state while the desktop runtime is starting", () => {
    const controller = createDesktopRuntimeController({
      connect: vi.fn(() => new Promise<never>(() => undefined)),
      isDesktop: true,
      restart: vi.fn(async () => ({
        token: "desktop-secret",
        url: "http://127.0.0.1:4317",
      })),
    });

    render(
      <DesktopRuntimeGate controller={controller}>
        <div>editor ready</div>
      </DesktopRuntimeGate>,
    );

    expect(
      screen.getByText("ローカルAPIサーバーに接続しています…"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("ローカルAPIサーバーを起動できませんでした。"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "再起動" })).not.toBeInTheDocument();
  });

  it("shows a user-facing startup error and a working restart action", async () => {
    const controller = createDesktopRuntimeController({
      connect: vi.fn(async () => {
        throw new Error("spawn failed");
      }),
      isDesktop: true,
      restart: vi.fn(async () => ({
        token: "desktop-secret",
        url: "http://127.0.0.1:4317",
      })),
    });

    render(
      <DesktopRuntimeGate controller={controller}>
        <div>editor ready</div>
      </DesktopRuntimeGate>,
    );

    expect(
      await screen.findByText("ローカルAPIサーバーを起動できませんでした。"),
    ).toBeInTheDocument();
    expect(screen.getByText("spawn failed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "再起動" }));

    await waitFor(() => {
      expect(screen.getByText("editor ready")).toBeInTheDocument();
    });
  });
});
