// Adapted from ChatGPT Plan Playground (MIT); see LICENSE.
import { createLocalJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import {
  type Identity,
  issuer,
  resource,
  tokenResponseSchema,
} from "./credentials";
import type { Attempt, Callback } from "./oauth";
import { BoundaryError } from "./result";

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
const authUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.origin === issuer && !url.username && !url.password && !url.hash;
});
const discoverySchema = z.object({
  issuer: z.literal(issuer),
  authorization_endpoint: authUrl,
  token_endpoint: authUrl,
  jwks_uri: authUrl,
  revocation_endpoint: authUrl.optional(),
});
const jwksSchema = z.object({
  keys: z.array(z.object({ kty: z.string() }).catchall(z.unknown())).min(1),
});
export type Discovery = z.infer<typeof discoverySchema>;
export const request = async (
  fetcher: Fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
) => {
  try {
    return await fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
  } catch {
    throw new BoundaryError(signal.aborted ? "cancelled" : "network");
  }
};
const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw new BoundaryError("invalid_response");
  }
};
export const discover = async (
  fetcher: Fetch,
  signal: AbortSignal,
): Promise<Discovery> => {
  const response = await request(
    fetcher,
    `${issuer}/.well-known/openid-configuration`,
    {},
    signal,
  );
  if (!response.ok) throw new BoundaryError("network");
  const parsed = discoverySchema.safeParse(await readJson(response));
  if (!parsed.success) throw new BoundaryError("invalid_response");
  return parsed.data;
};
export const exchangeCode = async (
  fetcher: Fetch,
  discovery: Discovery,
  callback: Callback,
  attempt: Attempt,
  redirectUri: string,
  signal: AbortSignal,
) => {
  const response = await request(
    fetcher,
    discovery.token_endpoint,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: callback.clientId,
        code: callback.code,
        code_verifier: attempt.verifier,
        redirect_uri: redirectUri,
        resource,
      }),
    },
    signal,
  );
  const data = await readJson(response);
  if (!response.ok) {
    const parsed = z.object({ error: z.string() }).safeParse(data);
    if (parsed.success && parsed.data.error === "invalid_grant")
      throw new BoundaryError("invalid_grant");
    throw new BoundaryError(
      response.status >= 500 ? "network" : "authorization_failed",
    );
  }
  const parsed = tokenResponseSchema.safeParse(data);
  if (!parsed.success) throw new BoundaryError("invalid_response");
  return parsed.data;
};
export const verifyIdentity = async (
  idToken: string,
  clientId: string,
  nonce: string | undefined,
  discovery: Discovery,
  fetcher: Fetch,
  signal: AbortSignal,
  now: number,
): Promise<Identity> => {
  const response = await request(fetcher, discovery.jwks_uri, {}, signal);
  if (!response.ok) throw new BoundaryError("network");
  const parsed = jwksSchema.safeParse(await readJson(response));
  if (!parsed.success) throw new BoundaryError("invalid_response");
  try {
    const { payload } = await jwtVerify(
      idToken,
      createLocalJWKSet(parsed.data),
      {
        issuer,
        audience: clientId,
        requiredClaims: [
          "sub",
          "exp",
          "iat",
          ...(nonce === undefined ? [] : ["nonce"]),
        ],
        currentDate: new Date(now),
        algorithms: ["RS256", "PS256", "ES256", "EdDSA"],
      },
    );
    if (
      (nonce !== undefined && payload.nonce !== nonce) ||
      !payload.sub ||
      (payload.azp !== undefined && payload.azp !== clientId) ||
      (Array.isArray(payload.aud) &&
        payload.aud.length > 1 &&
        payload.azp !== clientId)
    )
      throw new Error("invalid claims");
    return { issuer, subject: payload.sub };
  } catch {
    throw new BoundaryError("invalid_identity");
  }
};
