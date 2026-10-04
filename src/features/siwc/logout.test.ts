// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { testAccount } from "./test-support";
import { logout } from "./logout";
import type { Fetch } from "./oidc";
import { createCredentialStore } from "./store";


let directory: string;
let temporaryRoot: string;
beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "siwc-logout-"));
  directory = join(temporaryRoot, "credentials");
});
afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});
const signal = () => new AbortController().signal;
const discovery = (endpoint: unknown = "https://auth.openai.com/revoke") =>
  Response.json({
    issuer: "https://auth.openai.com",
    authorization_endpoint: "https://auth.openai.com/authorize",
    token_endpoint: "https://auth.openai.com/token",
    jwks_uri: "https://auth.openai.com/jwks",
    revocation_endpoint: endpoint,
  });
const setup = async () => {
  const store = createCredentialStore(directory);
  await store.update(async (state) => ({
    state: {
      ...state,
      accounts: [
        testAccount,
        {
          ...testAccount,
          id: "00000000-0000-4000-8000-000000000002",
          clientId: "oaiapp_other",
        },
      ],
      activeAccountId: testAccount.id,
    },
    value: null,
  }));
  return store;
};
it("discovery先に正しいformを送り、選択中sessionだけ削除する", async () => {
  const store = await setup();
  const before = await store.read();
  const fetcher = vi.fn<Fetch>(async (url, init) => {
    expect(init.redirect).toBe("error");
    if (url.endsWith("openid-configuration")) return discovery();
    expect(url).toBe("https://auth.openai.com/revoke");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      token: "dummy-refresh",
      token_type_hint: "refresh_token",
      client_id: "oaiapp_test",
    });
    expect(
      await createCredentialStore(directory).update(async (state) => ({
        state,
        value: null,
      })),
    ).toEqual({ ok: false, error: "busy" });
    return new Response(null, { status: 200 });
  });
  expect(await logout(store, fetcher, signal())).toEqual({
    ok: true,
    value: { remoteRevocationConfirmed: true },
  });
  const after = await store.read();
  if (!before.ok || !before.value || !after.ok || !after.value)
    throw new Error("test state missing");
  expect(after.value.hostId).toBe(before.value.hostId);
  expect(after.value.activeAccountId).toBe(testAccount.id);
  expect(after.value.accounts[0]).toEqual({
    id: testAccount.id,
    clientId: testAccount.clientId,
    identity: testAccount.identity,
    remoteRevocationUnconfirmed: false,
  });
  expect(after.value.accounts[1]).toEqual(before.value.accounts[1]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each([400, 204, 500])(
  "HTTP %sは未確認として削除する（5xxのみ有界再試行）",
  async (status) => {
    const store = await setup();
    const fetcher = vi.fn<Fetch>(async (url) =>
      url.endsWith("openid-configuration")
        ? discovery()
        : new Response(null, { status }),
    );
    expect(await logout(store, fetcher, signal())).toEqual({
      ok: true,
      value: { remoteRevocationConfirmed: false },
    });
    expect(fetcher).toHaveBeenCalledTimes(status === 500 ? 4 : 2);
    fetcher.mockClear();
    expect(await logout(store, fetcher, signal())).toEqual({
      ok: true,
      value: { remoteRevocationConfirmed: false },
    });
    expect(fetcher).not.toHaveBeenCalled();
  },
);
it.each([null, "https://example.com/revoke"])(
  "不正なendpoint %sへtokenを送らない",
  async (endpoint) => {
    const store = await setup();
    const fetcher = vi.fn<Fetch>(async () => discovery(endpoint));
    expect(await logout(store, fetcher, signal())).toEqual({
      ok: true,
      value: { remoteRevocationConfirmed: false },
    });
    expect(fetcher).toHaveBeenCalledOnce();
  },
);
it("一時障害後の再試行で成功する", async () => {
  const store = await setup();
  const fetcher = vi
    .fn<Fetch>()
    .mockRejectedValueOnce(new Error("dummy-secret"))
    .mockResolvedValueOnce(discovery())
    .mockResolvedValueOnce(new Response(null, { status: 200 }));
  expect(await logout(store, fetcher, signal())).toEqual({
    ok: true,
    value: { remoteRevocationConfirmed: true },
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("キャンセルでもローカル削除し、通信しない", async () => {
  const store = await setup();
  const fetcher = vi.fn<Fetch>();
  expect(await logout(store, fetcher, AbortSignal.abort())).toEqual({
    ok: true,
    value: { remoteRevocationConfirmed: false },
  });
  expect(fetcher).not.toHaveBeenCalled();
  const saved = await store.read();
  expect(saved.ok && saved.value?.accounts[0]?.session).toBeUndefined();
});
it("他プロセスが使用中なら通信・削除しない", async () => {
  const store = await setup();
  const fetcher = vi.fn<Fetch>();
  await store.update(async (state) => {
    expect(
      await logout(createCredentialStore(directory), fetcher, signal()),
    ).toEqual({ ok: false, error: "busy" });
    return { state, value: null };
  });
  expect(fetcher).not.toHaveBeenCalled();
  const saved = await store.read();
  expect(saved.ok && saved.value?.accounts[0]?.session).toEqual(
    testAccount.session,
  );
});
