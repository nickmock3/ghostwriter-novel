import { createProductionApiRouter } from "./apiRouter";
import { createSidecarRequestHandler } from "./sidecarSecurity";

export type SidecarStartupConfig =
  | {
      allowedOrigins: string[];
      mode: "desktop";
      token: string;
    }
  | {
      mode: "web";
    };

export function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function parseSidecarStartupConfig(
  env: Record<string, string | undefined>,
): SidecarStartupConfig {
  const token = env.GHOSTWRITER_SIDECAR_TOKEN?.trim();
  if (!token) {
    return { mode: "web" };
  }

  const allowedOrigins = parseAllowedOrigins(env.GHOSTWRITER_ALLOWED_ORIGINS);
  if (allowedOrigins.length === 0) {
    throw new Error(
      "GHOSTWRITER_ALLOWED_ORIGINS must include at least one origin when GHOSTWRITER_SIDECAR_TOKEN is set",
    );
  }

  return {
    allowedOrigins,
    mode: "desktop",
    token,
  };
}

export function createStandaloneRequestHandler(
  startupConfig: SidecarStartupConfig,
): (request: Request) => Response | Promise<Response> {
  const apiRouter = createProductionApiRouter();

  if (startupConfig.mode === "web") {
    return apiRouter;
  }

  return createSidecarRequestHandler({
    allowedOrigins: startupConfig.allowedOrigins,
    handler: apiRouter,
    token: startupConfig.token,
  });
}
