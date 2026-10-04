// Adapted from ChatGPT Plan Playground (MIT); see LICENSE.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { type Account, clientIdSchema, resource } from "./credentials";
import { failure, type Result, success } from "./result";

export type Attempt = Readonly<{
  state: string;
  nonce: string;
  verifier: string;
  challenge: string;
}>;
export type Callback = Readonly<{ code: string; clientId: string }>;
export const createAttempt = (): Attempt => {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
};
const equalSecret = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export const authorizationUrl = (
  endpoint: string,
  hostId: string,
  redirectUri: string,
  attempt: Attempt,
  account?: Pick<Account, "clientId">,
) => {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    client_id: account?.clientId ?? "dynamic_agent_client",
    ext_agent_host_id: hostId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope:
      "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    resource,
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge_method: "S256",
    code_challenge: attempt.challenge,
    ...(!account ? { agent_name_hint: "Ghostwriter" } : {}),
    // login_hint/id_token_hintは任意。URLへの秘密情報混入を避けるため送らない。
  }).toString();
  return url.toString();
};
export const validateCallback = (
  url: URL,
  attempt: Attempt,
  account?: Pick<Account, "clientId">,
): Result<Callback> => {
  const params = url.searchParams;
  for (const key of ["state", "code", "client_id", "error"]) {
    if (params.getAll(key).length > 1) return failure("invalid_callback");
  }
  if (!equalSecret(params.get("state") ?? "", attempt.state))
    return failure("invalid_callback");
  if (params.has("error"))
    return failure(
      params.get("error") === "access_denied"
        ? "denied"
        : "authorization_failed",
    );
  const code = params.get("code");
  const clientId = params.get("client_id") ?? account?.clientId;
  if (
    !code ||
    code.length > 16384 ||
    !clientIdSchema.safeParse(clientId).success ||
    !clientId
  )
    return failure("invalid_callback");
  if (account && clientId !== account.clientId)
    return failure("invalid_callback");
  return success({ code, clientId });
};
