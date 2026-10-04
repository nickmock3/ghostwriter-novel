import { describe, expect, it, vi } from "vitest";
import { createSidecarRequestHandler } from "./sidecarSecurity";

const origin = "tauri://localhost";

function request(
  path: string,
  options: {
    headers?: Record<string, string>;
    method?: string;
  } = {},
) {
  return new Request(`http://127.0.0.1:4317${path}`, {
    headers: options.headers,
    method: options.method,
  });
}

describe("createSidecarRequestHandler", () => {
  it("allows an authenticated API request from the configured Tauri origin", async () => {
    const apiHandler = vi.fn(async () => Response.json({ ok: true }));
    const handler = createSidecarRequestHandler({
      allowedOrigins: [origin],
      handler: apiHandler,
      token: "desktop-secret",
    });

    const response = await handler(
      request("/api/files/tree", {
        headers: {
          authorization: "Bearer desktop-secret",
          origin,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(apiHandler).toHaveBeenCalledOnce();
  });

  it.each([
    [{ origin }, 401],
    [{ authorization: "Bearer wrong", origin }, 401],
    [{ authorization: "Bearer desktop-secret", origin: "http://localhost:3000" }, 403],
  ])("rejects missing credentials or an unexpected origin", async (headers, status) => {
    const apiHandler = vi.fn(async () => Response.json({ ok: true }));
    const handler = createSidecarRequestHandler({
      allowedOrigins: [origin],
      handler: apiHandler,
      token: "desktop-secret",
    });

    const response = await handler(request("/api/files/tree", { headers }));

    expect(response.status).toBe(status);
    expect(apiHandler).not.toHaveBeenCalled();
  });

  it("answers a valid CORS preflight without invoking the API router", async () => {
    const apiHandler = vi.fn(async () => Response.json({ ok: true }));
    const handler = createSidecarRequestHandler({
      allowedOrigins: [origin],
      handler: apiHandler,
      token: "desktop-secret",
    });

    const response = await handler(
      request("/api/chat/messages", {
        headers: {
          "access-control-request-headers": "authorization,content-type",
          "access-control-request-method": "POST",
          origin,
        },
        method: "OPTIONS",
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "authorization",
    );
    expect(apiHandler).not.toHaveBeenCalled();
  });

  it("rejects a preflight that asks for headers outside the fixed allowlist", async () => {
    const apiHandler = vi.fn(async () => Response.json({ ok: true }));
    const handler = createSidecarRequestHandler({
      allowedOrigins: [origin],
      handler: apiHandler,
      token: "desktop-secret",
    });

    const response = await handler(
      request("/api/files/content", {
        headers: {
          "access-control-request-headers": "authorization,x-forwarded-host",
          "access-control-request-method": "PUT",
          origin,
        },
        method: "OPTIONS",
      }),
    );

    expect(response.status).toBe(403);
    expect(apiHandler).not.toHaveBeenCalled();
  });

  it("also requires authentication and the expected origin for health checks", async () => {
    const apiHandler = vi.fn(async () => Response.json({ ok: true }));
    const handler = createSidecarRequestHandler({
      allowedOrigins: [origin],
      handler: apiHandler,
      token: "desktop-secret",
    });

    const unauthorized = await handler(request("/health"));
    const authorized = await handler(
      request("/health", {
        headers: {
          authorization: "Bearer desktop-secret",
          origin,
        },
      }),
    );

    expect(unauthorized.status).toBe(401);
    expect(authorized.status).toBe(200);
    expect(apiHandler).toHaveBeenCalledOnce();
  });
});
