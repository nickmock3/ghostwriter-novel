import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiFetch,
  configureDesktopApiTransport,
  resetApiTransportForTests,
} from "./apiTransport";

afterEach(() => {
  resetApiTransportForTests();
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("keeps same-origin API requests unchanged in web mode", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/health");

    expect(fetchMock).toHaveBeenCalledWith("/api/health", undefined);
  });

  it("targets the desktop sidecar and adds its bearer token", async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    configureDesktopApiTransport({
      token: "desktop-secret",
      url: "http://127.0.0.1:4317",
    });

    await apiFetch("/api/files/tree?workspaceRoot=%2Ftmp%2Fnovel", {
      headers: { accept: "application/json" },
      signal,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    const [input, init] = call;
    expect(String(input)).toBe(
      "http://127.0.0.1:4317/api/files/tree?workspaceRoot=%2Ftmp%2Fnovel",
    );
    expect(new Headers(init?.headers)).toMatchObject(
      expect.objectContaining({}),
    );
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer desktop-secret",
    );
    expect(init?.signal).toBe(signal);
  });

  it("reports a desktop sidecar transport failure", async () => {
    const unavailable = vi.fn();
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);
    configureDesktopApiTransport({
      onUnavailable: unavailable,
      token: "desktop-secret",
      url: "http://127.0.0.1:4317",
    });

    await expect(apiFetch("/health")).rejects.toThrow("fetch failed");

    expect(unavailable).toHaveBeenCalledOnce();
  });

  it("does not report an intentional request abort as a sidecar failure", async () => {
    const unavailable = vi.fn();
    const fetchMock = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    vi.stubGlobal("fetch", fetchMock);
    configureDesktopApiTransport({
      onUnavailable: unavailable,
      token: "desktop-secret",
      url: "http://127.0.0.1:4317",
    });

    await expect(
      apiFetch("/api/files/tree", { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(unavailable).not.toHaveBeenCalled();
  });

  it("never forwards the desktop bearer token to an absolute URL", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    configureDesktopApiTransport({
      token: "desktop-secret",
      url: "http://127.0.0.1:4317",
    });

    await expect(apiFetch("https://example.com/api/files/tree")).rejects.toThrow(
      /relative API path/,
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps an authenticated desktop NDJSON response stream readable", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"step":1}\n'));
            controller.enqueue(new TextEncoder().encode('{"step":2}\n'));
            controller.close();
          },
        }),
        { headers: { "content-type": "application/x-ndjson" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    configureDesktopApiTransport({
      token: "desktop-secret",
      url: "http://127.0.0.1:4317",
    });

    const response = await apiFetch("/api/chat/messages", {
      headers: { accept: "application/x-ndjson" },
      method: "POST",
    });
    const reader = response.body!.getReader();

    const first = await reader.read();
    const second = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('{"step":1}\n');
    expect(new TextDecoder().decode(second.value)).toBe('{"step":2}\n');
  });
});
