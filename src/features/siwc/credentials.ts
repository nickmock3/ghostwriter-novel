// Adapted from ChatGPT Plan Playground (MIT); see LICENSE.
import { z } from "zod";

export const issuer = "https://auth.openai.com";
export const resource = "https://api.openai.com/v1";
export const directScope = "chatgpt.tokens.use.direct";
export const clientIdSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((id) => id !== "dynamic_agent_client");
const secret = z.string().min(1).max(65536);
export const tokenResponseSchema = z
  .object({
    access_token: secret,
    refresh_token: secret.optional(),
    id_token: secret,
    token_type: z.string().refine((value) => value.toLowerCase() === "bearer"),
    expires_in: z.number().int().positive().max(31536000),
    scope: z.string().max(8192),
    // 未知の形式も保存できるようJSONとし、更新時にrefresh.tsで検証する。
    earliest_refresh_at: z.json().optional(),
  })
  .refine(
    (tokens) =>
      !tokens.scope.split(/\s+/u).includes("offline_access") ||
      !!tokens.refresh_token,
  );

export const identitySchema = z.object({
  issuer: z.literal(issuer),
  subject: z.string().min(1).max(2048),
});
export const sessionSchema = z.object({
  accessToken: secret,
  refreshToken: secret.optional(),
  idToken: secret,
  scopes: z.array(z.string()),
  expiresAt: z.number().int().nonnegative().max(8640000000000000),
  earliestRefreshAt: z.json().optional(),
  refreshUncertain: z.boolean().optional(),
});
export const accountSchema = z.object({
  id: z.uuid(),
  clientId: clientIdSchema,
  identity: identitySchema,
  session: sessionSchema.optional(),
  remoteRevocationUnconfirmed: z.boolean().optional(),
});
export const credentialsSchema = z
  .object({
    version: z.literal(1),
    hostId: z
      .string()
      .regex(
        /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      ),
    accounts: z.array(accountSchema),
    activeAccountId: z.uuid().nullable(),
  })
  .refine(
    (state) =>
      new Set(state.accounts.map((account) => account.id)).size ===
      state.accounts.length,
  )
  .refine(
    (state) =>
      new Set(state.accounts.map((account) => account.clientId)).size ===
      state.accounts.length,
  )
  .refine(
    (state) =>
      state.activeAccountId === null ||
      state.accounts.some((account) => account.id === state.activeAccountId),
  );

export type Identity = z.infer<typeof identitySchema>;
export type Account = z.infer<typeof accountSchema>;
export type Credentials = z.infer<typeof credentialsSchema>;
export type TokenResponse = z.infer<typeof tokenResponseSchema>;
export const sameIdentity = (a: Identity, b: Identity) =>
  a.issuer === b.issuer && a.subject === b.subject;
export const canInvoke = (account: Account, now: number) =>
  !!account.session &&
  !account.session.refreshUncertain &&
  account.session.expiresAt > now &&
  account.session.scopes.includes(directScope);

export const toSession = (
  tokens: TokenResponse,
  receivedAt: number,
): z.infer<typeof sessionSchema> => ({
  accessToken: tokens.access_token,
  idToken: tokens.id_token,
  ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
  scopes: tokens.scope.split(/\s+/u).filter(Boolean),
  expiresAt: receivedAt + tokens.expires_in * 1000,
  ...(tokens.earliest_refresh_at !== undefined
    ? { earliestRefreshAt: tokens.earliest_refresh_at }
    : {}),
});
