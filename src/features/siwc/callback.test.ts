// @vitest-environment node
import { describe, expect, it } from "vitest";
import { listenForCallback } from "./callback";
import { createAttempt } from "./oauth";

describe("loopback callback（外部通信なし）", () => {
  it("127.0.0.1の正しいpathだけを受け、受信後にlistenerを閉じる", async () => {
    const attempt = createAttempt();
    const listener = await listenForCallback(
      attempt,
      undefined,
      new AbortController().signal,
    );
    try {
      expect(new URL(listener.redirectUri).hostname).toBe("127.0.0.1");
      expect(
        (await fetch(new URL("/wrong", listener.redirectUri))).status,
      ).toBe(404);
      const url = new URL(listener.redirectUri);
      url.search = new URLSearchParams({
        code: "dummy-code",
        state: attempt.state,
        client_id: "oaiapp_test",
      }).toString();
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain("dummy-code");
      expect(await listener.result).toEqual({
        ok: true,
        value: { code: "dummy-code", clientId: "oaiapp_test" },
      });
      await expect(fetch(listener.redirectUri)).rejects.toThrow();
    } finally {
      listener.close();
    }
  });
  it("不一致stateのcallbackを拒否して終了する", async () => {
    const listener = await listenForCallback(
      createAttempt(),
      undefined,
      new AbortController().signal,
    );
    try {
      const response = await fetch(
        `${listener.redirectUri}?state=wrong&code=dummy`,
      );
      expect(response.status).toBe(400);
      expect(await listener.result).toEqual({
        ok: false,
        error: "invalid_callback",
      });
    } finally {
      listener.close();
    }
  });
  it("timeoutで終了する", async () => {
    const listener = await listenForCallback(
      createAttempt(),
      undefined,
      new AbortController().signal,
      20,
    );
    expect(await listener.result).toEqual({ ok: false, error: "timeout" });
    await expect(fetch(listener.redirectUri)).rejects.toThrow();
  });
  it("キャンセルで終了する", async () => {
    const controller = new AbortController();
    const listener = await listenForCallback(
      createAttempt(),
      undefined,
      controller.signal,
    );
    controller.abort();
    expect(await listener.result).toEqual({ ok: false, error: "cancelled" });
    await expect(fetch(listener.redirectUri)).rejects.toThrow();
  });
});
