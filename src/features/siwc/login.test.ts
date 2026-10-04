// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { listAccounts, selectAccount } from "./accounts";
import { canInvoke, issuer } from "./credentials";
import { login } from "./login";
import { type Attempt, validateCallback } from "./oauth";
import type { Fetch } from "./oidc";
import type { ErrorCode } from "./result";
import { createCredentialStore } from "./store";


const now = Date.parse("2026-10-03T00:00:00Z");
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwk: Awaited<ReturnType<typeof exportJWK>>;
let directory: string;
let temporaryRoot: string;
beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  jwk = await exportJWK(keys.publicKey);
});
beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "siwc-login-test-"));
  directory = join(temporaryRoot, "credentials");
});
afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

const harness = (
  options: Readonly<{
    subject?: string;
    clientId?: string;
    scope?: string;
    nonce?: string;
    callbackError?: ErrorCode;
    invalidGrant?: boolean;
    abortAfterJwks?: boolean;
  }> = {},
) => {
  const store = createCredentialStore(directory);
  const controller = new AbortController();
  let attempt: Attempt;
  const requests: { url: string; init: RequestInit }[] = [];
  const authorizations: URL[] = [];
  let exchangeCount = 0;
  const clientId = options.clientId ?? "oaiapp_test";
  const fetcher: Fetch = async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith("openid-configuration"))
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/api/accounts/authorize`,
        token_endpoint: `${issuer}/api/accounts/oauth/token`,
        jwks_uri: `${issuer}/test-jwks`,
      });
    if (url.endsWith("test-jwks")) {
      if (options.abortAfterJwks) controller.abort();
      return Response.json({ keys: [jwk] });
    }
    if (url.endsWith("oauth/token")) {
      exchangeCount++;
      if (options.invalidGrant && exchangeCount === 1)
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      const token = await new SignJWT({
        sub: options.subject ?? "subject-test",
        nonce: options.nonce ?? attempt.nonce,
      })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(issuer)
        .setAudience(clientId)
        .setIssuedAt(now / 1000)
        .setExpirationTime(now / 1000 + 3600)
        .sign(keys.privateKey);
      return Response.json({
        access_token: "dummy-access",
        refresh_token: "dummy-refresh",
        id_token: token,
        token_type: "Bearer",
        expires_in: 3600,
        scope:
          options.scope ?? "openid offline_access chatgpt.tokens.use.direct",
        earliest_refresh_at: null,
      });
    }
    throw new Error("Unexpected network request");
  };
  const close = vi.fn();
  const dependencies = {
    store,
    fetch: fetcher,
    signal: controller.signal,
    now: () => now,
    authorize: async (url: string) => {
      authorizations.push(new URL(url));
    },
    listen: vi.fn(
      async (
        pending: Attempt,
        registration: { clientId: string } | undefined,
      ) => {
        attempt = pending;
        const redirectUri = `http://127.0.0.1:${45000 + authorizations.length}/auth/callback`;
        const callback = new URL(redirectUri);
        callback.search = new URLSearchParams({
          state: pending.state,
          code: "dummy-code",
          ...(!registration ? { client_id: clientId } : {}),
        }).toString();
        return {
          redirectUri,
          close,
          result: Promise.resolve(
            options.callbackError
              ? { ok: false as const, error: options.callbackError }
              : validateCallback(callback, pending, registration),
          ),
        };
      },
    ),
  };
  return { dependencies, store, requests, authorizations, close, controller };
};

