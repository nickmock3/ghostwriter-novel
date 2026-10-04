// Adapted from ChatGPT Plan Playground (MIT); see LICENSE.
import { randomUUID } from "node:crypto";
import { type Listen, listenForCallback } from "./callback";
import { type Account, sameIdentity, toSession } from "./credentials";
import { authorizationUrl, createAttempt } from "./oauth";
import { discover, exchangeCode, type Fetch, verifyIdentity } from "./oidc";
import { BoundaryError } from "./result";
import type { CredentialStore } from "./store";

export type LoginDependencies = Readonly<{
  store: CredentialStore;
  fetch: Fetch;
  authorize: (url: string) => Promise<void>;
  signal: AbortSignal;
  listen?: Listen;
  now?: () => number;
}>;
export const login = (dependencies: LoginDependencies, accountId?: string) =>
  dependencies.store.update(async (state) => {
    const account = accountId
      ? state.accounts.find((item) => item.id === accountId)
      : undefined;
    if (accountId && !account) throw new BoundaryError("account_not_found");
    const { fetch: fetcher, signal } = dependencies;
    const now = dependencies.now ?? Date.now;
    const discovery = await discover(fetcher, signal);
    let registration: Pick<Account, "clientId"> | undefined = account;
    // コードを再利用せず、発行済みclient IDで1度だけ認可をやり直す。
    for (let pass = 0; pass < 2; pass++) {
      const attempt = createAttempt();
      const listener = await (dependencies.listen ?? listenForCallback)(
        attempt,
        registration,
        signal,
      );
      try {
        if (signal.aborted) throw new BoundaryError("cancelled");
        await dependencies.authorize(
          authorizationUrl(
            discovery.authorization_endpoint,
            state.hostId,
            listener.redirectUri,
            attempt,
            registration,
          ),
        );
        const callback = await listener.result;
        if (!callback.ok) throw new BoundaryError(callback.error);
        registration = { clientId: callback.value.clientId };
        const tokens = await exchangeCode(
          fetcher,
          discovery,
          callback.value,
          attempt,
          listener.redirectUri,
          signal,
        );
        const receivedAt = now();
        const identity = await verifyIdentity(
          tokens.id_token,
          callback.value.clientId,
          attempt.nonce,
          discovery,
          fetcher,
          signal,
          now(),
        );
        const existing =
          account ??
          state.accounts.find(
            (item) => item.clientId === callback.value.clientId,
          );
        if (existing && !sameIdentity(identity, existing.identity))
          throw new BoundaryError("invalid_identity");
        if (signal.aborted) throw new BoundaryError("cancelled");
        const saved: Account = {
          id: existing?.id ?? randomUUID(),
          clientId: callback.value.clientId,
          identity,
          session: toSession(tokens, receivedAt),
        };
        return {
          state: {
            ...state,
            activeAccountId: saved.id,
            accounts: [
              ...state.accounts.filter((item) => item.id !== saved.id),
              saved,
            ],
          },
          value: saved.id,
        };
      } catch (error: unknown) {
        if (
          error instanceof BoundaryError &&
          error.code === "invalid_grant" &&
          pass === 0
        )
          continue;
        throw error;
      } finally {
        listener.close();
      }
    }
    throw new BoundaryError("invalid_grant");
  });
