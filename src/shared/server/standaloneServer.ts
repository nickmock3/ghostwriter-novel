import { createServer } from "node:http";
import { writeWebResponseToNodeResponse } from "./httpResponse";
import { incomingMessageToWebRequest } from "./nodeRequestAdapter";
import {
  parseParentProcessId,
  startParentProcessMonitor,
} from "./parentProcessMonitor";
import { createStandaloneRequestHandler, parseSidecarStartupConfig } from "./sidecarStartup";

export type StandaloneServer = {
  hostname: string;
  port: number;
  stop: (closeActiveConnections?: boolean) => Promise<void>;
  url: string;
};

function readServerPort(server: ReturnType<typeof createServer>, hostname: string): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error(`Standalone server on ${hostname} is not listening yet`);
  }

  return address.port;
}

async function startNodeStandaloneServer(options: {
  handler: (request: Request) => Response | Promise<Response>;
  hostname: string;
  port?: number;
}): Promise<StandaloneServer> {
  const hostname = options.hostname;
  const server = createServer(async (nodeRequest, nodeResponse) => {
    const host = nodeRequest.headers.host ?? hostname;
    const requestUrl = new URL(nodeRequest.url ?? "/", `http://${host}`);
    const webRequest = await incomingMessageToWebRequest(
      nodeRequest,
      requestUrl.toString(),
    );
    const webResponse = await options.handler(webRequest);
    await writeWebResponseToNodeResponse(nodeResponse, webResponse);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, hostname, () => resolve());
  });

  const port = readServerPort(server, hostname);

  return {
    hostname,
    port,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
    url: `http://${hostname}:${port}`,
  };
}

type BunServer = {
  port: number;
  stop: (closeActiveConnections?: boolean) => Promise<void>;
};

type BunRuntime = {
  serve: (options: {
    fetch: (request: Request) => Response | Promise<Response>;
    hostname: string;
    idleTimeout?: number;
    port: number;
  }) => BunServer;
};

function getBunRuntime(): BunRuntime | undefined {
  return (globalThis as { Bun?: BunRuntime }).Bun;
}

function startBunStandaloneServer(options: {
  handler: (request: Request) => Response | Promise<Response>;
  hostname: string;
  port?: number;
}): StandaloneServer {
  const bun = getBunRuntime();
  if (!bun) {
    throw new Error("Bun runtime is required");
  }

  const hostname = options.hostname;
  const server = bun.serve({
    fetch: options.handler,
    hostname,
    idleTimeout: 0,
    port: options.port ?? 0,
  });

  return {
    hostname,
    port: server.port,
    stop: async (closeActiveConnections = false) => {
      await server.stop(closeActiveConnections);
    },
    url: `http://${hostname}:${server.port}`,
  };
}

export async function startStandaloneServer(options: {
  handler: (request: Request) => Response | Promise<Response>;
  hostname?: string;
  port?: number;
}): Promise<StandaloneServer> {
  const hostname = options.hostname ?? "127.0.0.1";

  if (getBunRuntime()) {
    return startBunStandaloneServer({ ...options, hostname });
  }

  return startNodeStandaloneServer({ ...options, hostname });
}

async function main() {
  if (!getBunRuntime()) {
    throw new Error("Bun runtime is required to start the production API server");
  }

  const startupConfig = parseSidecarStartupConfig(process.env);
  const handler = createStandaloneRequestHandler(startupConfig);
  const server = await startStandaloneServer({ handler });
  const parentPid = parseParentProcessId(process.env.GHOSTWRITER_PARENT_PID);

  if (parentPid) {
    startParentProcessMonitor({
      onParentExit: () => {
        void server.stop(true).finally(() => process.exit(0));
      },
      parentPid,
    });
  }

  if (startupConfig.mode === "desktop") {
    console.log(JSON.stringify({ url: server.url }));
    return;
  }

  console.log(`API server listening on ${server.url}`);
}

if (import.meta.main) {
  void main();
}