describe("認証と保存の結合", () => {
  it("初回登録から保存・status・再認証まで実通信なしで検証する", async () => {
    const setup = harness();
    const result = await login(setup.dependencies);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Login failed");
    const first = await setup.store.read();
    if (!first.ok || !first.value) throw new Error("Missing state");
    const account = first.value.accounts[0];
    if (!account) throw new Error("Missing account");
    expect(canInvoke(account, now)).toBe(true);
    expect(canInvoke(account, now + 3600000)).toBe(false);
    expect(first.value.activeAccountId).toBe(result.value);
    expect(setup.authorizations[0]?.searchParams.get("client_id")).toBe(
      "dynamic_agent_client",
    );
    const summary = JSON.stringify(listAccounts(first.value, now));
    expect(summary).not.toContain("dummy-access");
    expect(summary).not.toContain("dummy-refresh");
    expect(summary).not.toContain("subject-test");
    expect(await login(setup.dependencies, result.value)).toEqual(result);
    expect(setup.authorizations[1]?.searchParams.get("client_id")).toBe(
      "oaiapp_test",
    );
    expect(setup.authorizations[1]?.searchParams.has("agent_name_hint")).toBe(
      false,
    );
    expect(setup.close).toHaveBeenCalledTimes(2);
    const exchanges = setup.requests.filter((request) =>
      request.url.endsWith("oauth/token"),
    );
    for (const [index, request] of exchanges.entries()) {
      const body = new URLSearchParams(String(request.init.body));
      expect(body.get("redirect_uri")).toBe(
        setup.authorizations[index]?.searchParams.get("redirect_uri"),
      );
      expect(body.get("client_id")).toBe("oaiapp_test");
    }
    const second = await setup.store.read();
    if (!second.ok || !second.value) throw new Error("Missing state");
    expect(second.value.hostId).toBe(first.value.hostId);
    expect(second.value.accounts).toHaveLength(1);
  });
  it("推論scope未付与でもサインインを保存し、推論可とは判定しない", async () => {
    const setup = harness({ scope: "openid" });
    expect((await login(setup.dependencies)).ok).toBe(true);
    const read = await setup.store.read();
    if (!read.ok || !read.value?.accounts[0])
      throw new Error("Missing account");
    expect(canInvoke(read.value.accounts[0], now)).toBe(false);
    expect(listAccounts(read.value, now)[0]?.directPermission).toBe(false);
    expect(
      setup.requests.some((request) => request.url.includes("/responses")),
    ).toBe(false);
  });
  it.each(["denied", "timeout", "cancelled", "invalid_callback"] as const)(
    "%sではtoken交換しない",
    async (callbackError) => {
      const setup = harness({ callbackError });
      expect(await login(setup.dependencies)).toEqual({
        ok: false,
        error: callbackError,
      });
      expect(setup.requests).toHaveLength(1);
      expect(setup.close).toHaveBeenCalledOnce();
    },
  );
  it.each([
    { subject: "other-subject" },
    { nonce: "wrong-nonce" },
    { clientId: "other-client" },
  ])("再認証不一致 %j で既存tokensを維持する", async (options) => {
    const setup = harness();
    const original = await login(setup.dependencies);
    if (!original.ok) throw new Error("Login failed");
    const before = await setup.store.read();
    const mismatched = harness(options);
    expect(await login(mismatched.dependencies, original.value)).toEqual({
      ok: false,
      error: "invalid_identity",
    });
    expect(await setup.store.read()).toEqual(before);
  });
  it("同じidentityでも別client IDは別登録として切り替える", async () => {
    const setup = harness();
    const first = await login(setup.dependencies);
    const second = await login(
      harness({ clientId: "oaiapp_second" }).dependencies,
    );
    if (!first.ok || !second.ok) throw new Error("Login failed");
    expect(first.value).not.toBe(second.value);
    expect(await selectAccount(setup.store, first.value)).toEqual(first);
    const read = await setup.store.read();
    if (!read.ok || !read.value) throw new Error("Missing state");
    expect(read.value.accounts).toHaveLength(2);
    expect(read.value.activeAccountId).toBe(first.value);
  });
  it("invalid_grantの次の試行で発行済みIDを使い、PKCEを作り直す", async () => {
    const setup = harness({ invalidGrant: true });
    expect((await login(setup.dependencies)).ok).toBe(true);
    expect(setup.authorizations).toHaveLength(2);
    expect(setup.authorizations[1]?.searchParams.get("client_id")).toBe(
      "oaiapp_test",
    );
    expect(setup.authorizations[1]?.searchParams.get("state")).not.toBe(
      setup.authorizations[0]?.searchParams.get("state"),
    );
    expect(setup.authorizations[1]?.searchParams.has("agent_name_hint")).toBe(
      false,
    );
  });
  it("検証中のキャンセルで保存しない", async () => {
    const setup = harness({ abortAfterJwks: true });
    expect(await login(setup.dependencies)).toEqual({
      ok: false,
      error: "cancelled",
    });
    const read = await setup.store.read();
    if (!read.ok) throw new Error("Read failed");
    expect(read.value?.accounts).toEqual([]);
  });
});
