// Adapted from ChatGPT Plan Playground (MIT); see LICENSE.
import { type Account, type Credentials, directScope } from "./credentials";
import { BoundaryError } from "./result";
import type { CredentialStore } from "./store";

// UIへ渡す情報を絞り、token/identityを表示層へ渡さない。
export const accountSummary = (
  account: Account,
  activeId: string | null,
  now: number,
) => ({
  id: account.id,
  active: account.id === activeId,
  status: !account.session
    ? "signed-out"
    : account.session.refreshUncertain
      ? "reauth-required"
      : account.session.expiresAt <= now
        ? "expired"
        : "signed-in",
  expiresAt: account.session?.expiresAt ?? null,
  directPermission: account.session?.scopes.includes(directScope) ?? false,
});
export const listAccounts = (state: Credentials | null, now: number) =>
  state?.accounts.map((account) =>
    accountSummary(account, state.activeAccountId, now),
  ) ?? [];
export const selectAccount = (store: CredentialStore, id: string) =>
  store.update(async (state) => {
    if (!state.accounts.some((account) => account.id === id))
      throw new BoundaryError("account_not_found");
    return { state: { ...state, activeAccountId: id }, value: id };
  });
