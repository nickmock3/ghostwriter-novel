import { afterEach, describe, expect, it } from "vitest";
import { createProductionApiRouter } from "./apiRouter";
import { createSidecarRequestHandler } from "./sidecarSecurity";
import {
  parseAllowedOrigins,
  parseSidecarStartupConfig,
} from "./sidecarStartup";
import { startStandaloneServer, type StandaloneServer } from "./standaloneServer";

const servers: StandaloneServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

describe("startStandaloneServer", () => {
  it("disables Bun idle timeouts for long-running response streams", async () => {
    const originalBun = Object.getOwnPropertyDescriptor(globalThis, "Bun");
    let serveOptions: { idleTimeout?: number } | undefined;
    Object.defineProperty(globalThis, "Bun", {
      configurable: true,
      value: {
        serve(options: { idleTimeout?: number }) {
          serveOptions = options;
          return {
            port: 43123,
            stop: async () => {},
          };
        },
      },
    });

    try {
      const server = await startStandaloneServer({
        handler: async () => new Response("ok"),
      });

      expect(server.port).toBe(43123);
      expect(serveOptions).toMatchObject({ idleTimeout: 0 });
    } finally {
      if (originalBun) {
        Object.defineProperty(globalThis, "Bun", originalBun);
      } else {
        Reflect.deleteProperty(globalThis, "Bun");
      }
    }
  });

  it("serves the supplied Web request handler over loopback HTTP", async () => {
    const server = await startStandaloneServer({
      handler: async (request) => {
        return Response.json({ method: request.method, pathname: new URL(request.url).pathname });
      },
      port: 0,
    });
    servers.push(server);

    const response = await fetch(`${server.url}/health`);

    expect(server.hostname).toBe("127.0.0.1");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ method: "GET", pathname: "/health" });
  });

  it("delivers NDJSON chunks before the response stream closes", async () => {
    let releaseSecondChunk: (() => void) | undefined;
    const secondChunkReady = new Promise<void>((resolve) => {
      releaseSecondChunk = resolve;
    });
    const server = await startStandaloneServer({
      handler: async () => {
        return new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(new TextEncoder().encode('{"step":1}\n'));
              await secondChunkReady;
              controller.enqueue(new TextEncoder().encode('{"step":2}\n'));
              controller.close();
            },
          }),
          { headers: { "content-type": "application/x-ndjson; charset=utf-8" } },
        );
      },
      port: 0,
    });
    servers.push(server);

    const response = await fetch(`${server.url}/api/chat/messages`, {
      headers: { accept: "application/x-ndjson" },
      method: "POST",
    });
    const reader = response.body?.getReader();

    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(reader).toBeDefined();
    const firstChunk = await reader!.read();
    expect(new TextDecoder().decode(firstChunk.value)).toBe('{"step":1}\n');
    expect(firstChunk.done).toBe(false);

    releaseSecondChunk?.();
    const secondChunk = await reader!.read();
    const end = await reader!.read();

    expect(new TextDecoder().decode(secondChunk.value)).toBe('{"step":2}\n');
    expect(end.done).toBe(true);
  });
});

describe("parseSidecarStartupConfig", () => {
  it("keeps web startup when the desktop token is absent", () => {
    expect(parseSidecarStartupConfig({})).toEqual({ mode: "web" });
  });

  it("requires allowed origins when the desktop token is configured", () => {
    expect(() =>
      parseSidecarStartupConfig({ GHOSTWRITER_SIDECAR_TOKEN: "desktop-secret" }),
    ).toThrow(/GHOSTWRITER_ALLOWED_ORIGINS/);
  });

  it("parses comma-separated allowed origins for desktop startup", () => {
    expect(
      parseSidecarStartupConfig({
        GHOSTWRITER_ALLOWED_ORIGINS: "tauri://localhost, http://tauri.localhost ",
        GHOSTWRITER_SIDECAR_TOKEN: "desktop-secret",
      }),
    ).toEqual({
      allowedOrigins: ["tauri://localhost", "http://tauri.localhost"],
      mode: "desktop",
      token: "desktop-secret",
    });
    expect(parseAllowedOrigins(" a , b ")).toEqual(["a", "b"]);
  });
});

describe("sidecar-protected standalone server", () => {
  it("streams authenticated NDJSON through a sidecar-protected handler", async () => {
    const handler = createSidecarRequestHandler({
      allowedOrigins: ["tauri://localhost"],
      handler: async () => {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"step":1}\n'));
              controller.enqueue(new TextEncoder().encode('{"step":2}\n'));
              controller.close();
            },
          }),
          { headers: { "content-type": "application/x-ndjson; charset=utf-8" } },
        );
      },
      token: "desktop-secret",
    });
    const server = await startStandaloneServer({ handler });
    servers.push(server);

    const response = await fetch(`${server.url}/api/chat/messages`, {
      headers: {
        accept: "application/x-ndjson",
        authorization: "Bearer desktop-secret",
        origin: "tauri://localhost",
      },
      method: "POST",
    });
    const reader = response.body?.getReader();
    let buffer = "";

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(reader).toBeDefined();

    while (true) {
      const { done, value } = await reader!.read();
      if (done) {
        break;
      }

      buffer += new TextDecoder().decode(value);
    }

    expect(buffer).toBe('{"step":1}\n{"step":2}\n');
  });

  it("wraps the production router without weakening health checks", async () => {
    const handler = createSidecarRequestHandler({
      allowedOrigins: ["tauri://localhost"],
      handler: createProductionApiRouter(),
      token: "desktop-secret",
    });
    const server = await startStandaloneServer({ handler });
    servers.push(server);

    const unauthorized = await fetch(`${server.url}/health`);
    const authorized = await fetch(`${server.url}/health`, {
      headers: {
        authorization: "Bearer desktop-secret",
        origin: "tauri://localhost",
      },
    });

    expect(unauthorized.status).toBe(401);
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toEqual({ ok: true });
  });
});
