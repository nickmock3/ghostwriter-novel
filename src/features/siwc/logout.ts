// Adapted from ChatGPT Plan Playground (MIT); see LICENSE.
import { setTimeout } from "node:timers/promises";
import { discover, type Fetch, request } from "./oidc";
import { BoundaryError } from "./result";
import type { CredentialStore } from "./store";

const revoke = async (
  fetcher: Fetch,
  token: string,
  clientId: string,
  signal: AbortSignal,
) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal.aborted) return false;
    try {
      const discovery = await discover(fetcher, signal);
      if (!discovery.revocation_endpoint) return false;
      const response = await request(
        fetcher,
        discovery.revocation_endpoint,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token,
            token_type_hint: "refresh_token",
            client_id: clientId,
          }),
        },
        signal,
      );
      // 成否はHTTP statusで判定し、応答本文・第三者エラーは保存しない。
      await response.body?.cancel().catch(() => {});
      if (response.status === 200) return true;
      if (response.status < 500 || response.status > 599) return false;
    } catch (error: unknown) {
      if (!(error instanceof BoundaryError) || error.code !== "network")
        return false;
    }
    if (attempt === 0) {
      try {
        await setTimeout(500, undefined, { signal });
      } catch {
        return false;
      }
    }
  }
  return false;
};

export const logout = (
  store: CredentialStore,
  fetcher: Fetch,
  signal: AbortSignal,
) =>
  store.update(async (state) => {
    // chat/loginと同じ排他を使い、token使用中の削除を拒否する。
    const account = state.accounts.find(
      (item) => item.id === state.activeAccountId,
    );
    if (!account) throw new BoundaryError("not_signed_in");
    const confirmed = account.session
      ? !!account.session.refreshToken &&
        (await revoke(
          fetcher,
          account.session.refreshToken,
          account.clientId,
          signal,
        ))
      : !account.remoteRevocationUnconfirmed;
    const { session: _session, ...registration } = account;
    return {
      state: {
        ...state,
        accounts: state.accounts.map((item) =>
          item.id === account.id
            ? { ...registration, remoteRevocationUnconfirmed: !confirmed }
            : item,
        ),
      },
      value: { remoteRevocationConfirmed: confirmed },
    };
  });
