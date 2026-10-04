// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { expect, it as baseIt, vi } from "vitest";
import { requireSession } from "./access";
import { testAccount, testNow } from "./test-support";
import { type Account, issuer } from "./credentials";
import { logout } from "./logout";
import type { Fetch } from "./oidc";
import { earliestRefreshMs, refresh, refreshSelected } from "./refresh";
import { BoundaryError } from "./result";
import { createCredentialStore } from "./store";


// Each concurrent case owns its real credential directory. Lock contention
// within a case still uses the same directory and exercises the actual store.
const it = baseIt.extend<{ directory: string }>({
  directory: async ({}, use) => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "siwc-refresh-"));
    try {
      await use(join(temporaryRoot, "credentials"));
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  },
});
const signal = () => new AbortController().signal;
const discovery = () =>
  Response.json({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    revocation_endpoint: `${issuer}/revoke`,
  });
const tokens = {
  access_token: "dummy-next-access",
  refresh_token: "dummy-next-refresh",
  token_type: "Bearer",
  expires_in: 3600,
};
const setup = async (directory: string, account: Account = testAccount) => {
  const store = createCredentialStore(directory);
  await store.update(async (state) => ({
    state: { ...state, accounts: [account], activeAccountId: account.id },
    value: null,
  }));
  return store;
};
const savedAccount = async (directory: string) => {
  const read = await createCredentialStore(directory).read();
  if (!read.ok || !read.value?.accounts[0]) throw new Error("test setup");
  return read.value.accounts[0];
};
const deps = (fetcher: Fetch) => ({
  fetch: fetcher,
  signal: signal(),
  now: () => testNow,
});
const goodFetch = () =>
  vi.fn<Fetch>(async (url) =>
    url.endsWith("openid-configuration") ? discovery() : Response.json(tokens),
  );

