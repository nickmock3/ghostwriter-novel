import type { Plugin } from "vite";
import { writeWebResponseToNodeResponse } from "./httpResponse";
import { incomingMessageToWebRequest } from "./nodeRequestAdapter";

export function createViteApiMiddlewarePlugin(
  router: (request: Request) => Response | Promise<Response>,
): Plugin {
  return {
    name: "ghostwriter-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const host = request.headers.host ?? "localhost";
        const requestUrl = new URL(request.url ?? "/", `http://${host}`);
        const { pathname } = requestUrl;

        if (pathname !== "/health" && !pathname.startsWith("/api/")) {
          next();
          return;
        }

        try {
          const webRequest = await incomingMessageToWebRequest(
            request,
            requestUrl.toString(),
          );
          const webResponse = await router(webRequest);
          await writeWebResponseToNodeResponse(response, webResponse);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
