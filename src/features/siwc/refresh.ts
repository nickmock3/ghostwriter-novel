// Adapted from ChatGPT Plan Playground (MIT); see LICENSE.
import { z } from "zod";
import {
  type Account,
  type Credentials,
  resource,
  sameIdentity,
  toSession,
} from "./credentials";
import { discover, type Fetch, request, verifyIdentity } from "./oidc";
import { BoundaryError } from "./result";
import type { CredentialStore } from "./store";

const secret = z.string().min(1).max(65536);
const responseSchema = z.object({
  access_token: secret,
  refresh_token: secret,
  id_token: secret.optional(),
  scope: z.string().max(8192).optional(),
  token_type: z.string().refine((value) => value.toLowerCase() === "bearer"),
  expires_in: z.number().int().positive().max(31536000),
  earliest_refresh_at: z.json().optional(),
});
const terminalErrors = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);
const errorSchema = z.union([
  z.object({ error: z.string() }).transform((data) => data.error),
  z
    .object({ error: z.object({ code: z.string() }) })
    .transform((data) => data.error.code),
  z
    .object({ detail: z.object({ code: z.string() }) })
    .transform((data) => data.detail.code),
]);

// 公式DevKitの数値=Unix秒、文字列=日時、欠落/null=制約なしに合わせる。
// 不正値は期限切れ側へ倒さず、更新を止める。
export const earliestRefreshMs = (value: unknown): number => {
  if (value === undefined || value === null) return 0;
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 8640000000000
  )
    return value * 1000;
  if (
    typeof value === "string" &&
    z.iso.datetime({ offset: true }).safeParse(value).success
  ) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new BoundaryError("refresh_schedule");
};

type Dependencies = Readonly<{
  fetch: Fetch;
  signal: AbortSignal;
  now?: () => number;
}>;

// 呼び出し元がstore.updateのlockを保持し、返したstateで最終更新する。
export const refreshSelected = async (
  state: Credentials,
  checkpoint: (state: Credentials) => Promise<void>,
  dependencies: Dependencies,
  force = false,
): Promise<Credentials> => {
  const now = dependencies.now ?? Date.now;
  const account = state.accounts.find(
    (item) => item.id === state.activeAccountId,
  );
  if (!account?.session) throw new BoundaryError("not_signed_in");
  const previous = account.session;
  if (previous.refreshUncertain) throw new BoundaryError("refresh_uncertain");
  if (dependencies.signal.aborted) throw new BoundaryError("cancelled");
  if (!force && previous.expiresAt > now() + 60000) return state;
  if (!previous.refreshToken) {
    if (!force && previous.expiresAt > now()) return state;
    throw new BoundaryError("token_expired");
  }
  if (earliestRefreshMs(previous.earliestRefreshAt) > now()) {
    if (!force && previous.expiresAt > now()) return state;
    throw new BoundaryError("refresh_not_ready");
  }
  const replace = (replacement: Account): Credentials => ({
    ...state,
    accounts: state.accounts.map((item) =>
      item.id === account.id ? replacement : item,
    ),
  });
  const discovery = await discover(dependencies.fetch, dependencies.signal);
  if (dependencies.signal.aborted) throw new BoundaryError("cancelled");
  // 送信後の応答喪失・強制終了でも、消費済みかもしれないtokenを再送しない。
  await checkpoint(
    replace({ ...account, session: { ...previous, refreshUncertain: true } }),
  );
  // 呼び出しの中断後も受信・保存を終え、唯一の後継tokenを捨てない。
  const rotationSignal = AbortSignal.timeout(45000);
  let response: Response;
  let data: unknown;
  try {
    response = await request(
      dependencies.fetch,
      discovery.token_endpoint,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: account.clientId,
          refresh_token: previous.refreshToken,
          resource,
        }),
      },
      rotationSignal,
    );
    data = await response.json();
  } catch {
    throw new BoundaryError("refresh_uncertain");
  }
  if (response.status !== 200) {
    const code = errorSchema.safeParse(data);
    if (
      response.status >= 400 &&
      response.status < 500 &&
      code.success &&
      terminalErrors.has(code.data)
    ) {
      const { session: _session, ...registration } = account;
      await checkpoint(replace(registration));
      throw new BoundaryError("token_expired");
    }
    // 5xx等でも送信結果は断定できない。tokenを保持し再認証を案内する。
    throw new BoundaryError("refresh_uncertain");
  }
  const parsed = responseSchema.safeParse(data);
  if (!parsed.success) throw new BoundaryError("refresh_uncertain");
  const receivedAt = now();
  const nextSession = toSession(
    {
      ...parsed.data,
      id_token: parsed.data.id_token ?? previous.idToken,
      scope: parsed.data.scope ?? previous.scopes.join(" "),
    },
    receivedAt,
  );
  // JWKS取得より前に後継tokenを保護する。未検証中は推論/再refreshに使用しない。
  await checkpoint(
    replace({
      ...account,
      session: { ...nextSession, refreshUncertain: true },
    }),
  );
  if (parsed.data.id_token !== undefined) {
    try {
      const identity = await verifyIdentity(
        parsed.data.id_token,
        account.clientId,
        undefined,
        discovery,
        dependencies.fetch,
        rotationSignal,
        receivedAt,
      );
      if (!sameIdentity(identity, account.identity))
        throw new BoundaryError("invalid_identity");
    } catch {
      throw new BoundaryError("refresh_uncertain");
    }
  }
  const updated = replace({ ...account, session: nextSession });
  await checkpoint(updated);
  if (dependencies.signal.aborted) throw new BoundaryError("cancelled");
  return updated;
};

export const refresh = (store: CredentialStore, dependencies: Dependencies) =>
  store.update(async (state, checkpoint) => ({
    state: await refreshSelected(state, checkpoint, dependencies, true),
    value: undefined,
  }));
