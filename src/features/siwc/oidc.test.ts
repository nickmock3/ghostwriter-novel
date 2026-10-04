// @vitest-environment node
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { tokenResponseSchema } from "./credentials";
import { createAttempt } from "./oauth";
import { discover, exchangeCode, type Fetch, verifyIdentity } from "./oidc";

const now = Date.parse("2026-10-03T00:00:00Z");
const discovery = {
  issuer: "https://auth.openai.com" as const,
  authorization_endpoint: "https://auth.openai.com/api/accounts/authorize",
  token_endpoint: "https://auth.openai.com/api/accounts/oauth/token",
  jwks_uri: "https://auth.openai.com/test-jwks",
};
const signal = new AbortController().signal;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwk: Awaited<ReturnType<typeof exportJWK>>;
beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  jwk = await exportJWK(keys.publicKey);
});
const claims = {
  iss: discovery.issuer,
  aud: "oaiapp_test",
  sub: "subject-test",
  nonce: "nonce-test",
  iat: now / 1000,
  exp: now / 1000 + 3600,
};
const sign = (overrides: Record<string, unknown> = {}) =>
  new SignJWT({ ...claims, ...overrides })
    .setProtectedHeader({ alg: "RS256" })
    .sign(keys.privateKey);
const fetchJwks: Fetch = async () => Response.json({ keys: [jwk] });

describe("OIDC署名検証", () => {
  it("署名・issuer・audience・期限・nonceを検証する", async () => {
    expect(
      await verifyIdentity(
        await sign(),
        claims.aud,
        claims.nonce,
        discovery,
        fetchJwks,
        signal,
        now,
      ),
    ).toEqual({ issuer: claims.iss, subject: claims.sub });
  });
  it.each([
    { iss: "https://untrusted.example" },
    { aud: "other-client" },
    { nonce: "wrong" },
    { exp: now / 1000 - 1 },
    { exp: undefined },
    { sub: "" },
    { aud: [claims.aud, "other-client"] },
    { azp: "other-client" },
  ])("不正claim %j を拒否する", async (overrides) => {
    await expect(
      verifyIdentity(
        await sign(overrides),
        claims.aud,
        claims.nonce,
        discovery,
        fetchJwks,
        signal,
        now,
      ),
    ).rejects.toMatchObject({ code: "invalid_identity" });
  });
  it("異なる鍵の署名を拒否する", async () => {
    const other = await generateKeyPair("RS256");
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256" })
      .sign(other.privateKey);
    await expect(
      verifyIdentity(
        token,
        claims.aud,
        claims.nonce,
        discovery,
        fetchJwks,
        signal,
        now,
      ),
    ).rejects.toMatchObject({ code: "invalid_identity" });
  });
});
describe("認証HTTP境界", () => {
  it("discoveryのissuerと秘密情報送信先を制限する", async () => {
    await expect(
      discover(
        async () =>
          Response.json({
            ...discovery,
            token_endpoint: "https://untrusted.example/token",
          }),
        signal,
      ),
    ).rejects.toMatchObject({ code: "invalid_response" });
    expect(
      await discover(async () => Response.json(discovery), signal),
    ).toEqual(discovery);
  });
  it("発行済みIDと完全一致redirectをformで送る", async () => {
    const attempt = createAttempt();
    let body = new URLSearchParams();
    const fetcher: Fetch = async (url, init) => {
      expect(url).toBe(discovery.token_endpoint);
      expect(init.redirect).toBe("error");
      expect(init.method).toBe("POST");
      body = new URLSearchParams(String(init.body));
      return Response.json({
        access_token: "dummy",
        id_token: "dummy",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid",
      });
    };
    await exchangeCode(
      fetcher,
      discovery,
      { clientId: "oaiapp_test", code: "dummy-code" },
      attempt,
      "http://127.0.0.1:55555/auth/callback",
      signal,
    );
    expect(body.get("client_id")).toBe("oaiapp_test");
    expect(body.get("redirect_uri")).toBe(
      "http://127.0.0.1:55555/auth/callback",
    );
    expect(body.get("code_verifier")).toBe(attempt.verifier);
    expect(body.has("client_secret")).toBe(false);
  });
  it("秘密を含むHTTP例外の内容を外へ渡さない", async () => {
    await expect(
      discover(async () => {
        throw new Error("dummy-token-in-url");
      }, signal),
    ).rejects.toMatchObject({ message: "network", code: "network" });
  });
  it("offline_access未付与ならrefresh token欠落を許可する", () => {
    const tokens = {
      access_token: "dummy",
      id_token: "dummy",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid",
    };
    expect(tokenResponseSchema.safeParse(tokens).success).toBe(true);
    expect(
      tokenResponseSchema.safeParse({
        ...tokens,
        scope: "openid offline_access",
      }).success,
    ).toBe(false);
    expect(
      tokenResponseSchema.safeParse({ ...tokens, expires_in: null }).success,
    ).toBe(false);
    expect(
      tokenResponseSchema.safeParse({
        ...tokens,
        earliest_refresh_at: { opaque: true },
      }).success,
    ).toBe(true);
  });
});
