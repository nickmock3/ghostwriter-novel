import { timingSafeEqual } from "node:crypto";

export type SidecarRequestHandler = (request: Request) => Response | Promise<Response>;

export type SidecarSecurityOptions = {
  allowedOrigins: readonly string[];
  handler: SidecarRequestHandler;
  token: string;
};

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

function secureCompareBearerToken(authorizationHeader: string | null, expectedToken: string): boolean {
  if (!authorizationHeader) {
    return false;
  }

  const prefix = "Bearer ";
  if (!authorizationHeader.startsWith(prefix)) {
    return false;
  }

  const providedToken = authorizationHeader.slice(prefix.length);
  if (providedToken.length !== expectedToken.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(providedToken), Buffer.from(expectedToken));
}

function withCorsHeaders(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("vary", "Origin");
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function rejectSidecarRequest(status: 401 | 403, message: string): Response {
  return jsonResponse({ message }, status);
}

const ALLOWED_CORS_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const ALLOWED_CORS_HEADERS = new Set(["authorization", "content-type", "accept"]);
const ACCESS_CONTROL_ALLOW_HEADERS = "authorization, content-type, accept";

function parseRequestedHeaderNames(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedPreflight(request: Request): boolean {
  const requestedMethod = request.headers.get("access-control-request-method")?.toUpperCase();
  if (!requestedMethod || !ALLOWED_CORS_METHODS.has(requestedMethod)) {
    return false;
  }

  const requestedHeaders = parseRequestedHeaderNames(
    request.headers.get("access-control-request-headers"),
  );

  return requestedHeaders.every((header) => ALLOWED_CORS_HEADERS.has(header));
}

export function createSidecarRequestHandler(
  options: SidecarSecurityOptions,
): SidecarRequestHandler {
  const allowedOrigins = new Set(options.allowedOrigins);

  return async (request) => {
    const origin = request.headers.get("origin");

    if (request.method === "OPTIONS") {
      if (!origin || !allowedOrigins.has(origin)) {
        return rejectSidecarRequest(403, "Origin is not allowed");
      }

      if (!isAllowedPreflight(request)) {
        return rejectSidecarRequest(403, "Preflight request is not allowed");
      }

      return new Response(null, {
        headers: {
          "access-control-allow-headers": ACCESS_CONTROL_ALLOW_HEADERS,
          "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "access-control-allow-origin": origin,
          "access-control-max-age": "600",
          vary: "Origin",
        },
        status: 204,
      });
    }

    if (!secureCompareBearerToken(request.headers.get("authorization"), options.token)) {
      return rejectSidecarRequest(401, "Unauthorized");
    }

    if (!origin || !allowedOrigins.has(origin)) {
      return rejectSidecarRequest(403, "Origin is not allowed");
    }

    const response = await options.handler(request);
    return withCorsHeaders(response, origin);
  };
}
