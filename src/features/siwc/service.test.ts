// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createCredentialStore } from "./store";
import { createSiwcService } from "./service";
import { testAccount, testNow } from "./test-support";
import type { Fetch } from "./oidc";
import type { Account } from "./credentials";


let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "ghostwriter-siwc-service-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const second: Account = { ...testAccount, id: "00000000-0000-4000-8000-000000000002", clientId: "oaiapp_second" };
async function setup(fetcher: Fetch = vi.fn(async () => Response.json({ models: [] })), expired = false) {
  const store = createCredentialStore(join(directory, "siwc"));
  await store.update(async state => ({ state: {
    ...state, accounts: [{ ...testAccount, session: { ...testAccount.session!, expiresAt: testNow + (expired ? -1 : 3600000) } }, second],
    activeAccountId: testAccount.id,
  }, value: undefined }));
  return { store, service: createSiwcService({ dataRoot: directory, fetch: fetcher, now: () => testNow }) };
}
const gate = () => {
  let release = () => {};
  const wait = new Promise<void>(resolve => { release = resolve; });
  return { wait, release };
};
it("token・identity・client登録情報を公開状態へ返さない", async () => {
  const { service } = await setup();
  const status = await service.status();
  expect(status.ok).toBe(true);
  const json = JSON.stringify(status);
  for (const secret of ["dummy-access", "dummy-refresh", "dummy-id", "synthetic-subject", "oaiapp_test", "urn:uuid:"]) expect(json).not.toContain(secret);
  expect(status).toMatchObject({ ok: true, value: { accounts: [{ id: testAccount.id, active: true }, { id: second.id }] } });
});
it("実行中の切替・logout・loginを拒否し、終了後に切り替える", async () => {
  const { service } = await setup();
  const started = gate(); const finish = gate();
  const run = service.withRun(async () => { started.release(); await finish.wait; return "done"; });
  await started.wait;
  expect(await service.selectAccount(second.id)).toEqual({ ok: false, error: "busy" });
  expect(await service.logout(new AbortController().signal)).toEqual({ ok: false, error: "busy" });
  expect(await service.login({ authorize: vi.fn(), signal: new AbortController().signal })).toEqual({ ok: false, error: "busy" });
  finish.release();
  expect(await run).toEqual({ ok: true, value: "done" });
  expect(await service.selectAccount(second.id)).toEqual({ ok: true, value: second.id });
});
it("並行runのrefreshを直列化し、後継tokenだけで推論する", async () => {
  const authorizations: string[] = [];
  const fetcher = vi.fn<Fetch>(async (url, init) => {
    if (url.endsWith("openid-configuration")) return Response.json({ issuer: "https://auth.openai.com", authorization_endpoint: "https://auth.openai.com/authorize", token_endpoint: "https://auth.openai.com/token", jwks_uri: "https://auth.openai.com/keys" });
    if (url.endsWith("/token")) return Response.json({ access_token: "rotated-access", refresh_token: "rotated-refresh", token_type: "Bearer", expires_in: 3600 });
    authorizations.push(new Headers(init.headers).get("authorization") ?? "");
    return Response.json({ models: [] });
  });
  const { service } = await setup(fetcher, true);
  const runs = await Promise.all([1, 2, 3].map(() => service.withRun(async run => {
    await run.fetch("https://api.openai.com/v1/responses", { method: "POST", body: "{}" });
    return "done";
  })));
  expect(runs.every(result => result.ok)).toBe(true);
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/token"))).toHaveLength(1);
  expect(authorizations).toEqual(["Bearer rotated-access", "Bearer rotated-access", "Bearer rotated-access"]);
// Windowsでは実ACLをPowerShellで確認するため、全体回帰の並行負荷も含めて待つ。
}, 60_000);
it("別processでアカウントが変わったら次ステップを送信しない", async () => {
  const fetcher = vi.fn<Fetch>();
  const { service, store } = await setup(fetcher);
  const result = await service.withRun(async run => {
    await store.update(async state => ({ state: { ...state, activeAccountId: second.id }, value: undefined }));
    await run.fetch("https://api.openai.com/v1/responses", { method: "POST" });
  });
  expect(result).toEqual({ ok: false, error: "account_changed" });
  expect(fetcher).not.toHaveBeenCalled();
});
it("モデルを切替ごとに取得し、前アカウントのモデルを再利用しない", async () => {
  let calls = 0;
  const fetcher = vi.fn<Fetch>(async () => Response.json({ models: [{ slug: `model-${++calls}`, display_name: "Model", visibility: "list" }] }));
  const { service } = await setup(fetcher);
  expect(await service.models()).toMatchObject({ ok: true, value: { accountId: testAccount.id, models: [{ slug: "model-1" }] } });
  await service.selectAccount(second.id);
  expect(await service.models()).toMatchObject({ ok: true, value: { accountId: second.id, models: [{ slug: "model-2" }] } });
});
it("資格情報を任意URLへ送らず、ネットワーク例外を公開しない", async () => {
  const fetcher = vi.fn<Fetch>(async () => { throw new Error("dummy-access-token"); });
  const { service } = await setup(fetcher);
  expect(await service.withRun(run => run.fetch("https://example.com/responses", {}))).toEqual({ ok: false, error: "unsupported_request" });
  expect(fetcher).not.toHaveBeenCalled();
  expect(await service.withRun(run => run.fetch("https://api.openai.com/v1/responses", {}))).toEqual({ ok: false, error: "network" });
  expect(await service.selectAccount(second.id)).toEqual({ ok: true, value: second.id });
});
it("run終了後に持ち出したfetchは資格情報を使用できない", async () => {
  const fetcher = vi.fn<Fetch>();
  const { service } = await setup(fetcher);
  const result = await service.withRun(async run => run.fetch);
  if (!result.ok) throw new Error("Missing run");
  await expect(result.value("https://api.openai.com/v1/responses", {})).rejects.toThrow("cancelled");
  expect(fetcher).not.toHaveBeenCalled();
});
