import { spawn } from "node:child_process";
import { z } from "zod";
import { BoundaryError, failure, type Result } from "./result";
import type { SiwcService } from "./service";
import { windowsPowerShell } from "./windowsCredentialPermissions";

const accountBody = z.strictObject({ accountId: z.uuid() });
const loginBody = z.strictObject({ accountId: z.uuid().optional() });
const emptyBody = z.strictObject({});
const nativeOrigins = new Set(["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]);

export async function openSiwcBrowser(url: string): Promise<void> {
  let parsed: URL;
  try { parsed = new URL(url); }
  catch { throw new BoundaryError("invalid_response"); }
  if (parsed.origin !== "https://auth.openai.com" || parsed.username || parsed.password) throw new BoundaryError("invalid_response");
  if (!["darwin", "linux", "win32"].includes(process.platform)) throw new BoundaryError("unsupported_platform");
  await new Promise<void>((resolve, reject) => {
    // WindowsはstdinのURLをShellExecuteのFileNameとして扱う。コマンド文字列に連結しない。
    const windows = process.platform === "win32";
    const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
try {
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = [Console]::In.ReadToEnd()
  $info.UseShellExecute = $true
  [void][Diagnostics.Process]::Start($info)
} catch { exit 1 }
`;
    const child = spawn(windows ? windowsPowerShell() : process.platform === "darwin" ? "open" : "xdg-open",
      windows ? ["-WindowStyle", "Hidden", "-NoProfile", "-NonInteractive", "-STA", "-Command", script] : [url],
      { stdio: windows ? ["pipe", "ignore", "ignore"] : "ignore", windowsHide: true, shell: false, timeout: 15_000 });
    child.once("error", () => reject(new BoundaryError("authorization_failed")));
    child.once("close", code => code === 0 ? resolve() : reject(new BoundaryError("authorization_failed")));
    if (windows) {
      child.stdin?.on("error", () => reject(new BoundaryError("authorization_failed")));
      child.stdin?.end(url);
    }
  });
}

function respond(result: Result<unknown>): Response {
  const status = result.ok ? 200 : result.error === "busy" ? 409 : result.error === "network" ? 502 : 400;
  return Response.json(result, { status, headers: { "cache-control": "no-store" } });
}
export function createSiwcApiHandler(options: {
  service: SiwcService;
  enabled?: boolean;
  openBrowser?: (url: string) => Promise<void>;
}) {
  let loginController: AbortController | undefined;
  return async (request: Request): Promise<Response> => {
    if (!options.enabled) return new Response(null, { status: 404 });
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    // native originはouter sidecarのBearer+Origin検証を必ず通る。
    const nativeOrigin = origin !== null && nativeOrigins.has(origin);
    // WebView→loopbackはcross-siteになる。許可native originにもWeb用の拒否を適用しない。
    if (!nativeOrigin && ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site")) return new Response(null, { status: 403 });
    const path = url.pathname;
    try {
      if (request.method === "GET") {
        if (path === "/api/siwc/status") {
          const status = await options.service.status();
          return respond(status.ok ? { ok: true, value: { ...status.value, loginPending: Boolean(loginController) } } : status);
        }
        if (path === "/api/siwc/models") return respond(await options.service.models(request.signal));
        return new Response(null, { status: 404 });
      }
      if (request.method !== "POST") return new Response(null, { status: 405 });
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") return new Response(null, { status: 415 });
      const body: unknown = await request.json().catch(() => null);
      if (path === "/api/siwc/select") {
        const parsed = accountBody.safeParse(body);
        return respond(parsed.success ? await options.service.selectAccount(parsed.data.accountId) : failure("unsupported_request"));
      }
      if (path === "/api/siwc/login") {
        const parsed = loginBody.safeParse(body);
        if (!parsed.success) return respond(failure("unsupported_request"));
        if (loginController) return respond(failure("busy"));
        const controller = new AbortController();
        loginController = controller;
        try {
          return respond(await options.service.login({
            authorize: options.openBrowser ?? openSiwcBrowser,
            signal: AbortSignal.any([controller.signal, request.signal, AbortSignal.timeout(240000)]),
          }, parsed.data.accountId));
        } finally { loginController = undefined; }
      }
      if (!emptyBody.safeParse(body).success) return respond(failure("unsupported_request"));
      if (path === "/api/siwc/login/cancel") {
        loginController?.abort();
        return respond({ ok: true, value: null });
      }
      if (path === "/api/siwc/logout") return respond(await options.service.logout(request.signal));
      return new Response(null, { status: 404 });
    } catch (error: unknown) {
      return respond(failure(error instanceof BoundaryError ? error.code : "network"));
    }
  };
}
