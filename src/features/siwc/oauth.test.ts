// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authorizationUrl, createAttempt, validateCallback } from "./oauth";

const endpoint = "https://auth.openai.com/api/accounts/authorize";
const redirect = "http://127.0.0.1:45678/auth/callback";
describe("OAuth要求とcallback", () => {
  it("毎回異なるstate/nonce/verifierとPKCE S256を作る", () => {
    const first = createAttempt();
    const second = createAttempt();
    for (const key of ["state", "nonce", "verifier"] as const) {
      expect(first[key]).not.toBe(second[key]);
      expect(first[key]).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    }
    expect(first.challenge).toBe(
      createHash("sha256").update(first.verifier).digest("base64url"),
    );
  });
  it("初回だけdynamic clientとagent名を送り、再認証では保存済みIDを使う", () => {
    const attempt = createAttempt();
    const first = new URL(
      authorizationUrl(endpoint, "host-test", redirect, attempt),
    );
    expect(first.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(first.searchParams.get("agent_name_hint")).toBe(
      "Ghostwriter",
    );
    expect(first.searchParams.get("redirect_uri")).toBe(redirect);
    expect(first.searchParams.get("code_challenge_method")).toBe("S256");
    const next = new URL(
      authorizationUrl(endpoint, "host-test", redirect, attempt, {
        clientId: "oaiapp_test",
      }),
    );
    expect(next.searchParams.get("client_id")).toBe("oaiapp_test");
    expect(next.searchParams.has("agent_name_hint")).toBe(false);
    expect(next.searchParams.has("id_token_hint")).toBe(false);
    expect(next.searchParams.get("ext_agent_host_id")).toBe("host-test");
  });
  it.each([
    "state=wrong&code=dummy&client_id=oaiapp_test",
    "state=expected&code=dummy",
    "state=expected&code=dummy&client_id=dynamic_agent_client",
    "state=expected&state=expected&code=dummy&client_id=oaiapp_test",
    "state=expected&code=dummy&code=other&client_id=oaiapp_test",
  ])("不正callbackを拒否: %s", (query) => {
    expect(
      validateCallback(new URL(`${redirect}?${query}`), {
        ...createAttempt(),
        state: "expected",
      }),
    ).toEqual({ ok: false, error: "invalid_callback" });
  });
  it("拒否時にもstateを先に確認する", () => {
    const attempt = { ...createAttempt(), state: "expected" };
    expect(
      validateCallback(
        new URL(`${redirect}?state=wrong&error=access_denied`),
        attempt,
      ),
    ).toEqual({ ok: false, error: "invalid_callback" });
    expect(
      validateCallback(
        new URL(`${redirect}?state=expected&error=access_denied`),
        attempt,
      ),
    ).toEqual({ ok: false, error: "denied" });
  });
  it("再認証のclient ID省略を許可し、不一致を拒否する", () => {
    const attempt = { ...createAttempt(), state: "expected" };
    const account = { clientId: "oaiapp_test" };
    expect(
      validateCallback(
        new URL(`${redirect}?state=expected&code=dummy`),
        attempt,
        account,
      ),
    ).toEqual({
      ok: true,
      value: { code: "dummy", clientId: account.clientId },
    });
    expect(
      validateCallback(
        new URL(`${redirect}?state=expected&code=dummy&client_id=other`),
        attempt,
        account,
      ),
    ).toEqual({ ok: false, error: "invalid_callback" });
  });
});
