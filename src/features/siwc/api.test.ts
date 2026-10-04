// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSiwcApiHandler } from "./api";
import { createSiwcService } from "./service";
import { createCredentialStore } from "./store";
import { testAccount, testNow } from "./test-support";
import { failure } from "./result";
import { createSidecarRequestHandler } from "../../shared/server/sidecarSecurity";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "ghostwriter-siwc-api-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const request = (path: string, body?: unknown) => new Request(`http://localhost/api/siwc/${path}`, body === undefined ? {} : {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
it.each(["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"])("認証済みdesktop %s のcross-site GET/POSTを許可する", async origin => {
  const service = createSiwcService({ dataRoot: directory });
  const handler = createSidecarRequestHandler({
    token: "test-sidecar-token", allowedOrigins: [origin],
    handler: createSiwcApiHandler({ service, enabled: true }),
  });
  for (const method of ["GET", "POST"]) {
    const response = await handler(new Request(`http://127.0.0.1:1234/api/siwc/${method === "GET" ? "status" : "login/cancel"}`, {
      method, headers: { origin, authorization: "Bearer test-sidecar-token", "sec-fetch-site": "cross-site", "content-type": "application/json" },
      ...(method === "POST" ? { body: "{}" } : {}),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
  }
});
it("desktop例外でも無認証・外部originを拒否し、Webのcross-site拒否を維持する", async () => {
  const service = createSiwcService({ dataRoot: directory });
  const status = vi.spyOn(service, "status");
  const api = createSiwcApiHandler({ service, enabled: true });
  const handler = createSidecarRequestHandler({ token: "test-sidecar-token", allowedOrigins: ["http://tauri.localhost"], handler: api });
  for (const [origin, authorization, expected] of [
    ["http://tauri.localhost", "", 401],
    ["http://tauri.localhost", "Bearer wrong", 401],
    ["https://example.com", "Bearer test-sidecar-token", 403],
  ] as const) {
    expect((await handler(new Request("http://localhost/api/siwc/status", { headers: { origin, authorization, "sec-fetch-site": "cross-site" } }))).status).toBe(expected);
  }
  expect((await api(new Request("http://localhost/api/siwc/status", { headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(403);
  expect(status).not.toHaveBeenCalled();
});
async function setup() {
  await createCredentialStore(join(directory, "siwc")).update(async state => ({ state: { ...state, accounts: [testAccount], activeAccountId: testAccount.id }, value: undefined }));
  const service = createSiwcService({ dataRoot: directory, now: () => testNow, fetch: vi.fn() });
  const handler = createSiwcApiHandler({ service, enabled: true, openBrowser: vi.fn() });
  return { service, handler };
}
it("既定ではpreview APIを公開しない", async () => {
  const service = createSiwcService({ dataRoot: directory });
  const status = vi.spyOn(service, "status");
  expect((await createSiwcApiHandler({ service })(request("status"))).status).toBe(404);
  expect(status).not.toHaveBeenCalled();
});
it("状態APIは秘密を返さずキャッシュさせない", async () => {
  const { handler } = await setup();
  const response = await handler(request("status"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const json = await response.text();
  expect(json).toContain(testAccount.id);
  expect(json).not.toContain("dummy-");
  expect(json).not.toContain("synthetic-subject");
});
it("別originと単純form POSTを拒否し、副作用を起こさない", async () => {
  const { service, handler } = await setup();
  const logout = vi.spyOn(service, "logout");
  expect((await handler(new Request("http://localhost/api/siwc/logout", { method: "POST", headers: { origin: "https://example.com", "content-type": "application/json" }, body: "{}" }))).status).toBe(403);
  expect((await handler(new Request("http://localhost/api/siwc/logout", { method: "POST", body: "{}" }))).status).toBe(415);
  expect(logout).not.toHaveBeenCalled();
});
it("登録IDと余計な資格情報フィールドを境界で検証する", async () => {
  const { service, handler } = await setup();
  const select = vi.spyOn(service, "selectAccount");
  for (const value of [{ accountId: "bad" }, { accountId: testAccount.id, token: "secret" }]) expect((await handler(request("select", value))).status).toBe(400);
  expect(select).not.toHaveBeenCalled();
  expect((await handler(request("select", { accountId: testAccount.id }))).status).toBe(200);
});
it("busyは409、ネットワーク例外は固定分類だけ返す", async () => {
  const { service, handler } = await setup();
  vi.spyOn(service, "models").mockResolvedValueOnce(failure("busy")).mockRejectedValueOnce(new Error("secret-token"));
  expect((await handler(request("models"))).status).toBe(409);
  const response = await handler(request("models"));
  expect(await response.json()).toEqual({ ok: false, error: "network" });
});
it("cancelでログインのsignalを中断し、以後の操作を妨げない", async () => {
  const { service, handler } = await setup();
  let ready = () => {};
  const started = new Promise<void>(resolve => { ready = resolve; });
  vi.spyOn(service, "login").mockImplementation(async options => {
    ready();
    await new Promise<void>(resolve => options.signal.addEventListener("abort", () => resolve(), { once: true }));
    return failure("cancelled");
  });
  const pending = handler(request("login", {}));
  await started;
  expect((await handler(request("login/cancel", {}))).status).toBe(200);
  expect(await (await pending).json()).toEqual({ ok: false, error: "cancelled" });
});
