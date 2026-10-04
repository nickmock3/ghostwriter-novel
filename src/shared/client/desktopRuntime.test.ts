import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopRuntimeController } from "./desktopRuntime";

describe("createDesktopRuntimeController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is immediately ready outside Tauri", async () => {
    const controller = createDesktopRuntimeController({
      connect: vi.fn(),
      isDesktop: false,
      restart: vi.fn(),
    });

    await controller.start();

    expect(controller.getSnapshot()).toEqual({ status: "ready" });
  });

  it("exposes startup failure and recovers through restart", async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error("sidecar exited"))
      .mockResolvedValueOnce({
        token: "desktop-secret",
        url: "http://127.0.0.1:4317",
      });
    const restart = vi.fn(async () => ({
      token: "desktop-secret-2",
      url: "http://127.0.0.1:4318",
    }));
    const controller = createDesktopRuntimeController({
      connect,
      isDesktop: true,
      restart,
    });

    await controller.start();
    expect(controller.getSnapshot()).toEqual({
      message: "sidecar exited",
      status: "error",
    });

    await controller.restart();
    expect(restart).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toEqual({ status: "ready" });
  });

  it("moves to an error state when a running sidecar becomes unavailable", async () => {
    const controller = createDesktopRuntimeController({
      connect: vi.fn(async () => ({
        token: "desktop-secret",
        url: "http://127.0.0.1:4317",
      })),
      isDesktop: true,
      restart: vi.fn(),
    });
    await controller.start();

    controller.markUnavailable();

    expect(controller.getSnapshot()).toEqual({
      message: "ローカルAPIサーバーとの接続が切断されました。",
      status: "error",
    });
  });

  it("keeps the startup gate visible and retries while the sidecar is still starting", async () => {
    vi.useFakeTimers();
    const connect = vi
      .fn()
      .mockRejectedValueOnce("ローカルAPIサーバーを起動しています。")
      .mockRejectedValueOnce(new Error("ローカルAPIサーバーを起動しています。"))
      .mockResolvedValueOnce({
        token: "desktop-secret",
        url: "http://127.0.0.1:4317",
      });
    const controller = createDesktopRuntimeController({
      connect,
      isDesktop: true,
      restart: vi.fn(),
    });

    const startPromise = controller.start();
    await vi.runOnlyPendingTimersAsync();

    expect(controller.getSnapshot()).toEqual({ status: "starting" });
    expect(connect).toHaveBeenCalledTimes(2);

    await vi.runOnlyPendingTimersAsync();
    await startPromise;

    expect(connect).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot()).toEqual({ status: "ready" });
  });
});