it.each([undefined, null, 0])("更新時刻 %s は制約なし", (value) =>
  expect(earliestRefreshMs(value)).toBe(0),
);
it("数値はUnix秒、文字列はtimezone付き日時", () => {
  expect(earliestRefreshMs(testNow / 1000)).toBe(testNow);
  expect(earliestRefreshMs(new Date(testNow).toISOString())).toBe(testNow);
});
it.each([
  {},
  [],
  true,
  -1,
  1.5,
  Infinity,
  "garbage",
  "1790985600",
  "2026-10-03T12:00:00",
])("不正な更新時刻 %j は拒否", (value) => {
  expect(() => earliestRefreshMs(value)).toThrow("refresh_schedule");
});
it.concurrent("更新を排他実行し全token・scope・期限を置換、省略scope/IDは保持", async ({ directory, expect }) => {
  const store = await setup(directory);
  const fetcher = vi.fn<Fetch>(async (url, init) => {
    if (url.endsWith("openid-configuration")) return discovery();
    expect(init.redirect).toBe("error");
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: "refresh_token",
      client_id: "oaiapp_test",
      refresh_token: "dummy-refresh",
      resource: "https://api.openai.com/v1",
    });
    expect((await savedAccount(directory)).session?.refreshUncertain).toBe(true);
    expect(
      await refresh(createCredentialStore(directory), deps(goodFetch())),
    ).toEqual({ ok: false, error: "busy" });
    return Response.json({
      ...tokens,
      earliest_refresh_at: testNow / 1000 + 3500,
    });
  });
  expect((await refresh(store, deps(fetcher))).ok).toBe(true);
  expect((await savedAccount(directory)).session).toEqual({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: testAccount.session?.idToken,
    scopes: testAccount.session?.scopes,
    expiresAt: testNow + 3600000,
    earliestRefreshAt: testNow / 1000 + 3500,
  });
  fetcher.mockClear();
  expect(await refresh(store, deps(fetcher))).toEqual({
    ok: false,
    error: "refresh_not_ready",
  });
  expect(fetcher).not.toHaveBeenCalled();
});
it.concurrent("次の更新で置換済みrefreshだけを送信する", async ({ directory, expect }) => {
  const store = await setup(directory);
  await refresh(store, deps(goodFetch()));
  const fetcher = vi.fn<Fetch>(async (url, init) => {
    if (url.endsWith("openid-configuration")) return discovery();
    expect(new URLSearchParams(String(init.body)).get("refresh_token")).toBe(
      tokens.refresh_token,
    );
    return Response.json({ ...tokens, refresh_token: "dummy-third-refresh" });
  });
  expect((await refresh(store, deps(fetcher))).ok).toBe(true);
});
it.concurrent("期限直前だけ自動更新し、後続処理が失敗しても更新を保存", async ({ directory, expect }) => {
  const store = await setup(directory);
  const fetcher = goodFetch();
  await store.update(async (state, save) => ({
    state: await refreshSelected(state, save, deps(fetcher)),
    value: null,
  }));
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    await store.update(async (state, save) => {
      await refreshSelected(state, save, {
        ...deps(fetcher),
        now: () => testNow + 3550000,
      });
      throw new BoundaryError("disconnected");
    }),
  ).toEqual({ ok: false, error: "disconnected" });
  expect((await savedAccount(directory)).session?.accessToken).toBe(tokens.access_token);
});
it.concurrent("更新可能時刻前は有効tokenを使い、期限後は待機エラー", async ({ directory, expect }) => {
  const store = await setup(directory, {
    ...testAccount,
    session: {
      ...testAccount.session!,
      earliestRefreshAt: (testNow + 4000000) / 1000,
    },
  });
  const fetcher = goodFetch();
  const attempt = (now: number) =>
    store.update(async (state, save) => ({
      state: await refreshSelected(state, save, {
        ...deps(fetcher),
        now: () => now,
      }),
      value: null,
    }));
  expect((await attempt(testNow + 3590000)).ok).toBe(true);
  expect(await attempt(testNow + 3600000)).toEqual({
    ok: false,
    error: "refresh_not_ready",
  });
  expect(fetcher).not.toHaveBeenCalled();
});
it.concurrent.for([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
])("終端エラー %s でsessionだけ削除", async (code, { directory, expect }) => {
  const store = await setup(directory);
  const fetcher: Fetch = async (url) =>
    url.endsWith("openid-configuration")
      ? discovery()
      : Response.json({ error: code }, { status: 400 });
  expect(await refresh(store, deps(fetcher))).toEqual({
    ok: false,
    error: "token_expired",
  });
  const saved = await savedAccount(directory);
  expect(saved.session).toBeUndefined();
  expect(saved.identity).toEqual(testAccount.identity);
  expect(saved.clientId).toBe(testAccount.clientId);
});
it.concurrent("discovery障害では元sessionを変更せず再試行可能", async ({ directory, expect }) => {
  const store = await setup(directory);
  expect(
    await refresh(
      store,
      deps(async () => {
        throw new Error("dummy-secret");
      }),
    ),
  ).toEqual({ ok: false, error: "network" });
  expect((await savedAccount(directory)).session).toEqual(testAccount.session);
  expect((await refresh(store, deps(goodFetch()))).ok).toBe(true);
});
it.concurrent.for(["lost", "500", "429", "malformed", "missing-refresh"])(
  "送信結果が不明な %s では保持するが古いtokenを再送しない",
  async (mode, { directory, expect }) => {
    const store = await setup(directory);
    const fetcher = vi.fn<Fetch>(async (url) => {
      if (url.endsWith("openid-configuration")) return discovery();
      if (mode === "lost") throw new Error("dummy-secret");
      if (mode === "malformed") return new Response("dummy-secret");
      if (mode === "missing-refresh")
        return Response.json({ ...tokens, refresh_token: undefined });
      return Response.json({ error: "temporary" }, { status: Number(mode) });
    });
    expect(await refresh(store, deps(fetcher))).toEqual({
      ok: false,
      error: "refresh_uncertain",
    });
    const saved = await savedAccount(directory);
    expect(saved.session?.refreshToken).toBe(testAccount.session?.refreshToken);
    expect(() => requireSession(saved, testNow)).toThrow("refresh_uncertain");
    fetcher.mockClear();
    expect(await refresh(store, deps(fetcher))).toEqual({
      ok: false,
      error: "refresh_uncertain",
    });
    expect(fetcher).not.toHaveBeenCalled();
  },
);
it.concurrent("送信後のキャンセルでも後継tokenを保存してから中断", async ({ directory, expect }) => {
  const store = await setup(directory);
  const controller = new AbortController();
  const fetcher: Fetch = async (url, init) => {
    if (url.endsWith("openid-configuration")) return discovery();
    controller.abort();
    expect(init.signal?.aborted).toBe(false);
    return Response.json(tokens);
  };
  expect(
    await refresh(store, { ...deps(fetcher), signal: controller.signal }),
  ).toEqual({ ok: false, error: "cancelled" });
  expect((await savedAccount(directory)).session?.refreshToken).toBe(
    tokens.refresh_token,
  );
  expect((await savedAccount(directory)).session?.refreshUncertain).toBeUndefined();
});
it.concurrent("checkpoint保存失敗では更新要求を送らない", async ({ directory, expect }) => {
  const store = await setup(directory);
  const fetcher = goodFetch();
  expect(
    await store.update(async (state) => {
      await refreshSelected(
        state,
        async () => {
          throw new BoundaryError("storage");
        },
        deps(fetcher),
        true,
      );
      return { state, value: null };
    }),
  ).toEqual({ ok: false, error: "storage" });
  expect(fetcher).toHaveBeenCalledOnce();
  expect((await savedAccount(directory)).session).toEqual(testAccount.session);
});
it.concurrent.for([true, false])(
  "refresh ID tokenの署名・identityを確認（一致=%s）",
  async (matches, { directory, expect }) => {
    const store = await setup(directory);
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const key = await exportJWK(publicKey);
    const idToken = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(issuer)
      .setAudience(testAccount.clientId)
      .setSubject(matches ? testAccount.identity.subject : "different")
      .setIssuedAt(testNow / 1000)
      .setExpirationTime(testNow / 1000 + 3600)
      .sign(privateKey);
    const fetcher: Fetch = async (url) => {
      if (url.endsWith("openid-configuration")) return discovery();
      if (url.endsWith("jwks")) {
        expect((await savedAccount(directory)).session?.refreshToken).toBe(
          tokens.refresh_token,
        );
        expect((await savedAccount(directory)).session?.refreshUncertain).toBe(true);
        return Response.json({ keys: [key] });
      }
      return Response.json({ ...tokens, id_token: idToken, scope: "openid" });
    };
    const result = await refresh(store, deps(fetcher));
    expect(result.ok).toBe(matches);
    expect((await savedAccount(directory)).identity).toEqual(testAccount.identity);
    if (matches)
      expect((await savedAccount(directory)).session?.scopes).toEqual(["openid"]);
  },
);
it.concurrent("JWKS障害後のlogoutは後継refreshを失効させる", async ({ directory, expect }) => {
  const store = await setup(directory);
  await refresh(
    store,
    deps(async (url) => {
      if (url.endsWith("openid-configuration")) return discovery();
      if (url.endsWith("jwks")) throw new Error("offline");
      return Response.json({ ...tokens, id_token: "dummy-unverified-id" });
    }),
  );
  expect((await savedAccount(directory)).session?.refreshUncertain).toBe(true);
  const fetcher: Fetch = async (url, init) => {
    if (url.endsWith("openid-configuration")) return discovery();
    expect(new URLSearchParams(String(init.body)).get("token")).toBe(
      tokens.refresh_token,
    );
    return new Response(null, { status: 200 });
  };
  expect((await logout(store, fetcher, signal())).ok).toBe(true);
  expect((await savedAccount(directory)).session).toBeUndefined();
});
